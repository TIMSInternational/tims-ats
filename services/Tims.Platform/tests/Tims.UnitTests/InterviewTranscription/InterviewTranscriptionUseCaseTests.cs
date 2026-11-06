using Tims.Application.InterviewJoin;
using Tims.Application.InterviewTranscription;
using static Tims.Application.InterviewTranscription.InterviewTranscriptionConstants;

namespace Tims.UnitTests.InterviewTranscription;

public sealed class InterviewTranscriptionUseCaseTests
{
    private static readonly Guid Org = Guid.Parse("00000000-0000-4000-8000-0000000000aa");
    private static readonly Guid InterviewId = Guid.Parse("1234abcd-0000-4000-8000-000000000001");
    private static readonly Guid Evaluator = Guid.Parse("c0000000-0000-4000-8000-000000000001");
    private static readonly string OwnRoomUrl = "https://tims.daily.co/" + CandidateInterviewJoin.RoomNameFor(InterviewId);
    private static readonly Guid TranscriptId = Guid.Parse("68f65d4c-a4dc-4179-bbb1-c12432afb924");

    internal sealed class Repository : IInterviewTranscriptionRepository
    {
        public TranscriptionInterview? Interview { get; set; } = new(InterviewId, Org, Guid.NewGuid(), "video",
            "scheduled", OwnRoomUrl, null, "Ana", "Pérez", "Analista");
        public List<InterviewConsentRecord> Consents { get; } = [];
        public List<InterviewTranscriptionEvent> Events { get; } = [];
        public bool Writes { get; set; } = true;
        public string? Reference { get; private set; }
        public List<string> SeenProviderEvents { get; } = [];
        private DateTime _clock = new(2026, 11, 6, 15, 0, 0, DateTimeKind.Utc);

        public Task<TranscriptionInterview?> FindAsync(Guid organizationId, Guid interviewId, CancellationToken ct) =>
            Task.FromResult(organizationId == Org && interviewId == InterviewId ? Interview : null);

        public Task<(Guid InterviewId, Guid OrganizationId)?> ResolveOrganizationAsync(Guid interviewId,
            CancellationToken ct) =>
            Task.FromResult<(Guid, Guid)?>(Interview is not null && interviewId == InterviewId ? (InterviewId, Org) : null);

        public Task<bool> RecordConsentAsync(InterviewConsentRecord record, CancellationToken ct)
        {
            if (Writes) Consents.Add(record with { RecordedAt = _clock = _clock.AddSeconds(1) });
            return Task.FromResult(Writes);
        }

        public Task<IReadOnlyList<InterviewConsentRecord>> ListConsentsAsync(Guid organizationId, Guid interviewId,
            CancellationToken ct) => Task.FromResult<IReadOnlyList<InterviewConsentRecord>>(Consents.ToList());

        public Task<IReadOnlyList<InterviewTranscriptionEvent>> ListEventsAsync(Guid organizationId, Guid interviewId,
            CancellationToken ct) => Task.FromResult<IReadOnlyList<InterviewTranscriptionEvent>>(Events.ToList());

        public Task<bool> RecordEventAsync(InterviewTranscriptionEvent transcriptionEvent, CancellationToken ct)
        {
            if (Writes)
            {
                Events.Add(transcriptionEvent with { RecordedAt = _clock = _clock.AddSeconds(1), Id = Guid.NewGuid() });
                if (transcriptionEvent.ProviderEventId is { } id) SeenProviderEvents.Add(id);
            }
            return Task.FromResult(Writes);
        }

        public Task<string?> LatestTranscriptionStateAsync(Guid organizationId, Guid interviewId,
            CancellationToken ct) => Task.FromResult(Events.Count == 0 ? null : Events[^1].State);

        public Task<bool> HasProviderEventAsync(Guid organizationId, Guid interviewId, string providerEventId,
            CancellationToken ct) => Task.FromResult(SeenProviderEvents.Contains(providerEventId));

