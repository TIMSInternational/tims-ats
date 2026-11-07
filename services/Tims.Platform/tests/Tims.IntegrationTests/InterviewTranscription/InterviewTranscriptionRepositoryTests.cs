using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Tims.Application.InterviewTranscription;
using Tims.Infrastructure.InterviewTranscription;
using static Tims.Application.InterviewTranscription.InterviewTranscriptionConstants;
using F = Tims.IntegrationTests.InterviewTranscription.InterviewTranscriptionFixture;

namespace Tims.IntegrationTests.InterviewTranscription;

[Collection("InterviewTranscription")]
public sealed class InterviewTranscriptionRepositoryTests(F fixture)
{
    private InterviewTranscriptionRepository Repository() =>
        new(new InterviewTranscriptionDataSourceHolder(NpgsqlDataSource.Create(fixture.ConnectionString)),
            NullLogger<InterviewTranscriptionRepository>.Instance);

    [Fact]
    public async Task Finds_the_interview_only_inside_its_own_organization()
    {
        var repo = Repository();
        var found = await repo.FindAsync(F.OrgA, F.Assigned, default);
        Assert.NotNull(found);
        Assert.Equal(("video", "scheduled", "Ana", "Pérez", "Analista"),
            (found!.Type, found.Status, found.CandidateFirstName, found.CandidateLastName, found.VacancyTitle));
        Assert.Null(await repo.FindAsync(F.OrgB, F.Assigned, default));
        Assert.Null(await repo.FindAsync(F.OrgA, F.OrgBInterview, default));
        Assert.Equal((F.Assigned, F.OrgA), await repo.ResolveOrganizationAsync(F.Assigned, default));
        Assert.Null(await repo.ResolveOrganizationAsync(Guid.NewGuid(), default));
    }

    [Fact]
    public async Task Consents_are_appended_as_audit_rows_and_read_back_in_order()
    {
        var repo = Repository();
        var interview = await fixture.AddInterviewAsync();
        Assert.True(await repo.RecordConsentAsync(new(interview, F.OrgA, SubjectCandidate, null, Accepted,
            ConsentTextVersion, IpAddress: "203.0.113.9", UserAgent: "UA\nforged"), default));
        Assert.True(await repo.RecordConsentAsync(new(interview, F.OrgA, SubjectStaff, F.RecruiterId, Accepted,
            ConsentTextVersion), default));
        Assert.True(await repo.RecordConsentAsync(new(interview, F.OrgA, SubjectCandidate, null, Declined,
            ConsentTextVersion), default));

        var consents = await repo.ListConsentsAsync(F.OrgA, interview, default);
        // All three rows are kept (append-only); the read returns the LATEST per subject/user, oldest first.
        Assert.Equal(3, await fixture.CountAuditAsync(interview, ConsentAction));
        Assert.Equal([(SubjectStaff, (Guid?)F.RecruiterId, Accepted), (SubjectCandidate, null, Declined)],
            consents.Select(c => (c.Subject, c.UserId, c.Decision)).ToArray());
        Assert.All(consents, c => Assert.Equal(DateTimeKind.Utc, c.RecordedAt!.Value.Kind));
        Assert.Equal(Declined, InterviewTranscriptionUseCase.CandidateDecision(consents).Decision);
        // Attribution is normalized like every security-audit row (#181): an IP literal, a UA without line breaks.
        Assert.Equal("203.0.113.9", await fixture.ScalarAsync<string>(
            "SELECT ip_address FROM audit_logs WHERE entity_id=@e AND actor_id IS NULL ORDER BY created_at LIMIT 1",
            ("e", interview.ToString())));
        Assert.DoesNotContain("\n", await fixture.ScalarAsync<string>(
            "SELECT user_agent FROM audit_logs WHERE entity_id=@e AND user_agent IS NOT NULL LIMIT 1",
            ("e", interview.ToString())));
        // Another tenant reads nothing, even with the right interview id.
        Assert.Empty(await repo.ListConsentsAsync(F.OrgB, interview, default));
    }

