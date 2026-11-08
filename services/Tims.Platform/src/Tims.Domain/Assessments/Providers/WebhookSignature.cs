using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Tims.Domain.Assessments.Providers;

/// <summary>Outcome of <see cref="WebhookSignature.Verify"/>. Only <see cref="Valid"/> may be processed.</summary>
public enum WebhookSignatureCheck
{
    Valid,

    /// <summary>No <c>TIMS-Signature</c> header.</summary>
    Missing,

    /// <summary>The header does not match <c>t=&lt;10 digits&gt;,v1=&lt;hex64&gt;[,v1=&lt;hex64&gt;]</c>.</summary>
    Malformed,

    /// <summary><c>|now - t| &gt; 300</c> seconds: a replayed or badly delayed delivery.</summary>
    OutsideReplayWindow,

    /// <summary>No <c>v1</c> matches any configured signing secret.</summary>
    Mismatch,

    /// <summary>The receiver has no usable signing secret: nothing can be verified, so nothing is accepted.</summary>
    NoSecretConfigured,
}

/// <summary>
/// The contract's webhook signature (<c>tims-assessments.v1.yaml</c>, <c>components.parameters.WebhookSignature</c>):
/// <c>TIMS-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;[,v1=&lt;hex&gt;]</c>, where <c>v1</c> is the lowercase hex
/// HMAC-SHA256 with key = the subscription's signing secret (UTF-8) over <c>&lt;t&gt; + "." + raw body bytes</c>.
/// During a secret rotation the sender includes one <c>v1</c> per active secret, and the receiver holds up to two
/// secrets (current, previous); any match is accepted.
///
/// <para>Receiver rules, in the contract's order: reject <c>|now - t| &gt; 300</c> s (the replay window), then compare
/// every <c>v1</c> against every secret in constant time. De-duplication on <c>TIMS-Event-Id</c> (a replay inside the
/// window) is the caller's job and is done by the webhook inbox's unique key.</para>
/// </summary>
public static partial class WebhookSignature
{
    public const string HeaderName = "TIMS-Signature";
    public const int ReplayWindowSeconds = 300;
    public const int MaxHeaderLength = 512;

    public static WebhookSignatureCheck Verify(
        string? header, ReadOnlySpan<byte> rawBody, IReadOnlyList<string> secrets, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(secrets);
        var usable = secrets.Where(s => !string.IsNullOrEmpty(s)).ToList();
        if (usable.Count == 0)
        {
            return WebhookSignatureCheck.NoSecretConfigured;
        }

        if (string.IsNullOrEmpty(header))
        {
            return WebhookSignatureCheck.Missing;
        }

        if (!TryParse(header, out var timestamp, out var signatures))
        {
            return WebhookSignatureCheck.Malformed;
        }

        var skew = now.ToUnixTimeSeconds() - timestamp;
        if (skew > ReplayWindowSeconds || skew < -ReplayWindowSeconds)
        {
            return WebhookSignatureCheck.OutsideReplayWindow;
        }

        var matched = false;
        foreach (var secret in usable)
        {
            var expected = ComputeBytes(secret, timestamp, rawBody);
            foreach (var candidate in signatures)
            {
                // Constant time per comparison; every pair is compared (no early exit on a match), so the timing does
                // not reveal which secret or which v1 matched.
                matched |= CryptographicOperations.FixedTimeEquals(expected, candidate);
            }
        }

        return matched ? WebhookSignatureCheck.Valid : WebhookSignatureCheck.Mismatch;
    }

    /// <summary>The <c>v1</c> value for a secret, timestamp and body (lowercase hex). Used by tests and fakes.</summary>
    public static string Compute(string secret, long timestamp, ReadOnlySpan<byte> rawBody) =>
        Convert.ToHexStringLower(ComputeBytes(secret, timestamp, rawBody));

    /// <summary>A complete header value for one secret. Used by tests and fakes.</summary>
    public static string BuildHeader(string secret, long timestamp, ReadOnlySpan<byte> rawBody) =>
        $"t={timestamp.ToString(CultureInfo.InvariantCulture)},v1={Compute(secret, timestamp, rawBody)}";

    private static byte[] ComputeBytes(string secret, long timestamp, ReadOnlySpan<byte> rawBody)
    {
        var prefix = Encoding.ASCII.GetBytes(timestamp.ToString(CultureInfo.InvariantCulture) + ".");
        var message = new byte[prefix.Length + rawBody.Length];
        prefix.CopyTo(message, 0);
        rawBody.CopyTo(message.AsSpan(prefix.Length));
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), message);
    }

    internal static bool TryParse(string header, out long timestamp, out IReadOnlyList<byte[]> signatures)
    {
        timestamp = 0;
        signatures = [];
        if (header.Length > MaxHeaderLength)
        {
            return false;
        }

        var match = HeaderRegex().Match(header);
        if (!match.Success
            || !long.TryParse(match.Groups["t"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out timestamp))
        {
            return false;
        }

        var parsed = new List<byte[]> { Convert.FromHexString(match.Groups["v1"].Value) };
        if (match.Groups["v1b"].Success)
        {
            parsed.Add(Convert.FromHexString(match.Groups["v1b"].Value));
        }

        signatures = parsed;
        return true;
    }

    // Exactly the contract's pattern: ^t=[0-9]{10},v1=[a-f0-9]{64}(,v1=[a-f0-9]{64})?$
    [GeneratedRegex("^t=(?<t>[0-9]{10}),v1=(?<v1>[a-f0-9]{64})(,v1=(?<v1b>[a-f0-9]{64}))?$",
        RegexOptions.CultureInvariant | RegexOptions.ExplicitCapture, matchTimeoutMilliseconds: 100)]
    private static partial Regex HeaderRegex();
}