        public Task SetTranscriptReferenceAsync(Guid organizationId, Guid interviewId, string reference,
            CancellationToken ct)
        {
            Reference = reference;
            if (Interview is not null) Interview = Interview with { TranscriptUrl = reference };
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<TranscriptionStaffName>> ListStaffNamesAsync(Guid organizationId, Guid interviewId,
            CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<TranscriptionStaffName>>([new(Evaluator, "Laura", "Mora")]);

        public Task<IReadOnlyList<TranscriptCompetency>> ListCompetenciesAsync(Guid organizationId, Guid vacancyId,
            CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<TranscriptCompetency>>([new("Comunicación", 4)]);
    }

    internal sealed class Provider : ITranscriptionProvider
    {
        public bool IsConfigured { get; set; } = true;
        public TranscriptionStartResult StartResult { get; set; } = TranscriptionStartResult.Started;
        public List<(string Room, string Language)> Starts { get; } = [];
        public List<Guid> Deleted { get; } = [];
        public bool DeleteSucceeds { get; set; } = true;
        public List<string> Stopped { get; } = [];
        public string? Vtt { get; set; } = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Laura Mora>¿Cómo está?</v>\n\n" +
                                           "00:00:03.000 --> 00:00:05.000\n<v Ana Pérez>Bien, gracias.</v>\n";

        public Task<TranscriptionStartResult> StartAsync(string roomName, string language, CancellationToken ct)
        {
            Starts.Add((roomName, language));
            return Task.FromResult(StartResult);
        }

        public Task<string?> DownloadTranscriptAsync(Guid transcriptId, CancellationToken ct) => Task.FromResult(Vtt);

        public Task<bool> DeleteTranscriptAsync(Guid transcriptId, CancellationToken ct)
        {
            Deleted.Add(transcriptId);
            return Task.FromResult(DeleteSucceeds);
        }

        public Task<bool> StopAsync(string roomName, CancellationToken ct)
        {
            Stopped.Add(roomName);
            return Task.FromResult(true);
        }
    }

    /// <summary>15:30 UTC — the fake repository records events from 15:00 on, one second apart.</summary>
    private sealed class Clock : TimeProvider
    {
        public DateTime Now { get; set; } = new(2026, 11, 6, 15, 30, 0, DateTimeKind.Utc);

        public override DateTimeOffset GetUtcNow() => new(Now, TimeSpan.Zero);
    }

    private static (InterviewTranscriptionUseCase UseCase, Repository Repo, Provider Provider) Build(Clock? clock = null)
    {
        var repo = new Repository();
        var provider = new Provider();
        return (new InterviewTranscriptionUseCase(repo, provider, clock ?? new Clock()), repo, provider);
    }

    private static InterviewConsentRecord Candidate(string decision, string version = ConsentTextVersion) =>
        new(InterviewId, Org, SubjectCandidate, null, decision, version);

    private static InterviewConsentRecord Staff(Guid user) => new(InterviewId, Org, SubjectStaff, user, Accepted,
        ConsentTextVersion);

    private static async Task Consent(Repository repo, string decision, string version = ConsentTextVersion) =>
        await repo.RecordConsentAsync(Candidate(decision, version), default);

    [Fact]
    public async Task Status_starts_pending_and_cannot_start()
    {
        var (useCase, _, _) = Build();
        var status = (await useCase.GetStatusAsync(Org, Evaluator, InterviewId, default)).Value!;
        Assert.Equal((Pending, false, TranscriptStates.None, false, false),
            (status.CandidateDecision, status.ViewerAcknowledged, status.TranscriptState, status.TranscriptAvailable,
                status.CanStart));
        Assert.Equal(ConsentTextVersion, status.ConsentVersion);
    }

    [Fact]
    public async Task Only_the_candidates_latest_decision_on_the_current_version_counts()
    {
        var (useCase, repo, _) = Build();
        await Consent(repo, Accepted, "an-older-notice");
        Assert.Equal(Pending, (await useCase.GetStatusAsync(Org, Evaluator, InterviewId, default)).Value!.CandidateDecision);
        await Consent(repo, Accepted);
        await Consent(repo, Declined);
        Assert.Equal(Declined, (await useCase.GetStatusAsync(Org, Evaluator, InterviewId, default)).Value!.CandidateDecision);
        await Consent(repo, Accepted);
        var status = (await useCase.GetStatusAsync(Org, Evaluator, InterviewId, default)).Value!;
        Assert.Equal(Accepted, status.CandidateDecision);
        Assert.NotNull(status.CandidateDecidedAt);
        Assert.EndsWith("Z", status.CandidateDecidedAt);
    }

    [Fact]
    public async Task Acknowledgement_is_per_evaluator_and_version_checked()
    {
        var (useCase, repo, _) = Build();
        var stale = await useCase.AcknowledgeAsync(Org, Evaluator, InterviewId, "an-older-notice", null, null, default);
        Assert.Equal((409, "consent_version_mismatch"), (stale.Status, stale.Code));
        Assert.Empty(repo.Consents);

        var ok = await useCase.AcknowledgeAsync(Org, Evaluator, InterviewId, ConsentTextVersion, "1.2.3.4", "ua", default);
        Assert.True(ok.Value!.ViewerAcknowledged);
        var recorded = Assert.Single(repo.Consents);
        Assert.Equal((SubjectStaff, Evaluator, Accepted, "1.2.3.4"),
            (recorded.Subject, recorded.UserId, recorded.Decision, recorded.IpAddress));
        Assert.False((await useCase.GetStatusAsync(Org, Guid.NewGuid(), InterviewId, default)).Value!.ViewerAcknowledged);
    }

    [Fact]
    public async Task An_acknowledgement_that_cannot_be_recorded_fails_closed()
    {
        var (useCase, repo, _) = Build();
        repo.Writes = false;
        var result = await useCase.AcknowledgeAsync(Org, Evaluator, InterviewId, ConsentTextVersion, null, null, default);
        Assert.Equal((503, "consent_not_recorded"), (result.Status, result.Code));
    }

    [Fact]
    public async Task Start_needs_the_candidates_acceptance_and_the_starters_acknowledgement()
    {
        var (useCase, repo, provider) = Build();
        Assert.Equal("candidate_consent_missing", (await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default)).Code);
        await Consent(repo, Declined);
        Assert.Equal("candidate_consent_missing", (await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default)).Code);
        await Consent(repo, Accepted);
        Assert.Equal("acknowledgement_missing", (await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default)).Code);
        // Another evaluator's acknowledgement does not count for this caller.
        repo.Consents.Add(Staff(Guid.NewGuid()));
        Assert.Equal("acknowledgement_missing", (await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default)).Code);
        Assert.Empty(provider.Starts);

