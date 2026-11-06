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

        public Task<CandidateJoinInterview?> FindByTokenHashAsync(string tokenHash, CancellationToken ct) =>
            Task.FromResult<CandidateJoinInterview?>(new(InterviewId, OrgId, "video", "scheduled", Start, 60, null,
                Start.AddMinutes(90), null, "Ana", "Pérez"));

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
    }

    private sealed class Clock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(now, TimeSpan.Zero);
    }

    private static (CandidateInterviewJoin Join, Video Video, Ledger Ledger, Repository Repo) Build(bool enabled,
        DateTime? now = null)
    {
        var repo = new Repository();
        var video = new Video();
        var ledger = new Ledger();
        return (new CandidateInterviewJoin(repo, video, new Clock(now ?? Start.AddMinutes(-5)),
            new InterviewTranscriptionSettings(enabled), ledger), video, ledger, repo);
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
