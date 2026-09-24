namespace Tims.Domain.Proctoring;

/// <summary>
/// Server-enforced limits for consented still-image evidence. Client clocks,
/// timers, and counts are never authoritative. The caller must obtain the
/// counters under the session row lock before applying this policy.
/// </summary>
public static class ProctoringEvidencePolicy
{
    public const string MediaConsentVersion = "camera-screen-stills-v1";
    public const int MaximumPeriodicCapturesPerKind = 30;
    public const int MaximumEventCapturesPerKind = 5;
    public const int MaximumCameraBytes = 2 * 1024 * 1024;
    public const int MaximumScreenBytes = 4 * 1024 * 1024;
    public static readonly TimeSpan MinimumPeriodicSpacing = TimeSpan.FromSeconds(55);
    public static readonly TimeSpan CaptureWindow = TimeSpan.FromMinutes(30);

    public static string? ValidateIntent(
        string? kind,
        string? reason,
        DateTime sessionStartedAt,
        DateTime? sessionEndedAt,
        DateTime serverNow,
        int periodicCount,
        int eventCount,
        DateTime? lastPeriodicAt)
    {
        if (kind is not ("camera" or "screen") || reason is not ("periodic" or "event"))
            return "invalid_evidence_kind_or_reason";
        if (sessionEndedAt is not null || serverNow < sessionStartedAt
            || serverNow >= sessionStartedAt + CaptureWindow)
            return "evidence_capture_window_closed";
        if (reason == "event")
            return eventCount >= MaximumEventCapturesPerKind ? "evidence_event_limit" : null;
        if (periodicCount >= MaximumPeriodicCapturesPerKind)
            return "evidence_periodic_limit";
        if (lastPeriodicAt is { } previous && serverNow - previous < MinimumPeriodicSpacing)
            return "evidence_periodic_too_soon";
        return null;
    }

    public static int? MaximumBytesFor(string? kind, string? contentType) =>
        contentType is "image/jpeg" or "image/webp"
            ? kind switch
            {
                "camera" => MaximumCameraBytes,
                "screen" => MaximumScreenBytes,
                _ => null,
            }
            : null;
}
