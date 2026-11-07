using System.Text.Json;
using Tims.Application.InterviewJoin;
using Tims.Application.InterviewTranscription;
using static Tims.Application.InterviewTranscription.InterviewTranscriptionConstants;

namespace Tims.UnitTests.InterviewTranscription;

/// <summary>The candidate join's transcription consent step (Platform:InterviewTranscriptionEnabled).</summary>
public sealed class CandidateJoinConsentStepTests
{
    private const string Token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
    private static readonly DateTime Start = new(2026, 11, 6, 15, 0, 0, DateTimeKind.Utc);
    private static readonly Guid InterviewId = Guid.Parse("1234abcd-0000-4000-8000-000000000001");
    private static readonly Guid OrgId = Guid.Parse("00000000-0000-4000-8000-0000000000aa");

    private sealed class Repository : ICandidateInterviewJoinRepository
    {
        public List<CandidateJoinAudit> Audits { get; } = [];
        public string? MeetingUrl { get; set; }

        public Task<CandidateJoinInterview?> FindByTokenHashAsync(string tokenHash, CancellationToken ct) =>
            Task.FromResult<CandidateJoinInterview?>(new(InterviewId, OrgId, "video", "scheduled", Start, 60, null,
                Start.AddMinutes(90), MeetingUrl, "Ana", "Pérez"));

        public Task<string?> ClaimMeetingUrlAsync(Guid interviewId, Guid organizationId, string roomUrl,
            CancellationToken ct) => Task.FromResult<string?>(roomUrl);

        public Task<bool> RecordAsync(CandidateJoinAudit audit, CancellationToken ct)
        {
            Audits.Add(audit);
            return Task.FromResult(true);
        }

        public Task<bool> IsRoomSharedAsync(Guid interviewId, string roomName, CancellationToken ct) =>
            Task.FromResult(false);
    }

    private sealed class Video : ICandidateVideoProvider
    {
        public int Mints { get; private set; }
        public int Rooms { get; private set; }
        public bool IsConfigured => true;

        public Task<VideoRoom?> EnsureRoomAsync(string roomName, DateTimeOffset openUntil, CancellationToken ct)
        {
            Rooms++;
            return Task.FromResult<VideoRoom?>(new(roomName, "https://tims.daily.co/" + roomName));
        }

        public Task<string?> CreateGuestTokenAsync(string roomName, string userName, DateTimeOffset notBefore,
            DateTimeOffset expiresAt, CancellationToken ct)
        {
            Mints++;
            return Task.FromResult<string?>("guest.token");
        }
    }

    private sealed class Ledger : IInterviewConsentLedger
    {
        public bool Writes { get; set; } = true;
        public List<InterviewConsentRecord> Records { get; } = [];

        public Task<bool> RecordConsentAsync(InterviewConsentRecord record, CancellationToken ct)
        {
            if (Writes) Records.Add(record);
            return Task.FromResult(Writes);
        }

        public Task<IReadOnlyList<InterviewConsentRecord>> ListConsentsAsync(Guid organizationId, Guid interviewId,
            CancellationToken ct) => Task.FromResult<IReadOnlyList<InterviewConsentRecord>>(Records);

        public string? LatestState { get; set; }

        public Task<RecordedCandidateDecision?> RecordCandidateDecisionAsync(InterviewConsentRecord record,
            CancellationToken ct)
        {
            if (Writes) Records.Add(record);
            return Task.FromResult(Writes ? new RecordedCandidateDecision(LatestState) : null);
        }
    }

    private sealed class Transcriber : ITranscriptionProvider
    {
        public bool IsConfigured => true;
        public bool StopSucceeds { get; set; } = true;
        public List<string> Stopped { get; } = [];

        public Task<TranscriptionStartResult> StartAsync(string roomName, string language, CancellationToken ct) =>
            Task.FromResult(TranscriptionStartResult.Started);

        public Task<string?> DownloadTranscriptAsync(Guid transcriptId, CancellationToken ct) =>
            Task.FromResult<string?>(null);

        public Task<bool> DeleteTranscriptAsync(Guid transcriptId, CancellationToken ct) => Task.FromResult(true);

        public Task<bool> StopAsync(string roomName, CancellationToken ct)
        {
            Stopped.Add(roomName);
            return Task.FromResult(StopSucceeds);
        }
    }

