using Npgsql;
using Tims.Application.Audit;
using Tims.Application.Compensation;
using Tims.Domain.Access;
using Tims.Domain.Compensation;
using Tims.Infrastructure.Access;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.Compensation;

namespace Tims.IntegrationTests.Compensation;

/// <summary>
/// Phase-5 Slice 12 Testcontainers proof (real Postgres + real RLS + the real CHECK, NEVER mocked) of the
/// compensation WRITE data path — direct repository + use case under TenantScope. Covers: the createAdjustment
/// currency fallback + pending INSERT (INV-7); the approve transition + comp propagation vs the reject
/// no-propagation; the TOCTOU count-0 CONFLICT (INV-1); the two-write atomicity rollback (INV-2); the fail-closed
/// audit-before-mutation (INV-4); cross-org RLS isolation; and the assertScoped('salaryAdjustment') by-id IDOR
/// probe (INV-6). Every op runs UNDER TenantScope (SET LOCAL ROLE app_tenant + org GUC).
/// </summary>
[Collection("CompensationWrite")]
public sealed class CompensationWriteTests(CompensationWriteFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset EffectiveDate = new(2026, 7, 1, 0, 0, 0, TimeSpan.Zero);

    private string Org => CompensationWriteFixture.OrgA.ToString();

    private CompensationWriteRepository Repo() => new(fixture.NewWriteContext());

    private CompensationWriteUseCase UseCase(bool auditToMissingDb = false)
    {
        var repo = new CompensationWriteRepository(fixture.NewWriteContext());
        var auditor = new DataAccessAuditWriter(fixture.NewAuditContext(
            auditToMissingDb ? fixture.MissingAuditConnectionString : null));
        return new CompensationWriteUseCase(repo, auditor);
    }

    private static CreateAdjustmentCommand Create(Guid userId, string? currency) =>
        new(userId, "merit", 80000, 90000, currency, "reason", EffectiveDate);

    // ── createAdjustment: pending INSERT + currency fallback (INV-7) ──
    [Fact]
    public async Task Create_inserts_pending_row_with_caller_and_subject_currency_fallback()
    {
        var result = await UseCase().CreateAdjustmentAsync(
            Org, CompensationWriteFixture.OrgHrId, Create(CompensationWriteFixture.WcId, currency: null),
            Now, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("pending", result!.Status);
        Assert.True(Guid.TryParse(result.Id, out var id));

        await using var connection = await fixture.OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT status, currency, requested_by_id, user_id, new_salary FROM salary_adjustments WHERE id = @id";
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("pending", reader.GetString(0));
        Assert.Equal("EUR", reader.GetString(1)); // fallback to WC's EUR comp currency (no input currency)
        Assert.Equal(CompensationWriteFixture.OrgHrId, reader.GetGuid(2)); // requestedById = caller
        Assert.Equal(CompensationWriteFixture.WcId, reader.GetGuid(3));
        Assert.Equal(90000, reader.GetDouble(4));
    }

    [Fact]
    public async Task Create_falls_back_to_USD_when_subject_has_no_comp_row()
    {
        var result = await UseCase().CreateAdjustmentAsync(
            Org, CompensationWriteFixture.OrgHrId, Create(CompensationWriteFixture.OrgHrId, currency: null),
            Now, CancellationToken.None);

        Assert.Equal("USD", await CurrencyOf(Guid.Parse(result!.Id))); // OrgHr has no comp row → USD
    }

    [Fact]
    public async Task Create_uses_valid_input_currency_over_the_subject_fallback()
    {
        var result = await UseCase().CreateAdjustmentAsync(
            Org, CompensationWriteFixture.OrgHrId, Create(CompensationWriteFixture.WcId, "gbp"),
            Now, CancellationToken.None);

        Assert.Equal("GBP", await CurrencyOf(Guid.Parse(result!.Id))); // input wins, normalized upper
    }

    [Fact]
    public async Task GetSubjectCompensationCurrency_returns_subject_currency_or_null()
    {
        Assert.Equal("EUR", await Repo().GetSubjectCompensationCurrencyAsync(Org, CompensationWriteFixture.WcId, CancellationToken.None));
        Assert.Null(await Repo().GetSubjectCompensationCurrencyAsync(Org, CompensationWriteFixture.OrgHrId, CancellationToken.None));
    }

    // ── createAdjustment H1: a cross-org subject must be REJECTED with no INSERT ──
    // assertSubjectInScope no-ops for organization/company scope (enforces SCOPE, not org membership), so an
    // org-scoped caller could otherwise persist a cross-tenant salary_adjustments.userId (an org-A row
    // referencing an org-B employee — the FK EXISTS-check bypasses RLS). Surfaced by the write-verification
    // harness (both stacks). RED before the SubjectExistsInOrgAsync backstop.
    [Fact]
    public async Task Create_for_a_cross_org_subject_is_rejected_with_no_insert()
    {
        var result = await UseCase().CreateAdjustmentAsync(
            Org, CompensationWriteFixture.OrgHrId, Create(CompensationWriteFixture.OrgBHrId, currency: null),
            Now, CancellationToken.None);

        Assert.Null(result); // → 403 at the endpoint

        await using var connection = await fixture.OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT count(*) FROM salary_adjustments WHERE user_id = @u AND requested_by_id = @c";
        command.Parameters.AddWithValue("u", CompensationWriteFixture.OrgBHrId);
        command.Parameters.AddWithValue("c", CompensationWriteFixture.OrgHrId);
        Assert.Equal(0L, (long)(await command.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task SubjectExistsInOrg_true_for_in_org_and_false_for_cross_org()
    {
        Assert.True(await Repo().SubjectExistsInOrgAsync(Org, CompensationWriteFixture.WcId, CancellationToken.None));
        Assert.False(await Repo().SubjectExistsInOrgAsync(Org, CompensationWriteFixture.OrgBHrId, CancellationToken.None));
    }

    // ── approve applied: status→approved, comp propagated, exactly one audit row (INV-4 success) ──
    [Fact]
    public async Task Approve_applied_transitions_and_propagates_and_audits_once()
    {
        var result = await UseCase().ApproveAsync(
            Org, CompensationWriteFixture.AdjRa, CompensationWriteFixture.OrgHrId,
            CompensationWriteFixture.OrgHrId.ToString(), approved: true, "1.2.3.4", "agent", Now, CancellationToken.None);

        Assert.Equal(ApproveOutcome.Applied, result.Outcome);
        Assert.Equal("approved", result.Status);

        Assert.Equal("approved", await fixture.GetAdjustmentStatusAsync(CompensationWriteFixture.AdjRa));
        Assert.Equal(CompensationWriteFixture.OrgHrId, await fixture.GetAdjustmentApproverAsync(CompensationWriteFixture.AdjRa));
        var comp = await fixture.GetCompAsync(CompensationWriteFixture.RaId);
        Assert.Equal(45000, comp!.Value.Salary); // new_salary propagated
        Assert.Equal(1, await fixture.CountUpdateAuditRowsAsync(CompensationWriteFixture.AdjRa)); // fail-closed audit landed
    }

    // ── reject: status→rejected, NO comp propagation ──
    [Fact]
    public async Task Approve_rejected_transitions_without_touching_compensation()
    {
        var result = await UseCase().ApproveAsync(
            Org, CompensationWriteFixture.AdjRr, CompensationWriteFixture.OrgHrId,
            CompensationWriteFixture.OrgHrId.ToString(), approved: false, null, null, Now, CancellationToken.None);

        Assert.Equal(ApproveOutcome.Applied, result.Outcome);
        Assert.Equal("rejected", result.Status);
        Assert.Equal("rejected", await fixture.GetAdjustmentStatusAsync(CompensationWriteFixture.AdjRr));
        var comp = await fixture.GetCompAsync(CompensationWriteFixture.RrId);
        Assert.Equal(41000, comp!.Value.Salary); // UNCHANGED (a reject never propagates)
    }

    // ── load-null (already-processed) via the use case ⇒ NotFound (no CONFLICT, no mutation) ──
    [Fact]
    public async Task Approve_already_processed_via_usecase_is_NotFound()
    {
        var result = await UseCase().ApproveAsync(
            Org, CompensationWriteFixture.AdjRc, CompensationWriteFixture.OrgHrId,
            CompensationWriteFixture.OrgHrId.ToString(), approved: true, null, null, Now, CancellationToken.None);

        Assert.Equal(ApproveOutcome.NotFound, result.Outcome); // AdjRc is 'approved' → findFirst(pending) null
    }

    // ── repo-level conditional guard: a non-pending row ⇒ count 0 ⇒ Conflict ──
    [Fact]
    public async Task Repo_approve_on_non_pending_is_conflict()
    {
        var outcome = await Repo().ApproveAsync(
            Org, CompensationWriteFixture.AdjRc, CompensationWriteFixture.OrgHrId, "approved",
            applyCompensation: true, CompensationWriteFixture.RcId, 50000, "USD", Now, CancellationToken.None);

        Assert.Equal(ApproveOutcome.Conflict, outcome);
    }

    // ── cross-org RLS: an OrgA caller cannot see/flip an OrgB adjustment ──
    [Fact]
    public async Task Cross_org_load_is_null_and_repo_approve_is_conflict()
    {
        Assert.Null(await Repo().LoadPendingAdjustmentAsync(Org, CompensationWriteFixture.AdjOrgB, CancellationToken.None));

        var outcome = await Repo().ApproveAsync(
            Org, CompensationWriteFixture.AdjOrgB, CompensationWriteFixture.OrgHrId, "approved",
            applyCompensation: true, CompensationWriteFixture.Mb1Id, 55000, "USD", Now, CancellationToken.None);
        Assert.Equal(ApproveOutcome.Conflict, outcome); // RLS hides the OrgB row → the pending predicate matches 0

        Assert.Equal("pending", await fixture.GetAdjustmentStatusAsync(CompensationWriteFixture.AdjOrgB)); // untouched
    }

    // ── INV-1 TOCTOU: two concurrent approves → exactly one Applied, one Conflict; comp applied once ──
    [Fact]
    public async Task Concurrent_approves_yield_one_applied_and_one_conflict()
    {
        var row = await Repo().LoadPendingAdjustmentAsync(Org, CompensationWriteFixture.AdjRt, CancellationToken.None);
        Assert.NotNull(row);

        async Task<ApproveOutcome> Attempt() => await Repo().ApproveAsync(
            Org, CompensationWriteFixture.AdjRt, CompensationWriteFixture.OrgHrId, "approved",
            applyCompensation: true, row!.UserId, row.NewSalary, row.Currency, Now, CancellationToken.None);

        var outcomes = await Task.WhenAll(Attempt(), Attempt());

        Assert.Equal(1, outcomes.Count(o => o == ApproveOutcome.Applied));
        Assert.Equal(1, outcomes.Count(o => o == ApproveOutcome.Conflict));
        Assert.Equal("approved", await fixture.GetAdjustmentStatusAsync(CompensationWriteFixture.AdjRt));
        var comp = await fixture.GetCompAsync(CompensationWriteFixture.RtId);
        Assert.Equal(47000, comp!.Value.Salary); // propagated exactly once
    }

    // ── INV-2 Atomicity: the comp write faults (CHECK) → the status transition rolls back ──
    [Fact]
    public async Task Atomicity_comp_write_fault_rolls_back_the_status_transition()
    {
        // AdjRn carries new_salary -100 → the SECOND write (SET current_salary = -100) violates the CHECK.
        await Assert.ThrowsAsync<PostgresException>(() => Repo().ApproveAsync(
            Org, CompensationWriteFixture.AdjRn, CompensationWriteFixture.OrgHrId, "approved",
            applyCompensation: true, CompensationWriteFixture.RnId, -100, "USD", Now, CancellationToken.None));

        // The status transition was rolled back with the faulted comp write — the adjustment stays pending.
        Assert.Equal("pending", await fixture.GetAdjustmentStatusAsync(CompensationWriteFixture.AdjRn));
        Assert.Null(await fixture.GetAdjustmentApproverAsync(CompensationWriteFixture.AdjRn));
        var comp = await fixture.GetCompAsync(CompensationWriteFixture.RnId);
        Assert.Equal(43000, comp!.Value.Salary); // comp untouched
    }

    // ── INV-4 BITE: a fail-closed audit failure aborts BEFORE the mutation (nothing changes) ──
    [Fact]
    public async Task FailClosed_audit_failure_prevents_the_mutation()
    {
        await Assert.ThrowsAsync<AuditWriteFailedException>(() => UseCase(auditToMissingDb: true).ApproveAsync(
            Org, CompensationWriteFixture.AdjRf, CompensationWriteFixture.OrgHrId,
            CompensationWriteFixture.OrgHrId.ToString(), approved: true, null, null, Now, CancellationToken.None));

        Assert.Equal("pending", await fixture.GetAdjustmentStatusAsync(CompensationWriteFixture.AdjRf)); // no transition
        var comp = await fixture.GetCompAsync(CompensationWriteFixture.RfId);
        Assert.Equal(44000, comp!.Value.Salary); // no propagation
        Assert.Equal(0, await fixture.CountUpdateAuditRowsAsync(CompensationWriteFixture.AdjRf)); // audit never landed
    }

    // ── INV-6: the assertScoped('salaryAdjustment') by-id IDOR probe (the NEW probe root this slice) ──
    [Fact]
    public async Task Probe_passes_for_in_scope_adjustment_for_a_team_leader()
    {
        // AdjApprove targets M1, a member of TeamLead's team → in team scope → the probe passes (no throw).
        await using var anchors = Anchors(CompensationWriteFixture.OrgA, CompensationWriteFixture.TeamLeadId);
        await Probe().AssertScopedAsync(
            ScopedEntity.SalaryAdjustment, CompensationWriteFixture.AdjApprove, AccessScope.Team, anchors,
            CompensationWriteFixture.OrgA, CompensationWriteFixture.TeamLeadId, CancellationToken.None);
    }

    [Fact]
    public async Task Probe_throws_NotFound_for_out_of_scope_adjustment()
    {
        // AdjOutScope targets Emp, NOT in TeamLead's team → out of scope → 404 (never confirms the id exists).
        await using var anchors = Anchors(CompensationWriteFixture.OrgA, CompensationWriteFixture.TeamLeadId);
        var ex = await Assert.ThrowsAsync<ScopedNotFoundException>(() => Probe().AssertScopedAsync(
            ScopedEntity.SalaryAdjustment, CompensationWriteFixture.AdjOutScope, AccessScope.Team, anchors,
            CompensationWriteFixture.OrgA, CompensationWriteFixture.TeamLeadId, CancellationToken.None));
        Assert.Equal("Ajuste salarial no encontrado", ex.Message);
    }

    [Fact]
    public async Task Probe_throws_NotFound_for_cross_org_adjustment()
    {
        // AdjOrgB belongs to OrgB; probed under OrgA → RLS hides it AND the org filter excludes it → 404.
        await using var anchors = Anchors(CompensationWriteFixture.OrgA, CompensationWriteFixture.TeamLeadId);
        await Assert.ThrowsAsync<ScopedNotFoundException>(() => Probe().AssertScopedAsync(
            ScopedEntity.SalaryAdjustment, CompensationWriteFixture.AdjOrgB, AccessScope.Team, anchors,
            CompensationWriteFixture.OrgA, CompensationWriteFixture.TeamLeadId, CancellationToken.None));
    }

    // ── INV-5: assertSubjectInScope gates the TARGET userId (create write-rule) ──
    [Fact]
    public async Task SubjectInScope_allows_a_team_member_and_denies_an_outsider()
    {
        await using var anchors = Anchors(CompensationWriteFixture.OrgA, CompensationWriteFixture.TeamLeadId);
        var lead = CompensationWriteFixture.TeamLeadId.ToString();

        Assert.True(await SubjectInScope.IsSatisfiedAsync(
            AccessScope.Team, anchors, lead, CompensationWriteFixture.M1Id.ToString(), CancellationToken.None));
        Assert.False(await SubjectInScope.IsSatisfiedAsync(
            AccessScope.Team, anchors, lead, CompensationWriteFixture.EmpId.ToString(), CancellationToken.None));
    }

    private ScopedProbe Probe() => new(new TestAnchorContextFactory(fixture.ConnectionString));

    private EfAnchorLoader Anchors(Guid org, Guid user) =>
        new(new AnchorDbContext(AnchorProbeFixture.BuildOptions(fixture.ConnectionString)), org, user);

    private async Task<string> CurrencyOf(Guid adjustmentId)
    {
        await using var connection = await fixture.OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT currency FROM salary_adjustments WHERE id = @id";
        command.Parameters.AddWithValue("id", adjustmentId);
        return (string)(await command.ExecuteScalarAsync())!;
    }
}
