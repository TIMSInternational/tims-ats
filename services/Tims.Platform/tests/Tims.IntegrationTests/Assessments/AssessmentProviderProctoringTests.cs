using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// Proctoring parity (owner decision 2026-11-11), against the real migration in a Postgres container: the settings table's
/// RLS and grants, tenant isolation of the settings, their audit, the proctoring snapshot on a reserved attempt, and the
/// outcome causes (completed_by, void reason) recorded on the attempt.
/// </summary>
[Collection("AssessmentProviderRls")]
public sealed class AssessmentProviderProctoringTests(AssessmentProviderSchemaFixture fixture)
{
    private static readonly AssessmentProctoring Strict =
        new(true, new AntiCheatPolicy(3, AntiCheatConsequences.AutoSubmit), false);

    [Fact]
    public async Task The_settings_table_forces_rls_with_the_tenant_policy_and_grants_no_delete()
    {
        const string table = AssessmentProviderDbContext.SettingsTable;
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = '{table}' AND relkind = 'r'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM pg_policies WHERE tablename = '{table}' AND policyname = 'tenant_isolation'"));
        foreach (var role in new[] { "anon", "authenticated" })
        {
            foreach (var privilege in new[] { "SELECT", "INSERT", "UPDATE", "DELETE" })
            {
                Assert.Equal(false, await fixture.ScalarAsync($"SELECT has_table_privilege('{role}', '{table}', '{privilege}')"));
            }
        }

        Assert.Equal(false, await fixture.ScalarAsync($"SELECT has_table_privilege('app_tenant', '{table}', 'DELETE')"));
        Assert.Equal(true, await fixture.ScalarAsync($"SELECT has_table_privilege('app_tenant', '{table}', 'UPDATE')"));
    }

