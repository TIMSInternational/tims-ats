namespace Tims.Domain.Proctoring;

/// <summary>
/// Browser track and focus reports are unverified review cues, never a
/// finding of misconduct. Risk priority is derived on the server; callers may
/// not submit their own severity or arbitrary event names.
/// </summary>
public static class ProctoringSignalPolicy
{
    public const int MaximumEventsPerSession = 2_000;
    public const int HeartbeatGapSeconds = 90;
    public const string ConsentVersion = "camera-screen-signals-v1";
    public const string AssessmentConsentVersion = "habeas-data-assessment-v1";

    public static string? SeverityFor(string type) => type switch
    {
        "tab_hidden" or "focus_lost" => "low",
        "camera_stopped" or "screen_share_stopped" => "medium",
        "media_capture_stopped" => "low",
        _ => null,
    };
}
