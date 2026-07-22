using Tims.Domain.Access;
using Tims.Infrastructure.Access;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.5b Part B: exercises EVERY <see cref="ScopePredicate"/> node type end-to-end over real SQL
/// via <see cref="ScopedProbe.AssertScopedAsync"/> for a TEAM-scoped leader U1. In-scope ids pass;
/// out-of-scope, cross-org, and soft-deleted ids throw <see cref="ScopedNotFoundException"/>.
/// </summary>
[Collection("AnchorProbe")]
public sealed class ScopedProbeTests(AnchorProbeFixture fixture)
{
    private const AccessScope Team = AccessScope.Team;

    private ScopedProbe Probe() => new(new TestAnchorContextFactory(fixture.ConnectionString));

    private EfAnchorLoader Anchors(Guid org, Guid user) =>
        new(new AnchorDbContext(AnchorProbeFixture.BuildOptions(fixture.ConnectionString)), org, user);

    private async Task AssertInScope(ScopedEntity entity, Guid id)
    {
        await using var anchors = Anchors(AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
        await Probe().AssertScopedAsync(
            entity, id, Team, anchors, AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
    }

    private async Task<ScopedNotFoundException> AssertThrows(ScopedEntity entity, Guid id, Guid org)
    {
        await using var anchors = Anchors(AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
        return await Assert.ThrowsAsync<ScopedNotFoundException>(() =>
            Probe().AssertScopedAsync(entity, id, Team, anchors, org, AnchorProbeFixture.U1));
    }

    // ---- Vacancy: team-arm, assignedTo-arm, out-of-scope, soft-delete, cross-org ----------
    [Fact]
    public async Task Vacancy_in_scope_via_team_arm_passes() =>
        await AssertInScope(ScopedEntity.Vacancy, AnchorProbeFixture.V1);

    [Fact]
    public async Task Vacancy_in_scope_via_assignedTo_arm_passes() =>
        await AssertInScope(ScopedEntity.Vacancy, AnchorProbeFixture.V3);

    [Fact]
    public async Task Vacancy_out_of_scope_throws_not_found()
    {
        var ex = await AssertThrows(ScopedEntity.Vacancy, AnchorProbeFixture.V2, AnchorProbeFixture.OrgA);
        Assert.Equal("Vacante no encontrada", ex.Message);
    }

    [Fact]
    public async Task Vacancy_soft_deleted_throws_not_found() =>
        await AssertThrows(ScopedEntity.Vacancy, AnchorProbeFixture.VDel, AnchorProbeFixture.OrgA);

    [Fact]
    public async Task Vacancy_cross_org_throws_not_found() =>
        // Vb belongs to Org B; probed under Org A → RLS hides it AND the org filter excludes it.
        await AssertThrows(ScopedEntity.Vacancy, AnchorProbeFixture.Vb, AnchorProbeFixture.OrgA);

    // ---- Candidate: via applications → vacancy (RelationSome + RelationTo), soft-delete ----
    [Fact]
    public async Task Candidate_in_scope_via_application_passes() =>
        await AssertInScope(ScopedEntity.Candidate, AnchorProbeFixture.C1);

    [Fact]
    public async Task Candidate_out_of_scope_throws_not_found()
    {
        var ex = await AssertThrows(ScopedEntity.Candidate, AnchorProbeFixture.C2, AnchorProbeFixture.OrgA);
        Assert.Equal("Candidato no encontrado", ex.Message);
    }

    [Fact]
    public async Task Candidate_soft_deleted_throws_not_found() =>
        await AssertThrows(ScopedEntity.Candidate, AnchorProbeFixture.CDel, AnchorProbeFixture.OrgA);

    // ---- Application: via vacancy (RelationTo) --------------------------------------------
    [Fact]
    public async Task Application_in_scope_passes() =>
        await AssertInScope(ScopedEntity.Application, AnchorProbeFixture.A1);

    [Fact]
    public async Task Application_out_of_scope_throws_not_found() =>
        await AssertThrows(ScopedEntity.Application, AnchorProbeFixture.A2, AnchorProbeFixture.OrgA);

    // ---- Offer: via vacancy (RelationTo) — the staff pre-employment-validation write's probe root ----
    [Fact]
    public async Task Offer_in_scope_passes() =>
        await AssertInScope(ScopedEntity.Offer, AnchorProbeFixture.OA1);

    [Fact]
    public async Task Offer_out_of_scope_throws_not_found()
    {
        var ex = await AssertThrows(ScopedEntity.Offer, AnchorProbeFixture.OA2, AnchorProbeFixture.OrgA);
        Assert.Equal("Oferta no encontrada", ex.Message);
    }

    // ---- Interview: OR[ via vacancy, evaluators.some ] ------------------------------------
    [Fact]
    public async Task Interview_in_scope_via_vacancy_and_panel_passes() =>
        await AssertInScope(ScopedEntity.Interview, AnchorProbeFixture.I1);

    [Fact]
    public async Task Interview_in_scope_via_panel_arm_only_passes() =>
        // I4's vacancy (V2) is OUT of team scope; U1 is an evaluator → the panel OR-arm still passes.
        await AssertInScope(ScopedEntity.Interview, AnchorProbeFixture.I4);

    [Fact]
    public async Task Interview_out_of_scope_throws_not_found() =>
        await AssertThrows(ScopedEntity.Interview, AnchorProbeFixture.I3, AnchorProbeFixture.OrgA);

    // ---- OKR: userId in teamMembers (FieldIn) --------------------------------------------
    [Fact]
    public async Task Okr_in_scope_team_member_passes() =>
        await AssertInScope(ScopedEntity.Okr, AnchorProbeFixture.O1);

    [Fact]
    public async Task Okr_in_scope_self_passes() =>
        await AssertInScope(ScopedEntity.Okr, AnchorProbeFixture.O3);

    [Fact]
    public async Task Okr_out_of_scope_throws_not_found() =>
        await AssertThrows(ScopedEntity.Okr, AnchorProbeFixture.O2, AnchorProbeFixture.OrgA);

    // ---- Team: id in ledTeams (FieldIn) --------------------------------------------------
    [Fact]
    public async Task Team_in_scope_led_passes() =>
        await AssertInScope(ScopedEntity.Team, AnchorProbeFixture.T1);

    [Fact]
    public async Task Team_out_of_scope_throws_not_found() =>
        await AssertThrows(ScopedEntity.Team, AnchorProbeFixture.T2, AnchorProbeFixture.OrgA);

    // ---- CriticalRole: currentHolderId in teamMembers (Phase-5 Slice 8 probe root) ---------
    [Fact]
    public async Task CriticalRole_in_scope_via_holder_passes() =>
        // CR1's current holder (U2) is a member of the team U1 leads → in team scope.
        await AssertInScope(ScopedEntity.CriticalRole, AnchorProbeFixture.CR1);

    [Fact]
    public async Task CriticalRole_out_of_scope_throws_not_found()
    {
        // CR2's holder (U4) is on team T2 (not U1's) → out of scope → NOT_FOUND.
        var ex = await AssertThrows(ScopedEntity.CriticalRole, AnchorProbeFixture.CR2, AnchorProbeFixture.OrgA);
        Assert.Equal("Rol critico no encontrado", ex.Message);
    }

    [Fact]
    public async Task CriticalRole_null_holder_throws_not_found() =>
        // An unfilled role (current_holder_id NULL) is hidden from a narrow scope (Prisma `in` never
        // matches NULL; fail-narrow) → NOT_FOUND.
        await AssertThrows(ScopedEntity.CriticalRole, AnchorProbeFixture.CRNull, AnchorProbeFixture.OrgA);

    [Fact]
    public async Task CriticalRole_cross_org_throws_not_found() =>
        await AssertThrows(ScopedEntity.CriticalRole, AnchorProbeFixture.CRb, AnchorProbeFixture.OrgA);

    // ---- Unregistered entity → clear InvalidOperationException (never silently passes) -----
    // AssessmentAssignment shares offer/application's viaVacancy predicate but has NO probe-table map
    // registered yet (its surface isn't built in C#) — so it must still fail loud, not silently pass.
    [Fact]
    public async Task Unregistered_entity_throws_invalid_operation()
    {
        await using var anchors = Anchors(AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Probe().AssertScopedAsync(
                ScopedEntity.AssessmentAssignment, AnchorProbeFixture.V1, Team, anchors,
                AnchorProbeFixture.OrgA, AnchorProbeFixture.U1));
    }
}
