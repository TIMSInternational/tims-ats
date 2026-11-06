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

    [Fact]
    public async Task The_transcript_reference_is_written_tenant_filtered_and_idempotently()
    {
        var repo = Repository();
        var interview = await fixture.AddInterviewAsync();
        var reference = TranscriptReference(Guid.NewGuid());
        await repo.SetTranscriptReferenceAsync(F.OrgB, interview, reference, default);
        Assert.Null((await repo.FindAsync(F.OrgA, interview, default))!.TranscriptUrl);

        await repo.SetTranscriptReferenceAsync(F.OrgA, interview, reference, default);
        var first = await fixture.ScalarAsync<DateTime>("SELECT updated_at FROM interviews WHERE id=@id", ("id", interview));
        await Task.Delay(20);
        await repo.SetTranscriptReferenceAsync(F.OrgA, interview, reference, default);
        Assert.Equal(first, await fixture.ScalarAsync<DateTime>("SELECT updated_at FROM interviews WHERE id=@id", ("id", interview)));
        Assert.Equal(reference, (await repo.FindAsync(F.OrgA, interview, default))!.TranscriptUrl);
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