    [Fact]
    public async Task The_latest_candidate_decision_is_never_hidden_by_history()
    {
        // Codex P1: the oldest-500 window used to drop a newer decline behind repeated rows.
        var repo = Repository();
        var interview = await fixture.AddInterviewAsync();
        for (var i = 0; i < 520; i++)
            Assert.True(await repo.RecordConsentAsync(new(interview, F.OrgA, SubjectCandidate, null, Accepted,
                ConsentTextVersion), default));
        Assert.True(await repo.RecordConsentAsync(new(interview, F.OrgA, SubjectStaff, F.RecruiterId, Accepted,
            ConsentTextVersion), default));
        Assert.True(await repo.RecordConsentAsync(new(interview, F.OrgA, SubjectCandidate, null, Declined,
            ConsentTextVersion), default));
        var consents = await repo.ListConsentsAsync(F.OrgA, interview, default);
        Assert.Equal(2, consents.Count); // one per subject/user: the candidate's latest and the recruiter's
        Assert.Equal(Declined, InterviewTranscriptionUseCase.CandidateDecision(consents).Decision);
        Assert.True(InterviewTranscriptionUseCase.HasAcknowledged(consents, F.RecruiterId));
    }

    [Fact]
    public async Task A_write_for_an_interview_outside_the_organization_inserts_nothing()
    {
        var repo = Repository();
        Assert.False(await repo.RecordConsentAsync(new(F.OrgBInterview, F.OrgA, SubjectCandidate, null, Accepted,
            ConsentTextVersion), default));
        Assert.False(await repo.RecordEventAsync(new(F.OrgBInterview, F.OrgA, TranscriptStates.Ready), default));
        Assert.Equal(0, await fixture.CountAuditAsync(F.OrgBInterview, ConsentAction));
    }

    [Fact]
    public async Task Events_round_trip_and_provider_ids_detect_redelivery()
    {
        var repo = Repository();
        var interview = await fixture.AddInterviewAsync();
        var transcript = Guid.NewGuid();
        Assert.True(await repo.RecordEventAsync(new(interview, F.OrgA, TranscriptStates.Requested,
            UserId: F.RecruiterId, Language: "es"), default));
        var requested = (await repo.ListEventsAsync(F.OrgA, interview, default)).Single();
        Assert.NotNull(requested.Id);
        Assert.True(await repo.RecordEventAsync(new(interview, F.OrgA, TranscriptStates.Ready,
            ProviderEventId: "evt-1", TranscriptId: transcript, AuthorizedBy: requested.Id), default));
        var events = await repo.ListEventsAsync(F.OrgA, interview, default);
        Assert.Equal(requested.Id, events[^1].AuthorizedBy);
        Assert.Equal(TranscriptStates.Ready, await repo.LatestTranscriptionStateAsync(F.OrgA, interview, default));
        Assert.Equal([(TranscriptStates.Requested, (Guid?)F.RecruiterId, "es", (Guid?)null),
                (TranscriptStates.Ready, null, null, transcript)],
            events.Select(e => (e.State, e.UserId, e.Language, e.TranscriptId)).ToArray());
        Assert.True(await repo.HasProviderEventAsync(F.OrgA, interview, "evt-1", default));
        Assert.False(await repo.HasProviderEventAsync(F.OrgA, interview, "evt-2", default));
        Assert.False(await repo.HasProviderEventAsync(F.OrgB, interview, "evt-1", default));
    }

    private static async Task<Guid> RequestedStartAsync(InterviewTranscriptionRepository repo, Guid interview)
    {
        Assert.True(await repo.RecordEventAsync(new(interview, F.OrgA, TranscriptStates.Requested,
            UserId: F.RecruiterId, Language: "es"), default));
        return (await repo.ListEventsAsync(F.OrgA, interview, default)).Single().Id!.Value;
    }

