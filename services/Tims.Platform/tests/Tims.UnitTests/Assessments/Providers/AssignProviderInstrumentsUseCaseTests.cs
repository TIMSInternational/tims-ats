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
    public async Task An_org_without_a_link_out_instrument_sends_no_candidate_pii()
    {
        _repository.Binding = _repository.Binding! with { EnabledInstruments = ["lia", "english"] };

        await Assign(Input(("lia", null)));

        var subject = Assert.Single(_provider.Subjects).Request;
        Assert.Equal(FakeRepository.Candidate.ToString(), subject.ExternalRef);
        Assert.Null(subject.GivenName);
        Assert.Null(subject.FamilyName);
        Assert.Null(subject.Email);
    }

    [Fact]
    public async Task Native_then_pca_for_one_candidate_works_when_the_org_enables_pca()
    {
        // The org's binding enables PCA, so the subject gets names and email from the FIRST assignment, even a native
        // one: the provider never updates a subject, and a later PCA must find them there to be launchable.
        await Assign(Input(("lia", null)));
        var pca = await Assign(Input(("pca", null)));

        Assert.Equal("Ana", _provider.Subjects[0].Request.GivenName);
        Assert.Equal("ana@example.com", _provider.Subjects[0].Request.Email);
        Assert.Equal(ProviderAssignOutcome.Ok, pca.Outcome);
        Assert.Equal(ProviderAttemptStates.Created, pca.Response!.Items[0].State);
        Assert.Contains("assignment:pca", _provider.Calls);
    }

    [Fact]
    public async Task A_pca_for_a_subject_the_provider_holds_without_names_is_refused_before_any_assignment()
    {
        // The subject was created while the org had no link-out instrument; PCA was enabled later. The provider returns
        // the old subject unchanged, so the PCA would be unlaunchable (422 subject_data_required at launch).
        _repository.Binding = _repository.Binding! with { EnabledInstruments = ["lia", "english"] };
        await Assign(Input(("lia", null)));
        _repository.Binding = _repository.Binding with { EnabledInstruments = ["lia", "english", "pca"] };

        var pca = await Assign(Input(("pca", null)));

        Assert.Equal(ProviderAssignOutcome.Incomplete, pca.Outcome);
        Assert.Equal(ProviderAttemptStates.Cancelled, pca.Response!.Items[0].State);
        Assert.Equal(ProviderFailure.SubjectDataRequired, pca.Response.Items[0].Error);
        Assert.DoesNotContain("assignment:pca", _provider.Calls);
        Assert.NotEqual(_provider.Subjects[0].Key, _provider.Subjects[1].Key); // a different body never reuses a key
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
    public async Task Every_item_echoes_the_accommodation_and_locale_in_force()
    {
        var result = await Assign(Input(("lia", null)));

        var item = Assert.Single(result.Response!.Items);
        Assert.Equal(1.5m, item.TimeMultiplier);
        Assert.Equal(["extended_breaks"], item.Aids);
        Assert.Equal("es", item.Locale);
    }

    [Theory]
    [InlineData(2.0, "extended_breaks", null)] // a corrected multiplier
    [InlineData(1.5, "screen_reader", null)] // other aids
    [InlineData(1.5, "extended_breaks", "en")] // another locale
    public async Task Re_sending_with_other_terms_is_a_conflict_naming_the_open_attempt_never_a_silent_200(
        double multiplier, string aid, string? locale)
    {
        var first = await Assign(Input(("lia", null)));
        var corrected = Input(("lia", null)) with { TimeMultiplier = (decimal)multiplier, Aids = [aid], Locale = locale };

        var result = await Assign(corrected);

        Assert.Equal(ProviderAssignOutcome.OpenAttemptTermsDiffer, result.Outcome);
        var open = Assert.Single(result.Response!.Items);
        Assert.Equal(first.Response!.Items[0].AttemptId, open.AttemptId);
        Assert.Equal(1.5m, open.TimeMultiplier); // the terms still in force, so HR sees what was NOT applied
        Assert.Equal(["extended_breaks"], open.Aids);
        Assert.Equal(AssignProviderInstrumentsUseCase.OpenAttemptTermsDifferCode, open.Error);
        Assert.Single(_repository.Attempts);
        Assert.Single(_provider.Assignments);
    }

    [Fact]
    public async Task A_terms_conflict_on_one_instrument_writes_none_of_the_others()
    {
        await Assign(Input(("lia", null)));
        var writes = _repository.Writes.Count;

        var result = await Assign(Input(("lia", null), ("english", "Atención a clientes en inglés")) with { TimeMultiplier = 2m });

        Assert.Equal(ProviderAssignOutcome.OpenAttemptTermsDiffer, result.Outcome);
        Assert.Equal("lia", result.Detail);
        Assert.DoesNotContain(_repository.Attempts, a => a.Instrument == "english");
        Assert.Equal(writes + 1, _repository.Writes.Count); // the reserve call only
    }

    [Fact]
    public async Task After_a_staff_cancel_the_corrected_accommodation_is_assigned_as_a_new_attempt()
    {
        var first = await Assign(Input(("lia", null)));
        var attempt = _repository.Attempts.Single();
        var cancel = await new CancelProviderAttemptUseCase(_repository, _provider).CancelAsync(
            FakeRepository.Org, Actor, attempt, Now, CancellationToken.None);

        var corrected = await Assign(Input(("lia", null)) with { TimeMultiplier = 2m });

        Assert.Equal(ProviderCancelOutcome.Cancelled, cancel.Outcome);
        Assert.Equal(ProviderAssignOutcome.Ok, corrected.Outcome);
        Assert.NotEqual(first.Response!.Items[0].AttemptId, corrected.Response!.Items[0].AttemptId);
        Assert.Equal(2m, corrected.Response.Items[0].TimeMultiplier);
        Assert.Equal(2m, _provider.Assignments[1].Request.TimeMultiplier);
    }

    [Fact]
    public async Task A_create_that_lands_after_a_staff_cancel_is_cancelled_at_the_provider_too()
    {
        Guid? created = null;
        _provider.OnCreateAssignment = request =>
        {
            // While the create is in flight, HR cancels the still pending attempt.
            var pending = _repository.Attempts.Single();
            new CancelProviderAttemptUseCase(_repository, _provider)
                .CancelAsync(FakeRepository.Org, Actor, pending, Now, CancellationToken.None).GetAwaiter().GetResult();
            var answer = FakeProvider.Created(request);
            created = answer.Value!.AssignmentId;
            return answer;
        };

        var result = await Assign(Input(("lia", null)));

        var item = Assert.Single(result.Response!.Items);
        Assert.Equal(ProviderAttemptStates.Cancelled, item.State);
        Assert.Equal(AssignProviderInstrumentsUseCase.AttemptCancelledCode, item.Error);
        Assert.False(result.Response.Complete);
        Assert.Equal([created!.Value], _provider.Cancelled); // the orphan does not keep a reserved use
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
    public async Task A_retry_that_meets_the_first_create_still_in_flight_does_not_cancel_its_attempt()
    {
        // The client retries while the first request's create is still running at the provider: the provider answers the
        // retry 409 idempotency_key_in_use for the same key. The first request then completes and must find its attempt
        // still pending, attach the provider ids and report it created, not cancelled.
        ProviderAssignResult? retry = null;
        var calls = 0;
        _provider.OnCreateAssignment = request =>
        {
            if (++calls == 1)
            {
                retry = Assign(Input(("lia", null))).GetAwaiter().GetResult();
                return FakeProvider.Created(request);
            }

            return ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(409, "idempotency_key_in_use", false, []));
        };

        var first = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAssignOutcome.Incomplete, retry!.Outcome);
        Assert.Equal(ProviderAttemptStates.PendingCreate, retry.Response!.Items[0].State);
        Assert.Equal("idempotency_key_in_use", retry.Response.Items[0].Error);
        Assert.Equal(ProviderAssignOutcome.Ok, first.Outcome);
        Assert.Equal(ProviderAttemptStates.Created, first.Response!.Items[0].State);
        var attempt = Assert.Single(_repository.Attempts);
        Assert.Equal(ProviderAttemptStates.Created, attempt.State);
        Assert.NotNull(attempt.ProviderAssignmentId);
        Assert.DoesNotContain(_repository.Writes, w => w.StartsWith("cancelled:", StringComparison.Ordinal));
        Assert.Equal(_provider.Assignments[0].Key, _provider.Assignments[1].Key); // one provider assignment, one key
    }

    [Theory]
    [InlineData(409, "idempotency_key_in_use")] // another request with this key is still creating it
    [InlineData(422, "idempotency_key_reused")] // an earlier body under this key may have created it
    [InlineData(422, "a_code_added_in_a_minor_version")] // unknown codes are not proof of a refusal
    [InlineData(401, "unauthorized")]
    [InlineData(null, ProviderFailure.ContractViolation)] // an off-contract 2xx: the resource exists
    [InlineData(503, ProviderFailure.Unavailable)]
    public async Task An_answer_that_does_not_prove_nothing_was_created_keeps_the_attempt_pending(int? status, string code)
    {
        _provider.OnCreateAssignment = _ => ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(status, code, status >= 500, []));

        var result = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAssignOutcome.Incomplete, result.Outcome);
        Assert.Equal(ProviderAttemptStates.PendingCreate, result.Response!.Items[0].State);
        Assert.Equal(ProviderAttemptStates.PendingCreate, Assert.Single(_repository.Attempts).State);
        Assert.Contains("pending:" + code, _repository.Writes);
    }

    [Theory]
    [InlineData(400, "invalid_request")]
    [InlineData(404, "not_found")]
    [InlineData(409, "vacancy_version_mismatch")]
    [InlineData(410, "subject_erased")]
    [InlineData(422, "accommodation_not_supported")]
    [InlineData(422, "instrument_not_offered_for_selection")]
    public async Task A_contract_refusal_cancels_the_attempt(int status, string code)
    {
        _provider.OnCreateAssignment = _ => ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(status, code, false, []));

        var result = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAttemptStates.Cancelled, result.Response!.Items[0].State);
        Assert.Contains("cancelled:" + code, _repository.Writes);
    }

    [Fact]
    public async Task An_off_contract_create_answer_keeps_the_attempt_pending_because_the_assignment_exists()
    {
        _provider.OnCreateAssignment = request => FakeProvider.Created(request with { Instrument = "english" });

        var result = await Assign(Input(("lia", null)));

        Assert.Equal(ProviderAttemptStates.PendingCreate, result.Response!.Items[0].State);
        Assert.Equal(ProviderFailure.ContractViolation, result.Response.Items[0].Error);
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
