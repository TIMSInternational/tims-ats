using System.Text.Json;
using Tims.Application.Proctoring;
using Tims.Domain.Proctoring;

namespace Tims.UnitTests.Proctoring;

public sealed class CandidateProctoringUseCaseTests
{
    private static readonly Guid OrgId = Guid.NewGuid();
    private static readonly Guid CandidateId = Guid.NewGuid();
    private static readonly Guid AssignmentId = Guid.NewGuid();

    [Theory]
    [InlineData(false, true, true, true, "consent_required")]
    [InlineData(true, false, true, true, "consent_required")]
    [InlineData(true, true, false, true, "camera_and_screen_required")]
    [InlineData(true, true, true, false, "camera_and_screen_required")]
    public async Task Start_rejects_missing_consent_or_live_capability_before_database(
        bool assessmentConsent, bool proctoringConsent, bool camera, bool screen, string expected)
    {
        var repository = new RecordingRepository();
        var useCase = new CandidateProctoringUseCase(repository);

        var error = await Assert.ThrowsAsync<ProctoringException>(() => useCase.StartAsync(
            OrgId, CandidateId, AssignmentId, assessmentConsent, proctoringConsent,
            camera, screen, null, null, CancellationToken.None));

        Assert.Equal(expected, error.Code);
        Assert.Equal(0, repository.StartCalls);
    }

    [Theory]
    [InlineData("tab_hidden", "low")]
    [InlineData("face_missing", "medium")]
    [InlineData("model_unavailable", "medium")]
    public async Task Reports_only_server_ranked_advisory_signals(string type, string severity)
    {
        var repository = new RecordingRepository();
        var useCase = new CandidateProctoringUseCase(repository);
        var clientInstant = new DateTimeOffset(2026, 9, 24, 10, 0, 0, TimeSpan.FromHours(-5));
        var eventId = Guid.NewGuid();

        await useCase.ReportEventAsync(OrgId, CandidateId, AssignmentId, eventId,
            type, clientInstant, CancellationToken.None);

        Assert.Equal((eventId, type, severity), repository.Reported);
        Assert.Equal(new DateTime(2026, 9, 24, 15, 0, 0, DateTimeKind.Unspecified),
            repository.ClientAt);
    }

    [Theory]
    [InlineData("cheating")]
    [InlineData("heartbeat_gap")]
    [InlineData("")]
    public async Task Rejects_untrusted_or_server_only_signal_types(string type)
    {
        var repository = new RecordingRepository();
        var useCase = new CandidateProctoringUseCase(repository);

        await Assert.ThrowsAsync<ProctoringException>(() => useCase.ReportEventAsync(
            OrgId, CandidateId, AssignmentId, Guid.NewGuid(), type, null, CancellationToken.None));

        Assert.Null(repository.Reported);
    }

    [Fact]
    public void Session_timestamps_serialize_as_unambiguous_utc_instant()
    {
        var dbTimestamp = new DateTime(2026, 9, 24, 15, 12, 34, 123, DateTimeKind.Unspecified);

        Assert.Contains("2026-09-24T15:12:34.123Z",
            JsonSerializer.Serialize(new ProctoringStartResult(Guid.NewGuid(), "active", dbTimestamp)));
        Assert.Contains("2026-09-24T15:12:34.123Z",
            JsonSerializer.Serialize(new ProctoringHeartbeatResult(dbTimestamp, true)));
        Assert.Contains("2026-09-24T15:12:34.123Z",
            JsonSerializer.Serialize(new ProctoringCompleteResult(Guid.NewGuid(), "completed", dbTimestamp)));
    }

    [Fact]
    public void Event_capacity_is_bounded_and_browser_observations_do_not_prove_misconduct()
    {
        Assert.Equal(2_000, ProctoringSignalPolicy.MaximumEventsPerSession);
        Assert.Null(ProctoringSignalPolicy.SeverityFor("heartbeat_gap"));
        Assert.Null(ProctoringSignalPolicy.SeverityFor("cheating"));
    }

    private sealed class RecordingRepository : ICandidateProctoringRepository
    {
        public int StartCalls { get; private set; }
        public (Guid EventId, string Type, string Severity)? Reported { get; private set; }
        public DateTime? ClientAt { get; private set; }

        public Task<Guid?> ResolveOrganizationBySlugAsync(string slug, CancellationToken ct) =>
            Task.FromResult<Guid?>(OrgId);

        public Task<ProctoringStartResult> StartAsync(Guid orgId, Guid candidateId, Guid assignmentId,
            string? ipAddress, string? userAgent, CancellationToken ct)
        {
            StartCalls++;
            return Task.FromResult(new ProctoringStartResult(Guid.NewGuid(), "active", DateTime.UtcNow));
        }

        public Task<ProctoringEventResult> ReportEventAsync(Guid orgId, Guid candidateId,
            Guid assignmentId, Guid eventId, string type, string severity, DateTime? clientAt,
            CancellationToken ct)
        {
            Reported = (eventId, type, severity);
            ClientAt = clientAt;
            return Task.FromResult(new ProctoringEventResult(true, eventId));
        }

        public Task<ProctoringHeartbeatResult> HeartbeatAsync(Guid orgId, Guid candidateId,
            Guid assignmentId, CancellationToken ct) =>
            Task.FromResult(new ProctoringHeartbeatResult(DateTime.UtcNow, true));

        public Task<ProctoringCompleteResult> CompleteAsync(Guid orgId, Guid candidateId,
            Guid assignmentId, CancellationToken ct) =>
            Task.FromResult(new ProctoringCompleteResult(Guid.NewGuid(), "completed", DateTime.UtcNow));
    }
}
