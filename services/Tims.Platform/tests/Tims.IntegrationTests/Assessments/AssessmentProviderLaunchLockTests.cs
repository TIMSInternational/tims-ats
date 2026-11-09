using Tims.Application.Assessments.Providers;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// The launch's #312 check inside the candidate lock, against the real migration, RLS and the same advisory lock the
/// withdrawal takes: a withdrawal committed before the launch's transaction stops it before the provider is called; one
/// that starts while the provider call is in flight waits for the launch to commit and then stages the launched attempt;
/// a same-email sibling's withdrawal (its own lock) that stages the attempt during the call makes the launch withdrawn.
/// </summary>
[Collection("AssessmentProviderRls")]
public sealed class AssessmentProviderLaunchLockTests(AssessmentProviderSchemaFixture fixture)
{
    private static readonly Guid Org = AssessmentProviderSchemaFixture.OrgA;

    private static ProviderCall<ProviderLaunch> Hosted() => ProviderCall<ProviderLaunch>.Success(
        new ProviderLaunch("native", DateTimeOffset.UtcNow.AddMinutes(5), "https://player.test/launch/code", ["https://ats.test"]));

    private async Task<Guid> CandidateAsync(string email)
    {
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{Org}', 'Lu', 'Lock', '{email}')");
        return candidate;
    }

    private Task WithdrawAsync(Guid candidate) => fixture.ExecuteAsync(
        $"INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, withdrawn_at) VALUES (gen_random_uuid(), '{Org}', '{candidate}', 'recruitment_data_processing', now())");

    private async Task<Guid> AttemptAsync(Guid candidate)
    {
        var attempt = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 instrument_version, content_version, assigned_by_id)
             VALUES ('{attempt}', '{Org}', '{AssessmentProviderSchemaFixture.BindingA}', '{candidate}', gen_random_uuid(), 'lia',
                 'created', 'selection', 'Análisis de datos', 'es', 1, gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1',
                 gen_random_uuid())
             """);
        return attempt;
    }

    private async Task<string?> RowAsync(Guid attempt) => (string?)await fixture.ScalarAsync(
        $"SELECT state || '|' || coalesce(last_error_code, '') || '|' || coalesce(withdrawal_state, '') || '|' || (last_launched_at IS NOT NULL)::text FROM assessment_provider_attempts WHERE id = '{attempt}'");

    [Fact]
    public async Task A_withdrawal_committed_before_the_launch_transaction_stops_it_before_the_provider_is_called()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example");
        var attempt = await AttemptAsync(candidate);
        await WithdrawAsync(candidate); // committed after the use case's early, unlocked check

        await using var db = fixture.NewContext();
        var called = false;
        var outcome = await new AssessmentProviderRepository(db).LaunchUnderCandidateLockAsync(Org, attempt, (_, _) =>
        {
            called = true;
            return Task.FromResult(Hosted());
        }, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal(LockedLaunchOutcome.ConsentWithdrawn, outcome.Outcome);
        Assert.False(called);
        Assert.Equal("created|||false", await RowAsync(attempt));
    }

    [Fact]
    public async Task A_withdrawal_that_starts_during_the_provider_call_waits_and_then_stages_the_launched_attempt()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example");
        var attempt = await AttemptAsync(candidate);
        var inCall = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        await using var launchDb = fixture.NewContext();
        var launch = new AssessmentProviderRepository(launchDb).LaunchUnderCandidateLockAsync(Org, attempt, async (_, _) =>
        {
            inCall.SetResult();
            await release.Task;
            return Hosted();
        }, DateTimeOffset.UtcNow, CancellationToken.None);
        await inCall.Task.WaitAsync(TimeSpan.FromSeconds(10));

        // The withdrawal commits its consent row, then stages under the SAME candidate lock (as the #312 transaction does).
        await WithdrawAsync(candidate);
        await using var stageDb = fixture.NewContext();
        var stage = new AssessmentProviderRepository(stageDb).StageConsentWithdrawalAsync(
            Org, candidate, DateTimeOffset.UtcNow, CancellationToken.None);
        await Task.Delay(500);
        Assert.False(stage.IsCompleted, "the withdrawal's staging did not wait for the launch holding the candidate lock");

        release.SetResult();
        var outcome = await launch;
        Assert.Equal(LockedLaunchOutcome.Called, outcome.Outcome);
        Assert.Equal(1, await stage);

        // Launched first, then staged for the cascade: cancelled with the cleanup marker, so the provider cancel follows.
        Assert.Equal("cancelled|provider_cancel_pending|pending|true", await RowAsync(attempt));
    }

    [Fact]
    public async Task A_sibling_withdrawal_that_stages_the_attempt_during_the_call_is_never_overwritten()
    {
        var email = $"{Guid.NewGuid():N}@a.example";
        var candidate = await CandidateAsync(email);
        var sibling = await CandidateAsync(email.ToUpperInvariant());
        var attempt = await AttemptAsync(candidate);

        await using var launchDb = fixture.NewContext();
        var outcome = await new AssessmentProviderRepository(launchDb).LaunchUnderCandidateLockAsync(Org, attempt, async (_, _) =>
        {
            // The sibling's withdrawal takes only ITS candidate lock, so it is not blocked by ours.
            await WithdrawAsync(sibling);
            await using var stageDb = fixture.NewContext();
            var staged = await new AssessmentProviderRepository(stageDb).StageConsentWithdrawalAsync(
                Org, sibling, DateTimeOffset.UtcNow, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));
            Assert.Equal(1, staged);
            return Hosted();
        }, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal(LockedLaunchOutcome.ConsentWithdrawn, outcome.Outcome);
        Assert.Equal("cancelled|provider_cancel_pending|pending|false", await RowAsync(attempt));
        Assert.Equal(0L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'assessment_provider_launched' AND entity_id = '{attempt}'"));
    }

    [Fact]
    public async Task A_successful_launch_moves_created_to_launched_with_its_audit_row()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example");
        var attempt = await AttemptAsync(candidate);

        await using var db = fixture.NewContext();
        var outcome = await new AssessmentProviderRepository(db).LaunchUnderCandidateLockAsync(
            Org, attempt, (_, _) => Task.FromResult(Hosted()), DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal((LockedLaunchOutcome.Called, "launched"), (outcome.Outcome, outcome.State));
        Assert.Equal("launched|||true", await RowAsync(attempt));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'assessment_provider_launched' AND entity_id = '{attempt}'"));
    }
}