    private Task<long> ReadyRowsAsync(Guid interview, Guid start) => fixture.ScalarAsync<long>(
        "SELECT count(*) FROM audit_logs WHERE entity_id=@e AND metadata->>'state'='ready' AND metadata->>'authorizedBy'=@s",
        ("e", interview.ToString()), ("s", start.ToString("D")));

    /// <summary>Waits until <paramref name="expected"/> backends of this database are blocked on a lock.</summary>
    private async Task WaitForLockWaitersAsync(int expected)
    {
        for (var i = 0; i < 500; i++)
        {
            if (await fixture.ScalarAsync<long>(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")
                == expected) return;
            await Task.Delay(20);
        }
        Assert.Fail($"Expected {expected} sessions waiting on a lock");
    }

    [Fact]
    public async Task The_transcript_reference_is_written_tenant_filtered_and_idempotently()
    {
        var repo = Repository();
        var interview = await fixture.AddInterviewAsync();
        var start = await RequestedStartAsync(repo, interview);
        var transcript = Guid.NewGuid();
        Assert.Equal(TranscriptClaim.Failed,
            await repo.ClaimTranscriptAsync(F.OrgB, interview, transcript, start, "evt-b", default));
        Assert.Null((await repo.FindAsync(F.OrgA, interview, default))!.TranscriptUrl);

        Assert.Equal(TranscriptClaim.Stored,
            await repo.ClaimTranscriptAsync(F.OrgA, interview, transcript, start, "evt-a", default));
        var first = await fixture.ScalarAsync<DateTime>("SELECT updated_at FROM interviews WHERE id=@id", ("id", interview));
        await Task.Delay(20);
        Assert.Equal(TranscriptClaim.AlreadyStored,
            await repo.ClaimTranscriptAsync(F.OrgA, interview, transcript, start, "evt-a2", default));
        Assert.Equal(first, await fixture.ScalarAsync<DateTime>("SELECT updated_at FROM interviews WHERE id=@id", ("id", interview)));
        Assert.Equal(TranscriptReference(transcript), (await repo.FindAsync(F.OrgA, interview, default))!.TranscriptUrl);
        // The start is spent: another transcript cannot be stored against it, and the stored reference stays.
        Assert.Equal(TranscriptClaim.StartConsumed,
            await repo.ClaimTranscriptAsync(F.OrgA, interview, Guid.NewGuid(), start, "evt-c", default));
        Assert.Equal(TranscriptReference(transcript), (await repo.FindAsync(F.OrgA, interview, default))!.TranscriptUrl);
        Assert.Equal(1, await ReadyRowsAsync(interview, start));
        var ready = (await repo.ListEventsAsync(F.OrgA, interview, default))[^1];
        Assert.Equal((TranscriptStates.Ready, (Guid?)transcript, (Guid?)start), (ready.State, ready.TranscriptId, ready.AuthorizedBy));
    }

    [Fact]
    public async Task Two_concurrent_claims_on_one_start_store_exactly_one_transcript()
    {
        // Codex P1 (re-run 2). Deterministic: a held row lock stops each claim at its UPDATE, which comes AFTER its
        // consumption check. With the interview lock the second claim waits BEFORE checking and sees the first's
        // ready row; without it both checks pass first and both claims store.
        var repo = Repository();
        var interview = await fixture.AddInterviewAsync();
        var start = await RequestedStartAsync(repo, interview);
        await using var blocker = new NpgsqlConnection(fixture.ConnectionString);
        await blocker.OpenAsync();
        await using var hold = await blocker.BeginTransactionAsync();
        await using (var row = new NpgsqlCommand("SELECT 1 FROM interviews WHERE id=@id FOR UPDATE", blocker, hold))
        {
            row.Parameters.AddWithValue("id", interview);
            await row.ExecuteScalarAsync();
        }

        var transcripts = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var claims = transcripts.Select(t => Task.Run(() =>
            repo.ClaimTranscriptAsync(F.OrgA, interview, t, start, "evt-" + t.ToString("N"), default))).ToArray();
        await WaitForLockWaitersAsync(2);
        await hold.RollbackAsync();
        var outcomes = await Task.WhenAll(claims).WaitAsync(TimeSpan.FromSeconds(30));

        Assert.Equal([TranscriptClaim.Stored, TranscriptClaim.StartConsumed], outcomes.Order().ToArray());
        var winner = transcripts[Array.IndexOf(outcomes, TranscriptClaim.Stored)];
        Assert.Equal(1, await ReadyRowsAsync(interview, start));
        Assert.Equal(TranscriptReference(winner), (await repo.FindAsync(F.OrgA, interview, default))!.TranscriptUrl);
    }

    [Fact]
    public async Task A_claim_whose_ready_row_fails_writes_no_reference_and_leaves_the_start_unconsumed()
    {
        // Codex P1 (re-run 2): the reference used to commit on its own before the ready row. A trigger fails ONLY
        // this interview's ready INSERT, after the UPDATE already ran in the claim's transaction.
        var repo = Repository();
        var interview = await fixture.AddInterviewAsync();
        var start = await RequestedStartAsync(repo, interview);
        var transcript = Guid.NewGuid();
        var name = "fail_ready_" + interview.ToString("N");
        await fixture.ExecuteAsync($"""
            CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.entity_id = '{interview}' AND NEW.metadata->>'state' = 'ready' THEN
                RAISE EXCEPTION 'injected audit failure';
              END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER {name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION {name}();
            """);
        try
        {
            Assert.Equal(TranscriptClaim.Failed,
                await repo.ClaimTranscriptAsync(F.OrgA, interview, transcript, start, "evt-1", default));
        }
        finally
        {
            await fixture.ExecuteAsync($"DROP TRIGGER {name} ON audit_logs; DROP FUNCTION {name}();");
        }
        Assert.Null((await repo.FindAsync(F.OrgA, interview, default))!.TranscriptUrl);
        Assert.Equal(0, await ReadyRowsAsync(interview, start));

        // Daily's retry: the start is still there to authorize it.
        Assert.Equal(TranscriptClaim.Stored,
            await repo.ClaimTranscriptAsync(F.OrgA, interview, transcript, start, "evt-1", default));
        Assert.Equal(TranscriptReference(transcript), (await repo.FindAsync(F.OrgA, interview, default))!.TranscriptUrl);
    }

    [Fact]
    public async Task Staff_names_are_the_evaluators_and_the_creator_and_competencies_follow_the_shared_rule()
    {
        var repo = Repository();
        var interview = await fixture.AddInterviewAsync();
        var staff = await repo.ListStaffNamesAsync(F.OrgA, interview, default);
        Assert.Equal([("Laura", "Mora"), ("Diego", "Solís")],
            staff.OrderBy(s => s.UserId).Select(s => (s.FirstName, s.LastName)).ToArray());
        var vacancy = (await repo.FindAsync(F.OrgA, interview, default))!.VacancyId;
        var competencies = await repo.ListCompetenciesAsync(F.OrgA, vacancy, default);
        Assert.Equal([("Comunicación", (int?)4), ("SQL", null)], competencies.Select(c => (c.Name, c.Level)).ToArray());
        Assert.Empty(await repo.ListCompetenciesAsync(F.OrgB, vacancy, default));
    }

    [Theory]
    [InlineData("{}", 0)]
    [InlineData("[]", 0)]
    [InlineData("not json", 0)]
    [InlineData("[{\"name\":\"A\",\"level\":7},{\"name\":\"B\",\"level\":\"3\"},{\"name\":\"C\",\"level\":2}]", 1)]
    public void Competency_parsing_rejects_what_resolveCompetencies_rejects(string json, int expected) =>
        Assert.Equal(expected, InterviewTranscriptionRepository.ParseCompetencies(json).Count);
}
