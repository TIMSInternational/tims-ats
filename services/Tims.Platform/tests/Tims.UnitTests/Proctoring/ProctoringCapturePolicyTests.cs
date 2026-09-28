using Tims.Domain.Proctoring;

namespace Tims.UnitTests.Proctoring;

public sealed class ProctoringCapturePolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 28, 12, 0, 0, TimeSpan.Zero);

    private static CaptureAdmissionInput Valid(CaptureKind kind = CaptureKind.Camera) => new(
        FeatureEnabled: true,
        CandidateOwnsAssignment: true,
        AssignmentStatus: "in_progress",
        StartedAtUtc: Now.AddMinutes(-5),
        ExpiresAtUtc: Now.AddHours(1),
        ConsentVersion: ProctoringCapturePolicy.ConsentVersion,
        ConsentedAtUtc: Now.AddMinutes(-6),
        ConsentRevokedAtUtc: null,
        NowUtc: Now,
        Kind: kind,
        ContentType: "image/jpeg",
        ByteLength: 100 * 1024,
        AcceptedCount: 1,
        LastAcceptedAtUtc: Now.AddMinutes(-2));

    [Theory]
    [InlineData(CaptureKind.Camera)]
    [InlineData(CaptureKind.Screen)]
    public void Allows_valid_small_jpeg_for_consented_active_assignment(CaptureKind kind) =>
        Assert.True(ProctoringCapturePolicy.Evaluate(Valid(kind)).Allowed);

    [Fact]
    public void Denies_disabled_feature_before_all_other_checks() =>
        Assert.Equal("disabled", ProctoringCapturePolicy.Evaluate(Valid() with { FeatureEnabled = false }).Reason);

    [Fact]
    public void Denies_foreign_assignment_without_revealing_its_state() =>
        Assert.Equal("not_found", ProctoringCapturePolicy.Evaluate(Valid() with { CandidateOwnsAssignment = false }).Reason);

    [Theory]
    [InlineData("assigned")]
    [InlineData("completed")]
    [InlineData("cancelled")]
    public void Denies_non_running_assignment(string status) =>
        Assert.Equal("not_in_progress", ProctoringCapturePolicy.Evaluate(Valid() with { AssignmentStatus = status }).Reason);

    [Fact]
    public void Denies_general_assessment_consent_in_place_of_recording_consent() =>
        Assert.Equal("consent_required", ProctoringCapturePolicy.Evaluate(Valid() with { ConsentVersion = "habeas-data-v1" }).Reason);

    [Fact]
    public void Denies_consent_after_assessment_started() =>
        Assert.Equal("consent_required", ProctoringCapturePolicy.Evaluate(Valid() with { ConsentedAtUtc = Now }).Reason);

    [Fact]
    public void Denies_revoked_consent() =>
        Assert.Equal("consent_required", ProctoringCapturePolicy.Evaluate(Valid() with { ConsentRevokedAtUtc = Now.AddMinutes(-1) }).Reason);

    [Fact]
    public void Denies_after_thirty_minutes_even_when_assignment_expiry_is_later() =>
        Assert.Equal("session_expired", ProctoringCapturePolicy.Evaluate(Valid() with
        {
            StartedAtUtc = Now.AddMinutes(-30),
            ConsentedAtUtc = Now.AddMinutes(-31),
        }).Reason);

    [Fact]
    public void Denies_when_assignment_expiry_is_earlier() =>
        Assert.Equal("session_expired", ProctoringCapturePolicy.Evaluate(Valid() with { ExpiresAtUtc = Now }).Reason);

    [Fact]
    public void Denies_video_and_oversized_camera_frame()
    {
        Assert.Equal("unsupported_media", ProctoringCapturePolicy.Evaluate(Valid() with { ContentType = "video/webm" }).Reason);
        Assert.Equal("invalid_size", ProctoringCapturePolicy.Evaluate(Valid() with { ByteLength = 128 * 1024 + 1 }).Reason);
    }

    [Fact]
    public void Applies_separate_screen_limit_and_interval()
    {
        Assert.Equal("invalid_size", ProctoringCapturePolicy.Evaluate(Valid(CaptureKind.Screen) with { ByteLength = 256 * 1024 + 1 }).Reason);
        Assert.Equal("capture_limit", ProctoringCapturePolicy.Evaluate(Valid(CaptureKind.Screen) with { AcceptedCount = 30 }).Reason);
        Assert.Equal("too_frequent", ProctoringCapturePolicy.Evaluate(Valid(CaptureKind.Screen) with { LastAcceptedAtUtc = Now.AddSeconds(-59) }).Reason);
    }

    [Fact]
    public void Applies_separate_camera_limit_and_interval()
    {
        Assert.Equal("capture_limit", ProctoringCapturePolicy.Evaluate(Valid() with { AcceptedCount = 90 }).Reason);
        Assert.Equal("too_frequent", ProctoringCapturePolicy.Evaluate(Valid() with { LastAcceptedAtUtc = Now.AddSeconds(-19) }).Reason);
    }
}
