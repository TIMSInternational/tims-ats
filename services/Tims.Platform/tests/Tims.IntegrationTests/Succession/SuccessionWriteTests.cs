using Tims.Application.Succession;
using Tims.Domain.Access;
using Tims.Domain.Succession;
using Tims.Infrastructure.Access;
using Tims.Infrastructure.Succession;

namespace Tims.IntegrationTests.Succession;

/// <summary>
/// Phase-5 Slice 14 Testcontainers proof (real Postgres + real RLS + the real UNIQUE, NEVER mocked) of the
/// succession WRITE data path — direct repository + use case + scope primitives under TenantScope. Covers: the
/// addCriticalRole full-row INSERT; the addSuccessor caller-provenance + nested-user INSERT (INV-4); the dedup
/// 23505 → CONFLICT with NO second row (INV-5); the remove/update return shapes + the TOCTOU null; cross-org RLS
/// isolation (INV-9); the assertScoped('successor') by-id IDOR probe (INV-6); and the assertSubjectInScope
/// write-rule (INV-3 primitive). Every op runs UNDER TenantScope (SET LOCAL ROLE app_tenant + org GUC).
/// </summary>
[Collection("SuccessionWrite")]
public sealed class SuccessionWriteTests(SuccessionWriteFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    private string Org => SuccessionWriteFixture.OrgA.ToString();

    private SuccessionWriteRepository Repo() => new(fixture.NewWriteContext());

    // ── addCriticalRole: full-row INSERT (org value, target_band_level null, client-set id + timestamps) ──
    [Fact]
    public async Task AddCriticalRole_inserts_full_row_with_org_and_null_band()
    {
        var input = new AddCriticalRoleInput("Chief Widget Officer", "POS-1", SuccessionWriteFixture.M1Id, null, null, "high", 0.42);
        var row = await Repo().AddCriticalRoleAsync(Org, input, Now, CancellationToken.None);

        Assert.NotNull(row);
        Assert.True(Guid.TryParse(row!.Id, out var id));
        Assert.Equal(Org, row.OrganizationId);
        Assert.Equal("Chief Widget Officer", row.Title);
        Assert.Equal("POS-1", row.PositionId);
        Assert.Equal(SuccessionWriteFixture.M1Id.ToString(), row.CurrentHolderId);
        Assert.Equal("high", row.Criticality);
        Assert.Equal(0.42, row.FlightRisk);
        Assert.Null(row.TargetBandLevel); // never settable on create
        Assert.Equal(Now, row.CreatedAt);
        Assert.Equal(Now, row.UpdatedAt);
        Assert.True(await fixture.RoleExistsAsync(id));
    }

    // ── Codex H2: addCriticalRole with all-in-org optional FK refs SUCCEEDS (the validation allows valid refs) ──
    [Fact]
    public async Task AddCriticalRole_with_in_org_refs_succeeds()
    {
        var input = new AddCriticalRoleInput(
            "Regional Lead", null, SuccessionWriteFixture.M1Id, SuccessionWriteFixture.CompanyA, SuccessionWriteFixture.UnitA, "medium", null);
        var row = await Repo().AddCriticalRoleAsync(Org, input, Now, CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal(SuccessionWriteFixture.M1Id.ToString(), row!.CurrentHolderId);
        Assert.Equal(SuccessionWriteFixture.CompanyA.ToString(), row.CompanyId);
        Assert.Equal(SuccessionWriteFixture.UnitA.ToString(), row.UnitId);
    }

    // ── Codex H2: addCriticalRole rejects a cross-org currentHolderId / companyId / unitId → null (→ 400), no INSERT ──
    [Theory]
    [InlineData("holder")]
    [InlineData("company")]
    [InlineData("unit")]
    public async Task AddCriticalRole_cross_org_reference_is_null_and_no_insert(string which)
    {
        var input = new AddCriticalRoleInput(
            "Cross Org Role",
            null,
            which == "holder" ? SuccessionWriteFixture.Mb1Id : null,   // OrgB user
            which == "company" ? SuccessionWriteFixture.CompanyB : null, // OrgB company
            which == "unit" ? SuccessionWriteFixture.UnitB : null,       // OrgB business unit
            "high",
            null);

        var row = await Repo().AddCriticalRoleAsync(Org, input, Now, CancellationToken.None);
        Assert.Null(row);
    }

    // ── Codex H1: addSuccessor with a cross-org userId → SubjectNotInOrg (→ 403), NO row created ──
    [Fact]
    public async Task AddSuccessor_cross_org_user_is_subject_not_in_org_and_no_insert()
    {
        // Mb1 is an OrgB user. Under the OrgA TenantScope the users lookup is RLS-filtered to OrgA → null → the
        // org/company-scope assertSubjectInScope no-op would have let this through; the repo backstop rejects it.
        var input = new AddSuccessorInput(SuccessionWriteFixture.CrRepoAdd, SuccessionWriteFixture.Mb1Id, "ready_now", "internal", null);
        var result = await Repo().AddSuccessorAsync(Org, SuccessionWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.Equal(AddSuccessorOutcome.SubjectNotInOrg, result.Outcome);
        Assert.Null(result.Row);
        Assert.Equal(0, await fixture.CountSuccessorsAsync(SuccessionWriteFixture.CrRepoAdd, SuccessionWriteFixture.Mb1Id));
    }

    // ── addSuccessor: provenance (addedById = caller) + nested user projection (INV-4) ──
    [Fact]
    public async Task AddSuccessor_stamps_caller_provenance_and_projects_user()
    {
        // Repo bypasses the endpoint's subject-scope (that gate is Api-layer) — M3 exists as a user.
        var input = new AddSuccessorInput(SuccessionWriteFixture.CrRepoAdd, SuccessionWriteFixture.M3Id, "ready_2_years", "internal", "grow into it");
        var result = await Repo().AddSuccessorAsync(Org, SuccessionWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.Equal(AddSuccessorOutcome.Created, result.Outcome);
        var row = result.Row!;
        Assert.Equal(Org, row.OrganizationId);
        Assert.Equal(SuccessionWriteFixture.CrRepoAdd.ToString(), row.CriticalRoleId);
        Assert.Equal(SuccessionWriteFixture.M3Id.ToString(), row.UserId);
        Assert.Equal("ready_2_years", row.Readiness);
        Assert.Equal("internal", row.Type);
        Assert.Equal("grow into it", row.DevelopmentPlan);
        // addedById is the caller, server-side (never from input).
        Assert.Equal(SuccessionWriteFixture.OrgAdminId.ToString(), row.AddedById);
        Assert.Equal(SuccessionWriteFixture.OrgAdminId, await fixture.GetSuccessorAddedByAsync(Guid.Parse(row.Id)));
        // Nested user { id, firstName, lastName, avatar } — M3 = Moe Three.
        Assert.Equal(SuccessionWriteFixture.M3Id.ToString(), row.User.Id);
        Assert.Equal("Moe", row.User.FirstName);
        Assert.Equal("Three", row.User.LastName);
        Assert.Null(row.User.Avatar);
    }

    // ── addSuccessor dedup: a 2nd add of the same (criticalRoleId, userId) → CONFLICT, NO second row (INV-5) ──
    [Fact]
    public async Task AddSuccessor_duplicate_is_conflict_and_creates_no_second_row()
    {
        // SuccRepoDup already seeds (CrRepoDup, M1). A fresh add of the same pair must trip the real UNIQUE.
        var input = new AddSuccessorInput(SuccessionWriteFixture.CrRepoDup, SuccessionWriteFixture.M1Id, "ready_now", "internal", null);
        var result = await Repo().AddSuccessorAsync(Org, SuccessionWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.Equal(AddSuccessorOutcome.Conflict, result.Outcome);
        Assert.Null(result.Row);
        // Still exactly one (CrRepoDup, M1) row — the failed INSERT rolled back atomically.
        Assert.Equal(1, await fixture.CountSuccessorsAsync(SuccessionWriteFixture.CrRepoDup, SuccessionWriteFixture.M1Id));
    }

    // ── removeSuccessor: returns the deleted row + the row is gone ──
    [Fact]
    public async Task RemoveSuccessor_returns_deleted_row_and_deletes()
    {
        var deleted = await Repo().RemoveSuccessorAsync(Org, SuccessionWriteFixture.SuccRepoRemove, CancellationToken.None);

        Assert.NotNull(deleted);
        Assert.Equal(SuccessionWriteFixture.SuccRepoRemove.ToString(), deleted!.Id);
        Assert.Equal(SuccessionWriteFixture.CrRepoAdd.ToString(), deleted.CriticalRoleId);
        Assert.Equal(SuccessionWriteFixture.M1Id.ToString(), deleted.UserId);
        Assert.False(await fixture.SuccessorExistsAsync(SuccessionWriteFixture.SuccRepoRemove));
    }

    // ── removeSuccessor TOCTOU: a second remove of the vanished row → null (the endpoint maps this to 404) ──
    [Fact]
    public async Task RemoveSuccessor_second_call_on_vanished_row_is_null()
    {
        Assert.NotNull(await Repo().RemoveSuccessorAsync(Org, SuccessionWriteFixture.SuccRepoRemove2, CancellationToken.None));
        Assert.Null(await Repo().RemoveSuccessorAsync(Org, SuccessionWriteFixture.SuccRepoRemove2, CancellationToken.None));
    }

    // ── cross-org RLS: an OrgA caller cannot delete an OrgB successor (INV-9) ──
    [Fact]
    public async Task RemoveSuccessor_cross_org_is_null_and_untouched()
    {
        Assert.Null(await Repo().RemoveSuccessorAsync(Org, SuccessionWriteFixture.SuccOrgB, CancellationToken.None));
        Assert.True(await fixture.SuccessorExistsAsync(SuccessionWriteFixture.SuccOrgB)); // RLS hid it → no delete
    }

    // ── updateSuccessorReadiness: readiness always set; developmentPlan applied when present ──
    [Fact]
    public async Task UpdateSuccessorReadiness_sets_readiness_and_development_plan()
    {
        var input = new UpdateSuccessorReadinessInput("ready_now", "sharpen leadership", HasDevelopmentPlan: true);
        var updated = await Repo().UpdateSuccessorReadinessAsync(Org, SuccessionWriteFixture.SuccRepoUpd, input, Now, CancellationToken.None);

        Assert.NotNull(updated);
        Assert.Equal("ready_now", updated!.Readiness);
        Assert.Equal("sharpen leadership", updated.DevelopmentPlan);
        Assert.Equal("ready_now", await fixture.GetSuccessorReadinessAsync(SuccessionWriteFixture.SuccRepoUpd));
        Assert.Equal("sharpen leadership", await fixture.GetSuccessorDevelopmentPlanAsync(SuccessionWriteFixture.SuccRepoUpd));
    }

    // ── updateSuccessorReadiness: an ABSENT developmentPlan is SKIPPED (never nulled) — Prisma undefined-skip parity ──
    [Fact]
    public async Task UpdateSuccessorReadiness_skips_development_plan_when_absent()
    {
        var input = new UpdateSuccessorReadinessInput("ready_1_year", DevelopmentPlan: null, HasDevelopmentPlan: false);
        var updated = await Repo().UpdateSuccessorReadinessAsync(Org, SuccessionWriteFixture.SuccRepoUpdSkip, input, Now, CancellationToken.None);

        Assert.NotNull(updated);
        Assert.Equal("ready_1_year", updated!.Readiness);
        Assert.Equal("keep me", updated.DevelopmentPlan); // UNCHANGED (seeded value survives)
        Assert.Equal("keep me", await fixture.GetSuccessorDevelopmentPlanAsync(SuccessionWriteFixture.SuccRepoUpdSkip));
    }

    [Fact]
    public async Task UpdateSuccessorReadiness_cross_org_is_null()
    {
        var input = new UpdateSuccessorReadinessInput("ready_now", null, HasDevelopmentPlan: false);
        Assert.Null(await Repo().UpdateSuccessorReadinessAsync(Org, SuccessionWriteFixture.SuccOrgB, input, Now, CancellationToken.None));
    }

    // ── updateCriticalRoleBand: narrow {id, targetBandLevel}; set then clear-to-null (INV-7) ──
    [Fact]
    public async Task UpdateCriticalRoleBand_sets_then_clears_and_returns_narrow_shape()
    {
        var set = await Repo().UpdateCriticalRoleBandAsync(
            Org, SuccessionWriteFixture.CrRepoBand, new UpdateCriticalRoleBandInput("L7"), Now, CancellationToken.None);
        Assert.NotNull(set);
        Assert.Equal(SuccessionWriteFixture.CrRepoBand.ToString(), set!.Id);
        Assert.Equal("L7", set.TargetBandLevel);
        Assert.Equal("L7", await fixture.GetRoleBandAsync(SuccessionWriteFixture.CrRepoBand));

        var cleared = await Repo().UpdateCriticalRoleBandAsync(
            Org, SuccessionWriteFixture.CrRepoBand, new UpdateCriticalRoleBandInput(null), Now, CancellationToken.None);
        Assert.NotNull(cleared);
        Assert.Null(cleared!.TargetBandLevel);
        Assert.Null(await fixture.GetRoleBandAsync(SuccessionWriteFixture.CrRepoBand));
    }

    [Fact]
    public async Task UpdateCriticalRoleBand_cross_org_is_null_and_untouched()
    {
        Assert.Null(await Repo().UpdateCriticalRoleBandAsync(
            Org, SuccessionWriteFixture.CrOrgB, new UpdateCriticalRoleBandInput("HACK"), Now, CancellationToken.None));
        Assert.Equal("LB", await fixture.GetRoleBandAsync(SuccessionWriteFixture.CrOrgB)); // untouched
    }

    // ── INV-6: the assertScoped('successor') by-id IDOR probe (the NEW probe root this slice) ──
    [Fact]
    public async Task Probe_successor_passes_for_in_scope_row()
    {
        // SuccProbeIn's subject is M2 (a member of TeamLead's team) → in team scope → the probe passes (no throw).
        await using var anchors = Anchors(SuccessionWriteFixture.OrgA, SuccessionWriteFixture.TeamLeadId);
        await Probe().AssertScopedAsync(
            ScopedEntity.Successor, SuccessionWriteFixture.SuccProbeIn, AccessScope.Team, anchors,
            SuccessionWriteFixture.OrgA, SuccessionWriteFixture.TeamLeadId, CancellationToken.None);
    }

    [Fact]
    public async Task Probe_successor_throws_NotFound_for_out_of_scope_row()
    {
        // SuccProbeOut's subject is M3 (NOT in TeamLead's team) → out of scope → 404 (never confirms the id exists).
        await using var anchors = Anchors(SuccessionWriteFixture.OrgA, SuccessionWriteFixture.TeamLeadId);
        var ex = await Assert.ThrowsAsync<ScopedNotFoundException>(() => Probe().AssertScopedAsync(
            ScopedEntity.Successor, SuccessionWriteFixture.SuccProbeOut, AccessScope.Team, anchors,
            SuccessionWriteFixture.OrgA, SuccessionWriteFixture.TeamLeadId, CancellationToken.None));
        Assert.Equal("Sucesor no encontrado", ex.Message);
    }

    [Fact]
    public async Task Probe_successor_throws_NotFound_for_cross_org_row()
    {
        // SuccOrgB belongs to OrgB; probed under OrgA → RLS hides it AND the org filter excludes it → 404.
        await using var anchors = Anchors(SuccessionWriteFixture.OrgA, SuccessionWriteFixture.TeamLeadId);
        await Assert.ThrowsAsync<ScopedNotFoundException>(() => Probe().AssertScopedAsync(
            ScopedEntity.Successor, SuccessionWriteFixture.SuccOrgB, AccessScope.Team, anchors,
            SuccessionWriteFixture.OrgA, SuccessionWriteFixture.TeamLeadId, CancellationToken.None));
    }

    // ── INV-3 (primitive): assertSubjectInScope gates the TARGET userId of addSuccessor ──
    [Fact]
    public async Task SubjectInScope_allows_a_team_member_and_denies_an_outsider()
    {
        await using var anchors = Anchors(SuccessionWriteFixture.OrgA, SuccessionWriteFixture.TeamLeadId);
        var lead = SuccessionWriteFixture.TeamLeadId.ToString();

        Assert.True(await SubjectInScope.IsSatisfiedAsync(
            AccessScope.Team, anchors, lead, SuccessionWriteFixture.M1Id.ToString(), CancellationToken.None));
        Assert.False(await SubjectInScope.IsSatisfiedAsync(
            AccessScope.Team, anchors, lead, SuccessionWriteFixture.M3Id.ToString(), CancellationToken.None));
    }

    private ScopedProbe Probe() => new(new TestAnchorContextFactory(fixture.ConnectionString));

    private EfAnchorLoader Anchors(Guid org, Guid user) =>
        new(new AnchorDbContext(AnchorProbeFixture.BuildOptions(fixture.ConnectionString)), org, user);
}
