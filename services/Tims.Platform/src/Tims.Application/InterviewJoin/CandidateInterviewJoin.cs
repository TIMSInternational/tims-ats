using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Tims.Application.InterviewJoin;

/// <summary>
/// Candidate video-interview join (WP-H). The emailed token is the ENTIRE credential: it is looked up by
/// SHA-256 hash only, before any tenant context exists, and every later read/write is filtered by the
/// organization resolved from that row. A <c>ready</c> join mints a short-lived NON-owner Daily token.
/// </summary>
public sealed partial class CandidateInterviewJoin(ICandidateInterviewJoinRepository repository,
    ICandidateVideoProvider video, TimeProvider clock)
{
    /// <summary>The waiting-room window: the join opens this long before the scheduled start.</summary>
    public static readonly TimeSpan EarlyJoin = TimeSpan.FromMinutes(15);

    /// <summary>The link keeps working this long after the scheduled end (overruns).</summary>
    public static readonly TimeSpan GracePeriod = TimeSpan.FromMinutes(30);

    /// <summary>Upper bound on one candidate meeting token's lifetime.</summary>
    public static readonly TimeSpan MaxTokenLifetime = TimeSpan.FromHours(2);

    public const string FallbackDisplayName = "Candidato";
    public const int MaxDisplayNameLength = 60;

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)]
    private static partial Regex TokenFormat();

    [GeneratedRegex("^[A-Za-z0-9_-]{1,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex RoomNameFormat();

    /// <summary>32 random bytes, base64url without padding: exactly 43 characters of [A-Za-z0-9_-].</summary>
    public static bool ValidToken(string? token) => token is not null && TokenFormat().IsMatch(token);

    /// <summary>Lowercase hex SHA-256 of the UTF-8 token — the value stored in candidate_join_token_hash.</summary>
    public static string HashToken(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>The TS video.service room-name convention: <c>tims-</c> + the first 8 characters of the id.</summary>
    public static string RoomNameFor(Guid interviewId) => "tims-" + interviewId.ToString("D")[..8];

    /// <summary>
    /// Accepts only an https Daily room URL (<c>https://{sub}.daily.co/{room}</c>, no credentials, query or
    /// fragment) and extracts the room name — a stored meeting_url that is anything else is never used.
    /// </summary>
    public static bool TryDailyRoom(string? url, out string roomName)
    {
        roomName = "";
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || !uri.IsDefaultPort ||
            !uri.Host.EndsWith(".daily.co", StringComparison.OrdinalIgnoreCase)) return false;
        var name = uri.AbsolutePath.TrimStart('/');
        if (!RoomNameFormat().IsMatch(name)) return false;
        roomName = name;
        return true;
    }

    /// <summary>
    /// The name shown to the interviewers: first + last, control/format characters removed, whitespace
    /// collapsed, bounded; falls back to <see cref="FallbackDisplayName"/>.
    /// </summary>
    public static string DisplayName(string? firstName, string? lastName)
    {
        var builder = new StringBuilder();
        foreach (var ch in $"{firstName} {lastName}")
        {
            var category = char.GetUnicodeCategory(ch);
            if (char.IsControl(ch) || category is UnicodeCategory.Format or UnicodeCategory.LineSeparator
                    or UnicodeCategory.ParagraphSeparator or UnicodeCategory.PrivateUse) continue;
            if (char.IsWhiteSpace(ch))
            {
                if (builder.Length > 0 && builder[^1] != ' ') builder.Append(' ');
                continue;
            }
            builder.Append(ch);
        }
        var name = builder.ToString().Trim();
        if (name.Length > MaxDisplayNameLength)
        {
            var cut = MaxDisplayNameLength;
            if (char.IsHighSurrogate(name[cut - 1])) cut--;
            name = name[..cut].TrimEnd();
        }
        return name.Length == 0 ? FallbackDisplayName : name;
    }

    /// <summary>The moment the link stops working: min(token expiry, scheduled end + grace).</summary>
    public static DateTime ClosesAt(CandidateJoinInterview interview)
    {
        var close = DateTime.SpecifyKind(interview.ScheduledAt, DateTimeKind.Utc)
            .AddMinutes(Math.Max(0, interview.DurationMinutes)).Add(GracePeriod);
        return interview.TokenExpiresAt is { } expires && expires < close
            ? DateTime.SpecifyKind(expires, DateTimeKind.Utc)
            : close;
    }

    /// <summary>Pure window/status evaluation. Returns null when the interview is joinable right now.</summary>
    public static CandidateJoinResult? Evaluate(CandidateJoinInterview interview, DateTime nowUtc)
    {
        if (interview.Status == "cancelled" || interview.CancelledAt is not null)
            return new(CandidateJoinOutcomes.Cancelled);
        if (interview.Status is "completed" or "no_show" || nowUtc >= ClosesAt(interview))
            return new(CandidateJoinOutcomes.Expired);
        if (!string.Equals(interview.Type, "video", StringComparison.Ordinal))
            return new(CandidateJoinOutcomes.NotVideo);
        var scheduled = DateTime.SpecifyKind(interview.ScheduledAt, DateTimeKind.Utc);
        var opensAt = scheduled - EarlyJoin;
        if (nowUtc < opensAt) return new(CandidateJoinOutcomes.TooEarly, scheduled, opensAt);
        return null;
    }

    public async Task<CandidateJoinResult> JoinAsync(string token, string? ipAddress, string? userAgent,
        CancellationToken ct)
    {
        if (!ValidToken(token)) return new(CandidateJoinOutcomes.Invalid);
        var interview = await repository.FindByTokenHashAsync(HashToken(token), ct);
        if (interview is null) return new(CandidateJoinOutcomes.Invalid);

        var now = clock.GetUtcNow();
        var result = Evaluate(interview, now.UtcDateTime) ?? await ReadyAsync(interview, now, ct);
        var recorded = await repository.RecordAsync(
            new(interview.Id, interview.OrganizationId, result.Outcome, ipAddress, userAgent), ct);
        // Fail closed: a join that cannot be audited is not handed out.
        return result.Outcome == CandidateJoinOutcomes.Ready && !recorded
            ? new(CandidateJoinOutcomes.Unavailable)
            : result;
    }

    private async Task<CandidateJoinResult> ReadyAsync(CandidateJoinInterview interview, DateTimeOffset now,
        CancellationToken ct)
    {
        var unavailable = new CandidateJoinResult(CandidateJoinOutcomes.Unavailable);
        if (!video.IsConfigured) return unavailable;
        var closesAt = new DateTimeOffset(ClosesAt(interview), TimeSpan.Zero);

        string roomName;
        VideoRoom? room;
        if (interview.MeetingUrl is not null)
        {
            if (!TryDailyRoom(interview.MeetingUrl, out roomName)) return unavailable;
            // Also re-extends a room created earlier by staff with a shorter lifetime.
            room = await video.EnsureRoomAsync(roomName, closesAt, ct);
        }
        else
        {
            var created = await video.EnsureRoomAsync(RoomNameFor(interview.Id), closesAt, ct);
            if (created is null || !TryDailyRoom(created.Url, out _)) return unavailable;
            var stored = await repository.ClaimMeetingUrlAsync(interview.Id, interview.OrganizationId,
                created.Url, ct);
            if (!TryDailyRoom(stored, out roomName)) return unavailable;
            // A concurrent writer stored a different room first: join THAT one, never a second room.
            room = stored == created.Url ? created : await video.EnsureRoomAsync(roomName, closesAt, ct);
        }
        if (room is null || !TryDailyRoom(room.Url, out var ensuredName) || ensuredName != roomName)
            return unavailable;

        var notBefore = new DateTimeOffset(DateTime.SpecifyKind(interview.ScheduledAt, DateTimeKind.Utc), TimeSpan.Zero)
            - EarlyJoin;
        var cap = now + MaxTokenLifetime;
        var expiresAt = cap < closesAt ? cap : closesAt;
        var guestToken = await video.CreateGuestTokenAsync(roomName,
            DisplayName(interview.CandidateFirstName, interview.CandidateLastName), notBefore, expiresAt, ct);
        if (string.IsNullOrEmpty(guestToken)) return unavailable;
        return new(CandidateJoinOutcomes.Ready, JoinUrl: room.Url + "?t=" + Uri.EscapeDataString(guestToken));
    }
}
