using System.Text.Json.Nodes;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>AS-5 assign: guardrails, #312, idempotency and crash-safe provider creation.</summary>
public sealed class AssignProviderInstrumentsUseCaseTests
{
    private static readonly Guid Actor = Guid.Parse("d0000000-0000-4000-8000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 13, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private AssignProviderInstrumentsUseCase UseCase => new(_repository, _provider);

    private static AssignProviderInstrumentsInput Input(params (string Instrument, string? Reason)[] items) =>
        new(FakeRepository.Candidate, FakeRepository.Vacancy, items.Select(i => new AssignInstrumentItem(i.Instrument, i.Reason)).ToList(),
            null, 1.5m, ["extended_breaks"], null);

    private Task<ProviderAssignResult> Assign(AssignProviderInstrumentsInput input) =>
        UseCase.AssignAsync(FakeRepository.Org, Actor, input, Now, CancellationToken.None);

    [Fact]
    public async Task Two_instruments_make_two_attempts_and_two_provider_assignments()
    {
        var result = await Assign(Input(("lia", null), ("english", "Atención a clientes en inglés")));

        Assert.Equal(ProviderAssignOutcome.Ok, result.Outcome);
        Assert.True(result.Response!.Complete);
        Assert.Equal(["lia", "english"], result.Response.Items.Select(i => i.Instrument));
        Assert.All(result.Response.Items, i => Assert.Equal(ProviderAttemptStates.Created, i.State));
        Assert.Equal(2, _provider.Assignments.Count);
        Assert.All(_repository.Attempts, a => Assert.Equal(ProviderAttemptStates.Created, a.State));
    }

    [Fact]
    public async Task The_provider_request_carries_selection_the_vacancy_its_reason_and_the_accommodation_only()
    {
        await Assign(Input(("lia", "ignored: the vacancy declares its own reason"), ("english", "Atención a clientes en inglés")));

        var lia = _provider.Assignments.Single(a => a.Request.Instrument == "lia").Request;
        Assert.Equal(FakeRepository.Vacancy.ToString(), lia.ExternalVacancyRef);
        Assert.Equal("Análisis de datos bajo presión de tiempo", lia.JobRelatednessReason); // the vacancy's, not HR's
        Assert.Equal("Atención a clientes en inglés", _provider.Assignments.Single(a => a.Request.Instrument == "english").Request.JobRelatednessReason);
        Assert.Equal(1.5m, lia.TimeMultiplier);
        Assert.Equal(["extended_breaks"], lia.Aids);
        // The idempotency key is derived from the attempt id, so a retry replays the same provider assignment.
        var attempt = _repository.Attempts.Single(a => a.Instrument == "lia");
        Assert.Equal($"ats-attempt-{attempt.Id:N}", _provider.Assignments.Single(a => a.Request.Instrument == "lia").Key);
        Assert.Equal(attempt.Id.ToString(), lia.ExternalRef);
    }

    [Fact]
    public async Task A_native_instrument_sends_no_candidate_pii()
    {
        await Assign(Input(("lia", null)));

        var subject = Assert.Single(_provider.Subjects).Request;
        Assert.Equal(FakeRepository.Candidate.ToString(), subject.ExternalRef);
        Assert.Null(subject.GivenName);
        Assert.Null(subject.FamilyName);
        Assert.Null(subject.Email);
    }

    [Fact]
    public async Task Pca_link_out_sends_the_names_and_email_it_needs_under_a_different_idempotency_key()
    {
        await Assign(Input(("lia", null)));
        await Assign(Input(("pca", null)));

        Assert.Equal(2, _provider.Subjects.Count);
        var pca = _provider.Subjects[1];
        Assert.Equal("Ana", pca.Request.GivenName);
        Assert.Equal("ana@example.com", pca.Request.Email);
        Assert.NotEqual(_provider.Subjects[0].Key, pca.Key); // a different body must not reuse the key (422 otherwise)
    }

    [Fact]
    public async Task Withdrawn_recruitment_consent_blocks_assign_before_anything_is_written_or_sent()
    {
        _repository.Context = _repository.Context with { ConsentWithdrawn = true };

        var result = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAssignOutcome.ConsentWithdrawn, result.Outcome);
        Assert.Empty(_repository.Writes);
        Assert.Empty(_provider.Calls);
    }