        repo.Consents.Add(Staff(Evaluator));
        var started = await useCase.StartAsync(Org, Evaluator, InterviewId, "en", default);
        Assert.Equal(200, started.Status);
        Assert.Equal((CandidateInterviewJoin.RoomNameFor(InterviewId), "en"), Assert.Single(provider.Starts));
        var requested = Assert.Single(repo.Events);
        Assert.Equal((TranscriptStates.Requested, Evaluator, "en"), (requested.State, requested.UserId, requested.Language));
        Assert.Equal(TranscriptStates.Requested, started.Value!.TranscriptState);
    }

    [Theory]
    [InlineData("fr")]
    [InlineData("")]
    [InlineData("ES")]
    public async Task Start_rejects_unsupported_languages(string language)
    {
        var (useCase, _, provider) = Build();
        Assert.Equal((400, "invalid_language"), Pick(await useCase.StartAsync(Org, Evaluator, InterviewId, language, default)));
        Assert.Empty(provider.Starts);
    }

    [Theory]
    [InlineData("completed", null, "interview_closed")]
    [InlineData("cancelled", null, "interview_closed")]
    [InlineData("scheduled", "https://teams.microsoft.com/l/meetup-join/abc", "no_platform_room")]
    [InlineData("scheduled", "https://tims.daily.co/tims-1234abcd", "no_platform_room")] // legacy name
    [InlineData("scheduled", "https://tims.daily.co/tims-ffffffffffffffffffffffffffffffff", "no_platform_room")]
    [InlineData("scheduled", "", "no_platform_room")]
    public async Task Start_only_in_a_live_interview_with_its_own_platform_room(string status, string? meetingUrl,
        string code)
    {
        var (useCase, repo, provider) = Build();
        repo.Interview = repo.Interview! with
        {
            Status = status,
            MeetingUrl = meetingUrl is null ? OwnRoomUrl : meetingUrl.Length == 0 ? null : meetingUrl,
        };
        await Consent(repo, Accepted);
        repo.Consents.Add(Staff(Evaluator));
        Assert.Equal((409, code), Pick(await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default)));
        Assert.Empty(provider.Starts);
    }

    [Fact]
    public async Task Start_reports_provider_failures_and_records_nothing()
    {
        var (useCase, repo, provider) = Build();
        await Consent(repo, Accepted);
        repo.Consents.Add(Staff(Evaluator));
        provider.StartResult = TranscriptionStartResult.Failed;
        Assert.Equal((502, "provider_failed"), Pick(await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default)));
        Assert.Empty(repo.Events);
        provider.IsConfigured = false;
        Assert.Equal((503, "provider_unavailable"), Pick(await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default)));
    }

    [Fact]
    public async Task A_foreign_or_missing_interview_is_not_found()
    {
        var (useCase, _, _) = Build();
        Assert.Equal(404, (await useCase.GetStatusAsync(Guid.NewGuid(), Evaluator, InterviewId, default)).Status);
        Assert.Equal(404, (await useCase.StartAsync(Org, Evaluator, Guid.NewGuid(), "es", default)).Status);
        Assert.Equal(404, (await useCase.GetTranscriptAsync(Guid.NewGuid(), InterviewId, default)).Status);
    }

    private static DailyWebhookEvent Ready(string? eventId = "evt-ready", Guid? transcript = null) =>
        new(DailyWebhookEvent.TranscriptReady, eventId, CandidateInterviewJoin.RoomNameFor(InterviewId),
            transcript ?? TranscriptId);

    private static async Task Started(Repository repo, InterviewTranscriptionUseCase useCase)
    {
        await Consent(repo, Accepted);
        repo.Consents.Add(Staff(Evaluator));
        await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default);
    }

    [Fact]
    public async Task A_ready_transcript_of_a_consented_requested_session_is_stored_once()
    {
        var (useCase, repo, provider) = Build();
        await Started(repo, useCase);
        Assert.Equal(WebhookHandling.Stored, await useCase.HandleWebhookAsync(Ready(), default));
        Assert.Equal(TranscriptReference(TranscriptId), repo.Reference);
        Assert.Equal(WebhookHandling.Duplicate, await useCase.HandleWebhookAsync(Ready(), default));
        Assert.Empty(provider.Deleted);
        var status = (await useCase.GetStatusAsync(Org, Evaluator, InterviewId, default)).Value!;
        Assert.Equal((TranscriptStates.Ready, true), (status.TranscriptState, status.TranscriptAvailable));
    }

    [Fact]
    public async Task A_ready_transcript_without_candidate_acceptance_is_deleted_and_never_stored()
    {
        var (useCase, repo, provider) = Build();
        await Started(repo, useCase);
        await Consent(repo, Declined); // the candidate changed their mind before the transcript was ready
        Assert.Equal(WebhookHandling.Rejected, await useCase.HandleWebhookAsync(Ready(), default));
        Assert.Null(repo.Reference);
        Assert.Equal(TranscriptId, Assert.Single(provider.Deleted));
        Assert.Equal(TranscriptStates.Rejected, repo.Events[^1].State);
    }

    [Fact]
    public async Task A_transcript_never_requested_through_the_platform_is_deleted_even_with_consent()
    {
        var (useCase, repo, provider) = Build();
        await Consent(repo, Accepted);
        Assert.Equal(WebhookHandling.Rejected, await useCase.HandleWebhookAsync(Ready(), default));
        Assert.Null(repo.Reference);
        Assert.Single(provider.Deleted);
    }

    [Fact]
    public async Task Started_and_error_events_are_recorded_and_other_events_ignored()
    {
        var (useCase, repo, _) = Build();
        var room = CandidateInterviewJoin.RoomNameFor(InterviewId);
        Assert.Equal(WebhookHandling.Recorded, await useCase.HandleWebhookAsync(
            new(DailyWebhookEvent.TranscriptStarted, "evt-1", room, TranscriptId), default));
        Assert.Equal(TranscriptStates.InProgress, repo.Events[^1].State);
        Assert.Equal(WebhookHandling.Recorded, await useCase.HandleWebhookAsync(
            new(DailyWebhookEvent.TranscriptError, "evt-2", room, TranscriptId), default));
        Assert.Equal(TranscriptStates.Error, repo.Events[^1].State);
        Assert.Equal(WebhookHandling.Ignored, await useCase.HandleWebhookAsync(
            new("recording.ready-to-download", "evt-3", room, null), default));
        Assert.Equal(WebhookHandling.Ignored, await useCase.HandleWebhookAsync(
            new(DailyWebhookEvent.TranscriptReady, "evt-4", "tims-1234abcd", TranscriptId), default));
        Assert.Equal(WebhookHandling.Ignored, await useCase.HandleWebhookAsync(
            new(DailyWebhookEvent.TranscriptReady, "evt-5", CandidateInterviewJoin.RoomNameFor(Guid.NewGuid()),
                TranscriptId), default));
        Assert.Equal(WebhookHandling.Test, await useCase.HandleWebhookAsync(new("test", null, null, null), default));
        Assert.Equal(2, repo.Events.Count);
    }

    [Fact]
    public async Task Each_platform_start_authorizes_at_most_one_transcript()
    {
        // Codex P1: a historical start must not authorize a later transcript whose own start was never recorded.
        var (useCase, repo, provider) = Build();
        await Started(repo, useCase);
        Assert.Equal(WebhookHandling.Stored, await useCase.HandleWebhookAsync(Ready("evt-1"), default));
        var second = Guid.NewGuid();
        repo.Writes = false; // the second start reaches Daily but its evidence is not written
        Assert.Equal(503, (await useCase.StartAsync(Org, Evaluator, InterviewId, "es", default)).Status);
        repo.Writes = true;
        Assert.Equal(WebhookHandling.Rejected, await useCase.HandleWebhookAsync(Ready("evt-2", second), default));
        Assert.Equal(second, Assert.Single(provider.Deleted));
        Assert.Equal(TranscriptReference(TranscriptId), repo.Reference);
        Assert.Equal(repo.Events.Single(e => e.State == TranscriptStates.Requested).Id,
            repo.Events.Single(e => e.State == TranscriptStates.Ready).AuthorizedBy);
    }

    [Fact]
    public async Task A_start_only_authorizes_a_transcript_that_began_right_after_it()
    {
        var (useCase, repo, provider) = Build();
        await Started(repo, useCase); // requested at ~15:00:03
        var requestedAt = repo.Events.Single().RecordedAt!.Value;
        var lateStart = new DateTimeOffset(requestedAt.AddMinutes(40)).ToUnixTimeSeconds();
        var late = Ready("evt-late") with { EventTimestamp = lateStart + 600, DurationSeconds = 600 };
        Assert.Equal(WebhookHandling.Rejected, await useCase.HandleWebhookAsync(late, default));
        var onTime = Ready("evt-on-time", Guid.NewGuid()) with
        {
            EventTimestamp = new DateTimeOffset(requestedAt.AddSeconds(20)).ToUnixTimeSeconds() + 1800,
            DurationSeconds = 1800,
        };
        Assert.Equal(WebhookHandling.Stored, await useCase.HandleWebhookAsync(onTime, default));
        Assert.Single(provider.Deleted);
    }

    [Fact]
    public async Task Without_timing_a_stale_start_authorizes_nothing()
    {
        var clock = new Clock();
        var (useCase, repo, _) = Build(clock);
        await Started(repo, useCase);
        clock.Now = clock.Now.Add(InterviewTranscriptionUseCase.UntimedWindow).AddMinutes(5);
        Assert.Equal(WebhookHandling.Rejected, await useCase.HandleWebhookAsync(Ready(), default));
    }

    [Fact]
    public async Task A_failed_deletion_is_not_acknowledged_and_the_redelivery_retries_it()
    {
        // Codex P1: a rejection is only recorded once the provider confirms the deletion.
        var (useCase, repo, provider) = Build();
        await Consent(repo, Accepted); // never started through the platform → must be deleted
        provider.DeleteSucceeds = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => useCase.HandleWebhookAsync(Ready("evt-del"), default));
        Assert.DoesNotContain(repo.Events, e => e.State == TranscriptStates.Rejected);
        provider.DeleteSucceeds = true;
        Assert.Equal(WebhookHandling.Rejected, await useCase.HandleWebhookAsync(Ready("evt-del"), default));
        Assert.Equal(2, provider.Deleted.Count);
    }

    [Fact]
    public async Task A_webhook_whose_evidence_cannot_be_written_throws_so_the_provider_retries()
    {
        var (useCase, repo, _) = Build();
        await Started(repo, useCase);
        repo.Writes = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => useCase.HandleWebhookAsync(Ready("evt-x"), default));
    }

    [Fact]
    public async Task The_transcript_is_served_pseudonymized_only_while_the_candidate_accepts()
    {
        var (useCase, repo, provider) = Build();
        Assert.Equal("transcript_not_ready", (await useCase.GetTranscriptAsync(Org, InterviewId, default)).Code);
        await Started(repo, useCase);
        await useCase.HandleWebhookAsync(Ready(), default);

        var view = (await useCase.GetTranscriptAsync(Org, InterviewId, default)).Value!;
        Assert.Equal(["interviewer_1", "candidate"], view.Segments.Select(s => s.Speaker).ToArray());
        Assert.Equal(("es", "Analista", "Comunicación"), (view.Language, view.VacancyTitle, view.Competencies[0].Name));
        Assert.Equal(Org, view.OrganizationId);

        await Consent(repo, Declined);
        Assert.Equal((409, "candidate_consent_missing"), Pick(await useCase.GetTranscriptAsync(Org, InterviewId, default)));

        await Consent(repo, Accepted);
        provider.Vtt = null;
        Assert.Equal((502, "provider_failed"), Pick(await useCase.GetTranscriptAsync(Org, InterviewId, default)));
    }

    private static (int, string?) Pick<T>(TranscriptionResult<T> result) => (result.Status, result.Code);
}
