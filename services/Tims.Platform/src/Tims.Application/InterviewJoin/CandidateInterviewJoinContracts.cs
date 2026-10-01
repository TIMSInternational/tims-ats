namespace Tims.Application.InterviewJoin;

/// <summary>The only outcome strings the candidate join page ever receives. Nothing finer-grained leaks.</summary>
public static class CandidateJoinOutcomes
{
    public const string Invalid = "invalid";
    public const string Cancelled = "cancelled";
    public const string Expired = "expired";
    public const string TooEarly = "too_early";
    public const string NotVideo = "not_video";
    public const string Ready = "ready";
    public const string Unavailable = "unavailable";
}

/// <summary>
/// Public response of <c>POST /interviews/candidate-join</c>. <see cref="ScheduledAt"/> and
/// <see cref="JoinOpensAt"/> are only set for <c>too_early</c>; <see cref="JoinUrl"/> only for <c>ready</c>.
/// </summary>
public sealed record CandidateJoinResult(string Outcome, DateTime? ScheduledAt = null, DateTime? JoinOpensAt = null,
    string? JoinUrl = null);

/// <summary>
/// The interview resolved by the join-token hash, before any tenant context exists.
/// <see cref="ApplicationClosed"/> is true when the interview's application was rejected or withdrawn (or no longer
/// resolves in the interview's organization); <see cref="OrganizationInactive"/> when the organization is suspended
/// (<c>is_active = false</c>) or soft-deleted (#329 item 5). Either revokes the link before its time window does.
/// </summary>
public sealed record CandidateJoinInterview(Guid Id, Guid OrganizationId, string Type, string Status,
    DateTime ScheduledAt, int DurationMinutes, DateTime? CancelledAt, DateTime? TokenExpiresAt, string? MeetingUrl,
    string? CandidateFirstName, string? CandidateLastName, bool ApplicationClosed = false,
    bool OrganizationInactive = false);

/// <summary>What the join audit records. Never the token, never the token hash.</summary>
public sealed record CandidateJoinAudit(Guid InterviewId, Guid OrganizationId, string Outcome, string? IpAddress,
    string? UserAgent);

public sealed record VideoRoom(string Name, string Url);

public interface ICandidateInterviewJoinRepository
{
    /// <summary>Capability lookup by exact SHA-256 hash (pre-tenant: the hash IS the credential).</summary>
    Task<CandidateJoinInterview?> FindByTokenHashAsync(string tokenHash, CancellationToken ct);

    /// <summary>
    /// Sets <c>meeting_url</c> only while it is still NULL, filtered by the RESOLVED organization, and returns
    /// the value stored afterwards (a concurrent writer may have won).
    /// </summary>
    Task<string?> ClaimMeetingUrlAsync(Guid interviewId, Guid organizationId, string roomUrl, CancellationToken ct);

    /// <summary>Appends the join audit row. Returns false (never throws) when the row could not be written.</summary>
    Task<bool> RecordAsync(CandidateJoinAudit audit, CancellationToken ct);

    /// <summary>
    /// True when any interview OTHER than <paramref name="interviewId"/> stores a meeting_url naming
    /// <paramref name="roomName"/>, in ANY organization (#329 item 1). Pre-tenant by necessity: the collision this
    /// detects is cross-tenant. Fails closed — returns true when the answer cannot be established.
    /// </summary>
    Task<bool> IsRoomSharedAsync(Guid interviewId, string roomName, CancellationToken ct);
}

public interface ICandidateVideoProvider
{
    bool IsConfigured { get; }

    /// <summary>Creates the private room, or reuses it, guaranteeing it stays open until at least <paramref name="openUntil"/>.</summary>
    Task<VideoRoom?> EnsureRoomAsync(string roomName, DateTimeOffset openUntil, CancellationToken ct);

    /// <summary>Mints a NON-owner meeting token. Returns null on any provider failure.</summary>
    Task<string?> CreateGuestTokenAsync(string roomName, string userName, DateTimeOffset notBefore,
        DateTimeOffset expiresAt, CancellationToken ct);
}
