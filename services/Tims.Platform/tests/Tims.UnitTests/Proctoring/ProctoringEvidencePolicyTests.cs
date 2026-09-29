using Tims.Domain.Proctoring;

namespace Tims.UnitTests.Proctoring;

public sealed class ProctoringEvidencePolicyTests
{
    private static readonly DateTime Started = new(2026, 9, 24, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Periodic_capture_uses_server_spacing_and_a_30_minute_window()
    {
        Assert.Null(Check("camera", "periodic", Started.AddSeconds(55), 1, 0, Started));
        Assert.Equal("evidence_periodic_too_soon",
            Check("camera", "periodic", Started.AddSeconds(54), 1, 0, Started));
        Assert.Equal("evidence_periodic_limit",
            Check("screen", "periodic", Started.AddMinutes(29), 30, 0, null));
        Assert.Equal("evidence_capture_window_closed",
            Check("camera", "periodic", Started.AddMinutes(30), 29, 0, null));
    }

    [Fact]
    public void Event_and_periodic_budgets_are_independent_per_media_kind()
    {
        Assert.Null(Check("screen", "event", Started.AddMinutes(1), 30, 4, null));
        Assert.Equal("evidence_event_limit",
            Check("screen", "event", Started.AddMinutes(1), 0, 5, null));
        Assert.Equal("invalid_evidence_kind_or_reason",
            Check("audio", "event", Started.AddMinutes(1), 0, 0, null));
        Assert.Equal("invalid_evidence_kind_or_reason",
            Check("camera", "continuous", Started.AddMinutes(1), 0, 0, null));
    }

    [Fact]
    public void Ended_sessions_and_unsupported_media_are_denied()
    {
        Assert.Equal("evidence_capture_window_closed", ProctoringEvidencePolicy.ValidateIntent(
            "camera", "event", Started, Started.AddMinutes(2), Started.AddMinutes(3), 0, 0, null));
        Assert.Equal(ProctoringEvidencePolicy.MaximumCameraBytes,
            ProctoringEvidencePolicy.MaximumBytesFor("camera", "image/jpeg"));
        Assert.Equal(ProctoringEvidencePolicy.MaximumScreenBytes,
            ProctoringEvidencePolicy.MaximumBytesFor("screen", "image/webp"));
        Assert.Null(ProctoringEvidencePolicy.MaximumBytesFor("camera", "image/png"));
        Assert.Null(ProctoringEvidencePolicy.MaximumBytesFor("audio", "image/jpeg"));
    }

    private static string? Check(string kind, string reason, DateTime now,
        int periodicCount, int eventCount, DateTime? lastPeriodicAt) =>
        ProctoringEvidencePolicy.ValidateIntent(kind, reason, Started, null, now,
            periodicCount, eventCount, lastPeriodicAt);
}
