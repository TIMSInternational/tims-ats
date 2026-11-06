using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Tims.Application.InterviewTranscription;

/// <summary>
/// Daily webhook signature (docs.daily.co/reference/rest-api/webhooks): <c>X-Webhook-Signature</c> =
/// base64(HMAC-SHA256(base64decode(secret), <c>X-Webhook-Timestamp</c> + "." + body)). Verified over the RAW body
/// bytes exactly as received (Daily signs the compact JSON it sends). Constant-time comparison; a missing or
/// non-base64 secret verifies nothing.
/// </summary>
public static class DailyWebhookSignature
{
    /// <summary>
    /// Accepted clock skew between the signed timestamp and now. Generous on purpose: Daily's exponential retry
    /// schedule spans ~13 minutes and may resend the original timestamp, and a replayed event is harmless anyway
    /// (handling is idempotent per event id and transcript id, and re-checks consent every time).
    /// </summary>
    public static readonly TimeSpan Tolerance = TimeSpan.FromHours(24);

    public const int MaxBodyBytes = 65_536;

    public static bool Verify(string? base64Secret, string? timestamp, string? signature, ReadOnlySpan<byte> body,
        DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(base64Secret) || string.IsNullOrEmpty(timestamp) ||
            string.IsNullOrEmpty(signature) || timestamp.Length > 20 || signature.Length > 128) return false;
        if (!TryReadTimestamp(timestamp, out var signedAt) || (now - signedAt).Duration() > Tolerance) return false;
        byte[] key;
        byte[] expected;
        try
        {
            key = Convert.FromBase64String(base64Secret.Trim());
            expected = Convert.FromBase64String(signature.Trim());
        }
        catch (FormatException)
        {
            return false;
        }
        if (key.Length < 16) return false;
        var prefix = Encoding.UTF8.GetBytes(timestamp + ".");
        var signed = new byte[prefix.Length + body.Length];
        prefix.CopyTo(signed, 0);
        body.CopyTo(signed.AsSpan(prefix.Length));
        var computed = HMACSHA256.HashData(key, signed);
        return CryptographicOperations.FixedTimeEquals(computed, expected);
    }

    /// <summary>Unix seconds, or milliseconds when the value is too large to be seconds (Daily does not document it).</summary>
    internal static bool TryReadTimestamp(string value, out DateTimeOffset at)
    {
        at = default;
        if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var raw) || raw <= 0) return false;
        try
        {
            at = raw > 100_000_000_000L ? DateTimeOffset.FromUnixTimeMilliseconds(raw) : DateTimeOffset.FromUnixTimeSeconds(raw);
            return true;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }
}

/// <summary>The fields of a Daily webhook event this surface acts on. Everything else in the payload is ignored.</summary>
public sealed record DailyWebhookEvent(string Type, string? EventId, string? RoomName, Guid? TranscriptId,
    double? EventTimestamp = null, double? DurationSeconds = null)
{
    /// <summary>When the transcription began (sent-at minus its duration), when Daily supplied both numbers.</summary>
    public DateTime? StartedAtUtc => EventTimestamp is { } ts && DurationSeconds is { } duration && ts > 0 &&
                                     duration >= 0 && duration < 86_400
        ? DateTime.UnixEpoch.AddSeconds(ts - duration)
        : null;

    public const string TranscriptStarted = "transcript.started";
    public const string TranscriptReady = "transcript.ready-to-download";
    public const string TranscriptError = "transcript.error";

    public bool IsTest => Type == "test";

    public bool IsTranscriptEvent => Type is TranscriptStarted or TranscriptReady or TranscriptError;
}

public static partial class DailyWebhookEvents
{
    [GeneratedRegex("^tims-([0-9a-f]{32})$", RegexOptions.CultureInvariant)]
    private static partial Regex FullIdRoom();

    /// <summary>
    /// Parses a VERIFIED body. Daily's creation probe is <c>{"test":"test"}</c>. Returns null when the body is not a
    /// JSON object or has no string <c>type</c>.
    /// </summary>
    public static DailyWebhookEvent? Parse(ReadOnlySpan<byte> body)
    {
        try
        {
            var reader = new Utf8JsonReader(body, new JsonReaderOptions { MaxDepth = 16 });
            using var document = JsonDocument.ParseValue(ref reader);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (root.TryGetProperty("test", out var test) && test.ValueKind == JsonValueKind.String &&
                !root.TryGetProperty("type", out _)) return new DailyWebhookEvent("test", null, null, null);
            if (!root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) return null;
            var eventId = Bounded(root, "id", 200);
            string? roomName = null;
            Guid? transcriptId = null;
            double? duration = null;
            if (root.TryGetProperty("payload", out var payload) && payload.ValueKind == JsonValueKind.Object)
            {
                roomName = Bounded(payload, "room_name", 128) ?? Bounded(payload, "room", 128);
                var rawId = Bounded(payload, "id", 64) ?? Bounded(payload, "transcript_id", 64);
                if (Guid.TryParse(rawId, out var parsed)) transcriptId = parsed;
                duration = Number(payload, "duration");
            }
            return new DailyWebhookEvent(type.GetString()!, eventId, roomName, transcriptId, Number(root, "event_ts"),
                duration);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// The interview id encoded in a FULL-id room name (<c>tims-</c> + 32 lowercase hex, the only naming both stacks
    /// create today). A legacy 8-hex name does not identify one interview and resolves to nothing.
    /// </summary>
    public static Guid? InterviewIdOf(string? roomName)
    {
        if (roomName is null) return null;
        var match = FullIdRoom().Match(roomName);
        return match.Success && Guid.TryParseExact(match.Groups[1].Value, "N", out var id) ? id : null;
    }

    private static double? Number(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number &&
        value.TryGetDouble(out var number) && double.IsFinite(number)
            ? number
            : null;

    private static string? Bounded(JsonElement element, string name, int max) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String &&
        value.GetString() is { Length: > 0 } text && text.Length <= max
            ? text
            : null;
}
