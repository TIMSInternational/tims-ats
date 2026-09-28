namespace Tims.Domain.Proctoring;

/// <summary>
/// Server-side admission limits for a future, explicitly enabled evidence-intake endpoint.
/// This is deliberately a pure policy, not an enabled route: the candidate identity,
/// assignment ownership, separate recording consent and upload count must come from
/// tenant-scoped database reads, never from a browser-supplied assertion.
/// </summary>
public static class ProctoringCapturePolicy
{
    public const string ConsentVersion = "proctoring-v1";
    public static readonly TimeSpan EvidenceRetention = TimeSpan.FromDays(7);
    public static readonly TimeSpan MaximumSession = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan MinimumCameraInterval = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan MinimumScreenInterval = TimeSpan.FromMinutes(1);

    public static CaptureAdmission Evaluate(CaptureAdmissionInput input)
    {
        if (!input.FeatureEnabled) return CaptureAdmission.Deny("disabled");
        if (!input.CandidateOwnsAssignment) return CaptureAdmission.Deny("not_found");
        if (input.AssignmentStatus != "in_progress" || input.StartedAtUtc is null)
            return CaptureAdmission.Deny("not_in_progress");
        if (input.ConsentVersion != ConsentVersion || input.ConsentedAtUtc is null ||
            input.ConsentRevokedAtUtc is not null ||
            input.ConsentedAtUtc > input.NowUtc || input.ConsentedAtUtc > input.StartedAtUtc)
            return CaptureAdmission.Deny("consent_required");

        var deadline = input.StartedAtUtc.Value.Add(MaximumSession);
        if (input.ExpiresAtUtc is { } expiresAt && expiresAt < deadline) deadline = expiresAt;
        if (input.NowUtc < input.StartedAtUtc || input.NowUtc >= deadline)
            return CaptureAdmission.Deny("session_expired");

        // Only JPEG stills are admitted. Videos, audio and arbitrary files are outside
        // the beta evidence budget and must not get a presigned upload ticket.
        if (input.ContentType != "image/jpeg") return CaptureAdmission.Deny("unsupported_media");
        var (maxBytes, maxCount, minInterval) = input.Kind switch
        {
            CaptureKind.Camera => (128 * 1024, 90, MinimumCameraInterval),
            CaptureKind.Screen => (256 * 1024, 30, MinimumScreenInterval),
            _ => (0, 0, TimeSpan.MaxValue),
        };
        if (input.ByteLength < 1 || input.ByteLength > maxBytes)
            return CaptureAdmission.Deny("invalid_size");
        if (input.AcceptedCount < 0 || input.AcceptedCount >= maxCount)
            return CaptureAdmission.Deny("capture_limit");
        if (input.LastAcceptedAtUtc is { } lastAccepted &&
            (lastAccepted > input.NowUtc || input.NowUtc - lastAccepted < minInterval))
            return CaptureAdmission.Deny("too_frequent");

        return CaptureAdmission.Allow();
    }
}

public enum CaptureKind { Camera, Screen }

/// <summary>All timestamps and counts are server-derived or database-derived UTC values.</summary>
public sealed record CaptureAdmissionInput(
    bool FeatureEnabled,
    bool CandidateOwnsAssignment,
    string AssignmentStatus,
    DateTimeOffset? StartedAtUtc,
    DateTimeOffset? ExpiresAtUtc,
    string? ConsentVersion,
    DateTimeOffset? ConsentedAtUtc,
    DateTimeOffset? ConsentRevokedAtUtc,
    DateTimeOffset NowUtc,
    CaptureKind Kind,
    string ContentType,
    int ByteLength,
    int AcceptedCount,
    DateTimeOffset? LastAcceptedAtUtc);

public sealed record CaptureAdmission(bool Allowed, string? Reason)
{
    public static CaptureAdmission Allow() => new(true, null);
    public static CaptureAdmission Deny(string reason) => new(false, reason);
}