    private sealed class Clock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(now, TimeSpan.Zero);
    }

    private static readonly Transcriber SharedTranscriber = new();

    private static (CandidateInterviewJoin Join, Video Video, Ledger Ledger, Repository Repo) Build(bool enabled,
        DateTime? now = null, Transcriber? transcriber = null)
    {
        var repo = new Repository();
        var video = new Video();
        var ledger = new Ledger();
        return (new CandidateInterviewJoin(repo, video, new Clock(now ?? Start.AddMinutes(-5)),
            new InterviewTranscriptionSettings(enabled), ledger, transcriber ?? SharedTranscriber), video, ledger, repo);
    }

    [Fact]
    public async Task Declining_on_rejoin_stops_a_running_transcription_before_the_candidate_is_admitted()
    {
        // Codex P1: accept → staff starts → the candidate rejoins and declines → capture must stop now.
        var transcriber = new Transcriber();
        var (join, video, ledger, repo) = Build(enabled: true, transcriber: transcriber);
        repo.MeetingUrl = "https://tims.daily.co/" + CandidateInterviewJoin.RoomNameFor(InterviewId);
        ledger.LatestState = TranscriptStates.InProgress;
        var result = await join.JoinAsync(Token, new CandidateRecordingDecision(Declined, ConsentTextVersion), null,
            null, default);
        Assert.Equal(CandidateJoinOutcomes.Ready, result.Outcome);
        Assert.Equal(CandidateInterviewJoin.RoomNameFor(InterviewId), Assert.Single(transcriber.Stopped));

        transcriber.StopSucceeds = false;
        var failed = await join.JoinAsync(Token, new CandidateRecordingDecision(Declined, ConsentTextVersion), null,
            null, default);
        Assert.Equal(CandidateJoinOutcomes.Unavailable, failed.Outcome);
        Assert.Equal(1, video.Mints);
    }

    [Fact]
    public async Task A_decline_during_an_in_flight_start_waits_for_it_and_is_not_admitted_while_the_stop_fails()
    {
        // Codex P1 (re-run 2): staff passed the consent check and called Daily; the candidate declined before the
        // start's `requested` event was written, saw no transcription and was admitted; the start then finished and
        // its stop failed, so a declined candidate sat in a transcribed call. The staff start and this join share
        // ONE repository (and its transcription lock), as in production.
        var shared = new InterviewTranscriptionUseCaseTests.Repository();
        var provider = new InterviewTranscriptionUseCaseTests.Provider { StopSucceeds = false };
        var useCase = new InterviewTranscriptionUseCase(shared, provider);
        var staff = Guid.NewGuid();
        await shared.RecordConsentAsync(new(InterviewId, OrgId, SubjectCandidate, null, Accepted, ConsentTextVersion), default);
        await shared.RecordConsentAsync(new(InterviewId, OrgId, SubjectStaff, staff, Accepted, ConsentTextVersion), default);
        var room = CandidateInterviewJoin.RoomNameFor(InterviewId);
        var video = new Video();
        var join = new CandidateInterviewJoin(new Repository { MeetingUrl = "https://tims.daily.co/" + room }, video,
            new Clock(Start.AddMinutes(-5)), new InterviewTranscriptionSettings(true), shared, provider);
        var decline = new CandidateRecordingDecision(Declined, ConsentTextVersion);

        Task<CandidateJoinResult>? declining = null;
        provider.OnStart = async () =>
        {
            // The candidate declines while Daily is starting the transcription.
            declining = Task.Run(() => join.JoinAsync(Token, decline, null, null, default));
            for (var i = 0; i < 500 && shared.LockWaiters == 0 && !declining.IsCompleted; i++) await Task.Delay(10);
        };
        var started = await useCase.StartAsync(OrgId, staff, InterviewId, "es", default);
        var joined = await declining!.WaitAsync(TimeSpan.FromSeconds(10));

        Assert.Equal(CandidateJoinOutcomes.Unavailable, joined.Outcome); // never admitted into the transcribed call
        Assert.Equal(0, video.Mints);
        Assert.Equal(room, Assert.Single(provider.Stopped)); // the join saw the start and tried to stop it
        Assert.Equal(200, started.Status); // the candidate had accepted when the start read consent

        // The failed stop is not forgotten: the start is still the latest state, so the next join stops it first.
        provider.StopSucceeds = true;
        Assert.Equal(CandidateJoinOutcomes.Ready, (await join.JoinAsync(Token, decline, null, null, default)).Outcome);
        Assert.Equal(2, provider.Stopped.Count);
        Assert.Equal(1, video.Mints);
    }

    [Theory]
    [InlineData("accepted", "in_progress")]
    [InlineData("declined", "ready")]
    [InlineData("declined", null)]
    public async Task Nothing_is_stopped_when_accepting_or_when_no_transcription_runs(string decision, string? state)
    {
        var transcriber = new Transcriber();
        var (join, _, ledger, repo) = Build(enabled: true, transcriber: transcriber);
        repo.MeetingUrl = "https://tims.daily.co/" + CandidateInterviewJoin.RoomNameFor(InterviewId);
        ledger.LatestState = state;
        var result = await join.JoinAsync(Token, new CandidateRecordingDecision(decision, ConsentTextVersion), null,
            null, default);
        Assert.Equal(CandidateJoinOutcomes.Ready, result.Outcome);
        Assert.Empty(transcriber.Stopped);
    }

    [Fact]
    public async Task With_the_flag_off_the_join_is_unchanged_and_the_result_has_no_consent_field()
    {
        var (join, video, ledger, _) = Build(enabled: false);
        var result = await join.JoinAsync(Token, new CandidateRecordingDecision(Accepted, ConsentTextVersion), null,
            null, default);
        Assert.Equal(CandidateJoinOutcomes.Ready, result.Outcome);
        Assert.Null(result.ConsentVersion);
        Assert.Empty(ledger.Records); // a decision is ignored, never recorded, while the feature is dark
        Assert.Equal(1, video.Mints);
        var json = JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("consentVersion", json);
        Assert.False(join.AsksForTranscriptionConsent);
    }

    [Fact]
    public async Task With_the_flag_on_a_joinable_interview_asks_first_and_mints_nothing()
    {
        var (join, video, ledger, repo) = Build(enabled: true);
        var result = await join.JoinAsync(Token, null, null, default);
        Assert.Equal(CandidateJoinOutcomes.ConsentRequired, result.Outcome);
        Assert.Equal(ConsentTextVersion, result.ConsentVersion);
        Assert.Null(result.JoinUrl);
        Assert.Equal((0, 0), (video.Rooms, video.Mints));
        Assert.Empty(ledger.Records);
        Assert.Equal(CandidateJoinOutcomes.ConsentRequired, Assert.Single(repo.Audits).Outcome);
    }

    [Theory]
    [InlineData("accepted")]
    [InlineData("declined")]
    public async Task Either_decision_is_recorded_then_the_candidate_joins(string decision)
    {
        var (join, video, ledger, _) = Build(enabled: true);
        var result = await join.JoinAsync(Token, new CandidateRecordingDecision(decision, ConsentTextVersion),
            "203.0.113.7", "Mozilla/5.0", default);
        Assert.Equal(CandidateJoinOutcomes.Ready, result.Outcome);
        Assert.Equal(ConsentTextVersion, result.ConsentVersion);
        Assert.StartsWith("https://tims.daily.co/", result.JoinUrl);
        var record = Assert.Single(ledger.Records);
        Assert.Equal((InterviewId, OrgId, SubjectCandidate, (Guid?)null, decision, ConsentTextVersion, "203.0.113.7"),
            (record.InterviewId, record.OrganizationId, record.Subject, record.UserId, record.Decision,
                record.TextVersion, record.IpAddress));
        Assert.Equal(1, video.Mints);
    }

    [Theory]
    [InlineData("accepted", "interview-transcription-1999-01-01")]
    [InlineData("maybe", ConsentTextVersion)]
    [InlineData("", ConsentTextVersion)]
    public async Task An_outdated_version_or_unknown_decision_is_asked_again(string decision, string version)
    {
        var (join, video, ledger, _) = Build(enabled: true);
        var result = await join.JoinAsync(Token, new CandidateRecordingDecision(decision, version), null, null, default);
        Assert.Equal(CandidateJoinOutcomes.ConsentRequired, result.Outcome);
        Assert.Empty(ledger.Records);
        Assert.Equal(0, video.Mints);
    }

    [Fact]
    public async Task A_decision_that_cannot_be_recorded_is_unavailable_fail_closed()
    {
        var (join, video, ledger, _) = Build(enabled: true);
        ledger.Writes = false;
        var result = await join.JoinAsync(Token, new CandidateRecordingDecision(Accepted, ConsentTextVersion), null,
            null, default);
        Assert.Equal(CandidateJoinOutcomes.Unavailable, result.Outcome);
        Assert.Equal(0, video.Mints);
    }

    [Fact]
    public async Task A_not_yet_joinable_interview_answers_its_window_without_asking()
    {
        var (join, _, ledger, _) = Build(enabled: true, now: Start.AddHours(-3));
        var result = await join.JoinAsync(Token, new CandidateRecordingDecision(Accepted, ConsentTextVersion), null,
            null, default);
        Assert.Equal(CandidateJoinOutcomes.TooEarly, result.Outcome);
        Assert.Null(result.ConsentVersion);
        Assert.Empty(ledger.Records);
    }
}