    [Fact]
    public async Task A_withdrawal_that_lands_between_the_check_and_the_reserve_still_blocks_and_sends_nothing()
    {
        _repository.WithdrawnUnderLock = true;

        var result = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAssignOutcome.ConsentWithdrawn, result.Outcome);
        Assert.Empty(_provider.Calls);
    }

    [Fact]
    public async Task A_retry_returns_the_open_attempt_and_does_not_assign_twice()
    {
        var first = await Assign(Input(("lia", null)));
        var second = await Assign(Input(("lia", null)));

        Assert.Equal(first.Response!.Items[0].AttemptId, second.Response!.Items[0].AttemptId);
        Assert.Single(_provider.Assignments);
        Assert.Single(_repository.Attempts);
    }

    [Fact]
    public async Task A_provider_outage_keeps_the_attempt_pending_and_the_retry_replays_the_same_key()
    {
        _provider.OnCreateAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        var failed = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAssignOutcome.Incomplete, failed.Outcome);
        Assert.Equal(ProviderAttemptStates.PendingCreate, failed.Response!.Items[0].State);
        Assert.Equal(ProviderFailure.Unavailable, failed.Response.Items[0].Error);

        _provider.OnCreateAssignment = null;
        var retried = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAssignOutcome.Ok, retried.Outcome);
        Assert.Single(_repository.Attempts);
        Assert.Equal(_provider.Assignments[0].Key, _provider.Assignments[1].Key);
    }

    [Fact]
    public async Task A_provider_refusal_cancels_the_attempt_so_a_corrected_request_can_start_over()
    {
        _provider.OnCreateAssignment = _ => ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(409, "vacancy_version_mismatch", false, []));

        var result = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAssignOutcome.Incomplete, result.Outcome);
        Assert.Equal(ProviderAttemptStates.Cancelled, result.Response!.Items[0].State);
        Assert.Equal("vacancy_version_mismatch", result.Response.Items[0].Error);
        Assert.Contains("cancelled:vacancy_version_mismatch", _repository.Writes);
    }

    [Fact]
    public async Task An_instrument_the_vacancy_does_not_list_is_refused_job_relatedness()
    {
        var result = await Assign(Input(("lia", null), ("personality", "Curiosidad")));

        Assert.Equal(ProviderAssignOutcome.InstrumentNotListedByVacancy, result.Outcome);
        Assert.Equal("personality", result.Detail);
        Assert.Empty(_repository.Writes); // all instruments or none
    }

    [Fact]
    public async Task An_instrument_with_no_reason_anywhere_is_refused()
    {
        var result = await Assign(Input(("english", null)));

        Assert.Equal(ProviderAssignOutcome.ReasonRequired, result.Outcome);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task Without_a_binding_or_with_the_instrument_disabled_nothing_is_assigned()
    {
        _repository.Binding = _repository.Binding! with { EnabledInstruments = ["english"] };
        Assert.Equal(ProviderAssignOutcome.InstrumentNotEnabled, (await Assign(Input(("lia", null)))).Outcome);

        _repository.Binding = null;
        Assert.Equal(ProviderAssignOutcome.NotEnabled, (await Assign(Input(("lia", null)))).Outcome);
        Assert.Empty(_provider.Calls);
    }

    [Fact]
    public async Task Candidate_vacancy_and_active_application_are_required()
    {
        _repository.Context = _repository.Context with { HasActiveApplication = false };
        Assert.Equal(ProviderAssignOutcome.NoActiveApplication, (await Assign(Input(("lia", null)))).Outcome);

        _repository.Context = _repository.Context with { VacancyFound = false };
        Assert.Equal(ProviderAssignOutcome.VacancyNotFound, (await Assign(Input(("lia", null)))).Outcome);

        _repository.Context = _repository.Context with { CandidateFound = false };
        Assert.Equal(ProviderAssignOutcome.CandidateNotFound, (await Assign(Input(("lia", null)))).Outcome);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task An_unconfigured_provider_refuses_before_any_write()
    {
        _provider.IsConfigured = false;

        Assert.Equal(ProviderAssignOutcome.ProviderUnconfigured, (await Assign(Input(("lia", null)))).Outcome);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task An_expiry_in_the_past_or_beyond_ninety_days_is_invalid()
    {
        var past = Input(("lia", null)) with { ExpiresAt = Now.AddMinutes(-1) };
        var far = Input(("lia", null)) with { ExpiresAt = Now.AddDays(91) };

        Assert.Equal(ProviderAssignOutcome.InvalidInput, (await Assign(past)).Outcome);
        Assert.Equal(ProviderAssignOutcome.InvalidInput, (await Assign(far)).Outcome);
    }

    [Theory]
    [InlineData("""{"candidateId":"c0000000-0000-4000-8000-000000000001","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[{"instrument":"lia"}]}""", true)]
    [InlineData("""{"candidateId":"c0000000-0000-4000-8000-000000000001","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[{"instrument":"lia","reason":"ok reason"}],"locale":"es-CR","timeMultiplier":1.25,"aids":["screen_reader"],"expiresAt":"2026-11-20T00:00:00Z"}""", true)]
    [InlineData("""{"candidateId":"c0000000-0000-4000-8000-000000000001","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[]}""", false)]
    [InlineData("""{"candidateId":"c0000000-0000-4000-8000-000000000001","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[{"instrument":"lia"},{"instrument":"lia"}]}""", false)]
    [InlineData("""{"candidateId":"c0000000-0000-4000-8000-000000000001","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[{"instrument":"astrology"}]}""", false)]
    [InlineData("""{"candidateId":"c0000000-0000-4000-8000-000000000001","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[{"instrument":"lia"}],"timeMultiplier":3.5}""", false)]
    [InlineData("""{"candidateId":"c0000000-0000-4000-8000-000000000001","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[{"instrument":"lia"}],"aids":["diagnosis:adhd"]}""", false)]
    [InlineData("""{"candidateId":"c0000000-0000-4000-8000-000000000001","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[{"instrument":"lia"}],"organizationId":"11111111-1111-1111-1111-111111111111"}""", false)]
    [InlineData("""{"candidateId":"not-a-guid","vacancyId":"a0000000-0000-4000-8000-000000000001","instruments":[{"instrument":"lia"}]}""", false)]
    public void The_body_is_parsed_strictly(string json, bool ok)
    {
        Assert.Equal(ok, AssignProviderInstrumentsUseCase.TryParseBody(JsonNode.Parse(json), out _));
    }
}