    [Fact]
    public async Task Settings_are_saved_audited_and_never_visible_to_another_org()
    {
        var actor = Guid.NewGuid();
        await using (var db = fixture.NewContext())
        {
            var saved = await new AssessmentProviderRepository(db).SaveProctoringSettingsAsync(
                AssessmentProviderSchemaFixture.OrgB, actor, Strict, DateTimeOffset.UtcNow, CancellationToken.None);
            Assert.Equal(Strict, saved.Settings);
        }

        await using (var db = fixture.NewContext())
        {
            var repository = new AssessmentProviderRepository(db);
            Assert.Equal(Strict, (await repository.GetProctoringSettingsAsync(AssessmentProviderSchemaFixture.OrgB, CancellationToken.None))!.Settings);
        }

        // OrgA's tenant scope sees no row of OrgB's, and cannot change it.
        await using (var db = fixture.NewContext())
        {
            await using var scope = await TenantScope.BeginAsync(db, AssessmentProviderSchemaFixture.OrgA);
            Assert.False(await db.Settings.AnyAsync(s => s.OrganizationId == AssessmentProviderSchemaFixture.OrgB));
            var updated = await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE assessment_provider_settings SET proctoring_lockdown = false WHERE organization_id = {AssessmentProviderSchemaFixture.OrgB}");
            await scope.CommitAsync();
            Assert.Equal(0, updated);
        }

        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT proctoring_lockdown FROM assessment_provider_settings WHERE organization_id = '{AssessmentProviderSchemaFixture.OrgB}'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'assessment_provider_settings_updated' AND actor_id = '{actor}' " +
            $"AND organization_id = '{AssessmentProviderSchemaFixture.OrgB}' " +
            "AND changes->'proctoring'->'after'->>'antiCheatConsequence' = 'auto_submit' " +
            "AND (changes->'proctoring'->'before'->>'lockdown')::boolean = false"));
    }

    [Fact]
    public async Task OrgA_cannot_insert_settings_stamped_for_another_org()
    {
        await using var db = fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, AssessmentProviderSchemaFixture.OrgA);

        var ex = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO assessment_provider_settings (id, organization_id, updated_by_id) VALUES ({Guid.NewGuid()}, {Guid.NewGuid()}, {Guid.NewGuid()})"));

        Assert.Equal("42501", ex.SqlState); // the tenant_isolation policy's WITH CHECK
    }

    [Fact]
    public async Task A_second_save_updates_the_one_row_and_audits_what_it_replaced()
    {
        var org = AssessmentProviderSchemaFixture.OrgA;
        await using (var db = fixture.NewContext())
        {
            await new AssessmentProviderRepository(db).SaveProctoringSettingsAsync(
                org, Guid.NewGuid(), Strict, DateTimeOffset.UtcNow, CancellationToken.None);
        }

        var actor = Guid.NewGuid();
        var off = new AssessmentProctoring(false, null, false);
        await using (var db = fixture.NewContext())
        {
            await new AssessmentProviderRepository(db).SaveProctoringSettingsAsync(org, actor, off, DateTimeOffset.UtcNow, CancellationToken.None);
        }

        Assert.Equal(1L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_settings WHERE organization_id = '{org}'"));
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT anti_cheat_threshold IS NULL AND NOT proctoring_lockdown FROM assessment_provider_settings WHERE organization_id = '{org}'"));
        Assert.Equal("3", await fixture.ScalarAsync(
            $"SELECT changes->'proctoring'->'before'->>'antiCheatThreshold' FROM audit_logs WHERE action = 'assessment_provider_settings_updated' AND actor_id = '{actor}'"));
    }

    [Fact]
    public async Task A_reserved_attempt_stores_the_block_it_will_be_created_with_and_pca_stores_none()
    {
        var candidate = await NewCandidateAsync();
        var binding = new ProviderBindingRow(AssessmentProviderSchemaFixture.BindingA, AssessmentProviderSchemaFixture.OrgA,
            AssessmentProviderSchemaFixture.TenantA, ["lia", "pca"], "es");
        NewAttempt[] attempts =
        [
            new("lia", "Análisis de datos", "es", 1m, [], null, ProviderAgeBands.Adult, Strict),
            new("pca", "Perfil conductual", "es", 1m, [], null, ProviderAgeBands.Adult, Strict),
        ];

        await using (var db = fixture.NewContext())
        {
            var reserved = await new AssessmentProviderRepository(db).ReserveAttemptsAsync(AssessmentProviderSchemaFixture.OrgA,
                Guid.NewGuid(), binding, candidate, AssessmentProviderSchemaFixture.VacancyA, attempts, DateTimeOffset.UtcNow,
                CancellationToken.None);
            Assert.Equal(Strict, reserved.Attempts.Single(a => a.Instrument == "lia").Proctoring);
            Assert.Null(reserved.Attempts.Single(a => a.Instrument == "pca").Proctoring);
        }

        await using (var db = fixture.NewContext())
        {
            var repository = new AssessmentProviderRepository(db);
            var lia = await db.Attempts.AsNoTracking().IgnoreQueryFilters()
                .Where(a => a.CandidateId == candidate && a.Instrument == "lia").Select(a => a.Id).SingleAsync();
            var row = await repository.FindAttemptAsync(AssessmentProviderSchemaFixture.OrgA, lia, CancellationToken.None);
            Assert.Equal(Strict, row!.Proctoring);
        }

        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT proctoring_lockdown IS NULL AND proctoring_identity_check IS NULL FROM assessment_provider_attempts WHERE candidate_id = '{candidate}' AND instrument = 'pca'"));
    }

    [Fact]
    public async Task A_half_written_proctoring_snapshot_is_refused_by_the_table()
    {
        var ex = await Assert.ThrowsAsync<PostgresException>(() => fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET proctoring_lockdown = true WHERE id = '{AssessmentProviderSchemaFixture.AttemptA}'"));

        Assert.Equal("23514", ex.SqlState); // check_violation: lockdown without identity_check
    }

    [Fact]
    public async Task An_auto_submitted_completion_records_completed_by_and_a_late_cause_is_kept_once()
    {
        var attempt = await NewAttemptAsync("in_progress");
        await using (var db = fixture.NewContext())
        {
            Assert.True(await new AssessmentProviderRepository(db).AdvanceAttemptAsync(AssessmentProviderSchemaFixture.OrgA, attempt,
                ProviderAttemptStates.Completed, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, CancellationToken.None,
                ProviderCompletionCauses.ProctoringAutoSubmit));
        }

        Assert.Equal("proctoring_auto_submit", await fixture.ScalarAsync(
            $"SELECT completed_by FROM assessment_provider_attempts WHERE id = '{attempt}'"));

        // The poller saw the completion first (no completed_by), then the webhook brings the cause.
        var polledFirst = await NewAttemptAsync("result_ready");
        await using (var db = fixture.NewContext())
        {
            var repository = new AssessmentProviderRepository(db);
            Assert.True(await repository.AdvanceAttemptAsync(AssessmentProviderSchemaFixture.OrgA, polledFirst,
                ProviderAttemptStates.Completed, null, DateTimeOffset.UtcNow, CancellationToken.None,
                ProviderCompletionCauses.ProctoringAutoSubmit));
            Assert.False(await repository.AdvanceAttemptAsync(AssessmentProviderSchemaFixture.OrgA, polledFirst,
                ProviderAttemptStates.Completed, null, DateTimeOffset.UtcNow, CancellationToken.None,
                ProviderCompletionCauses.Candidate));
        }

        Assert.Equal("result_ready|proctoring_auto_submit", await fixture.ScalarAsync(
            $"SELECT state || '|' || completed_by FROM assessment_provider_attempts WHERE id = '{polledFirst}'"));
    }

    [Fact]
    public async Task A_proctoring_void_records_its_reason_and_an_unknown_reason_is_not_stored()
    {
        var voided = await NewAttemptAsync("in_progress");
        var unknown = await NewAttemptAsync("in_progress");
        await using (var db = fixture.NewContext())
        {
            var repository = new AssessmentProviderRepository(db);
            Assert.True(await repository.AdvanceAttemptAsync(AssessmentProviderSchemaFixture.OrgA, voided,
                ProviderAttemptStates.Voided, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, CancellationToken.None,
                ProviderVoidReasons.ProctoringVoid));
            Assert.True(await repository.AdvanceAttemptAsync(AssessmentProviderSchemaFixture.OrgA, unknown,
                ProviderAttemptStates.Voided, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, CancellationToken.None,
                "something_new"));
            var row = await repository.FindAttemptAsync(AssessmentProviderSchemaFixture.OrgA, voided, CancellationToken.None);
            Assert.Equal(ProviderVoidReasons.ProctoringVoid, row!.VoidReason);
        }

        Assert.Equal(DBNull.Value, await fixture.ScalarAsync($"SELECT void_reason FROM assessment_provider_attempts WHERE id = '{unknown}'"));
    }

    private async Task<Guid> NewCandidateAsync()
    {
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{AssessmentProviderSchemaFixture.OrgA}', 'Pro', 'Ctor', 'pro@a.example')");
        return candidate;
    }

    private async Task<Guid> NewAttemptAsync(string state)
    {
        // A fresh candidate per attempt: one open lia attempt per candidate and vacancy.
        var candidate = await NewCandidateAsync();
        var attempt = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
            INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                instrument_version, content_version, assigned_by_id)
            VALUES ('{attempt}', '{AssessmentProviderSchemaFixture.OrgA}', '{AssessmentProviderSchemaFixture.BindingA}', '{candidate}',
                '{AssessmentProviderSchemaFixture.VacancyA}', 'lia', '{state}', 'selection', 'Análisis de datos', 'es', 1,
                gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1', gen_random_uuid())
            """);
        return attempt;
    }
}
