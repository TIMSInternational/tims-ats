using Tims.Application.NineBox;
using Tims.Domain.Access;
using Tims.Domain.NineBox;
using Tims.Infrastructure.NineBox;

namespace Tims.IntegrationTests.NineBox;

/// <summary>
/// Phase-5 Slice 10 direct-repository tests (real Postgres + real RLS): each call runs UNDER TenantScope
/// (SET LOCAL ROLE app_tenant + org GUC), so these prove the EF queries + the ScopePredicateSqlTranslator row
/// filter fetch the right rows AND that RLS + the explicit org filter isolate the tenant (OrgB seeds a DISTINCT
/// evaluation). The scope predicates are constructed directly (as the succession/team-intel repo tests do); the
/// pure kernels are exhaustively golden-tested in the unit suite. Here we verify the DB wiring, the
/// scopeWhereFor drops, the teamId/unitId/companyId intersect, the calibration membership gate helpers, the
/// grid placement + movement only-on-change over real rows, and cross-org isolation end-to-end.
/// </summary>
[Collection("NineBoxRead")]
public sealed class NineBoxReadTests(NineBoxReadFixture fixture)
{
    private readonly NineBoxReadFixture _fixture = fixture;

    private NineBoxReadRepository NewRepo() => new(_fixture.NewReadContext());

    private static readonly GridFilter NoGridFilter = new(null, null, null);
    private static readonly MovementFilter NoMovementFilter = new(null, null);

    private static ScopePredicate TeamScope() =>
        new ScopePredicate.FieldIn("userId", NineBoxReadFixture.TeamMemberIds);

    private static string Org => NineBoxReadFixture.OrgA.ToString();

    // ── getGrid: org scope keeps all four (evaluatedAt desc) → gridPlacement cells + within-cell order ──
    [Fact]
    public async Task GetGrid_orgScope_allFour_evaluatedAtDesc_gridCellsAndOrder()
    {
        var evals = await NewRepo().GetGridEvaluationsAsync(
            Org, NineBoxReadFixture.Period, NoGridFilter, ScopePredicate.MatchAll, CancellationToken.None);

        Assert.Equal(4, evals.Count);
        // evaluatedAt desc: M4 (03-04), M3 (03-03), M2 (03-02), M1 (03-01).
        Assert.Equal(
            new[] { NineBoxReadFixture.M4Id, NineBoxReadFixture.M3Id, NineBoxReadFixture.M2Id, NineBoxReadFixture.M1Id }
                .Select(g => g.ToString()).ToArray(),
            evals.Select(e => e.UserId).ToArray());

        var grid = NineBoxKernels.GridPlacement(evals, e => e.Quadrant);
        Assert.Equal(new[] { "1-1", "3-2", "2-2" }, grid.Keys.ToArray());     // first-seen key order
        Assert.Equal(NineBoxReadFixture.M4Id.ToString(), grid["1-1"].Single().UserId); // risk
        Assert.Equal(NineBoxReadFixture.M3Id.ToString(), grid["3-2"].Single().UserId); // high_potential
        // 2-2 (core_player) preserves evaluatedAt-desc within the cell: M2 (03-02) before M1 (03-01).
        Assert.Equal(
            new[] { NineBoxReadFixture.M2Id, NineBoxReadFixture.M1Id }.Select(g => g.ToString()).ToArray(),
            grid["2-2"].Select(e => e.UserId).ToArray());
    }

    // ── scopeWhereFor row-drop BITE: team scope drops M4 (out of team) — grid + movement ──
    [Fact]
    public async Task GetGrid_teamScope_dropsOutOfTeamEvaluation()
    {
        // Neutralize the FilterInScopeAsync AND-clause (or the scope predicate) → M4 returns → this goes RED.
        var evals = await NewRepo().GetGridEvaluationsAsync(
            Org, NineBoxReadFixture.Period, NoGridFilter, TeamScope(), CancellationToken.None);

        Assert.Equal(3, evals.Count);
        Assert.DoesNotContain(evals, e => e.UserId == NineBoxReadFixture.M4Id.ToString());
        Assert.All(evals, e => Assert.Contains(e.UserId, NineBoxReadFixture.TeamMemberIds));
    }

    // ── teamId / unitId / companyId intersect (only narrow, never widen) ──
    [Fact]
    public async Task GetGrid_teamIdFilter_intersectsToTeamMembers()
    {
        var evals = await NewRepo().GetGridEvaluationsAsync(
            Org, NineBoxReadFixture.Period, new GridFilter(NineBoxReadFixture.Team1, null, null),
            ScopePredicate.MatchAll, CancellationToken.None);

        // user_teams members M1/M2/M3 → M4 excluded (not a team member).
        Assert.Equal(3, evals.Count);
        Assert.DoesNotContain(evals, e => e.UserId == NineBoxReadFixture.M4Id.ToString());
    }

    [Fact]
    public async Task GetGrid_companyIdFilter_intersectsToCompanyUsers()
    {
        var evals = await NewRepo().GetGridEvaluationsAsync(
            Org, NineBoxReadFixture.Period, new GridFilter(null, null, NineBoxReadFixture.CompanyC1),
            ScopePredicate.MatchAll, CancellationToken.None);

        // Only M1 has company_id = C1.
        Assert.Single(evals);
        Assert.Equal(NineBoxReadFixture.M1Id.ToString(), evals[0].UserId);
    }

    [Fact]
    public async Task GetGrid_unitIdFilter_intersectsToUnitTeamMembers()
    {
        var evals = await NewRepo().GetGridEvaluationsAsync(
            Org, NineBoxReadFixture.Period, new GridFilter(null, NineBoxReadFixture.BusinessUnitBu1, null),
            ScopePredicate.MatchAll, CancellationToken.None);

        // Teams in BU1 → T1 → members M1/M2/M3.
        Assert.Equal(3, evals.Count);
        Assert.DoesNotContain(evals, e => e.UserId == NineBoxReadFixture.M4Id.ToString());
    }

    // ── getMovementHistory: computeMovements only-on-change + ordering (org) ──
    [Fact]
    public async Task Movements_orgScope_twoTransitions()
    {
        var inputs = await NewRepo().GetMovementInputsAsync(
            Org, NoMovementFilter, ScopePredicate.MatchAll, CancellationToken.None);
        var movements = NineBoxKernels.ComputeMovements(inputs);

        Assert.Equal(2, movements.Count);
        var m1 = movements.Single(m => m.UserId == NineBoxReadFixture.M1Id.ToString());
        Assert.Equal("core_player", m1.From.Quadrant);
        Assert.Equal("star", m1.To.Quadrant);
        Assert.Equal("Mia One", m1.UserName);
        var m4 = movements.Single(m => m.UserId == NineBoxReadFixture.M4Id.ToString());
        Assert.Equal("risk", m4.From.Quadrant);
        Assert.Equal("underperformer", m4.To.Quadrant);
    }

    // ── scopeWhereFor drop BITE (movement): team scope keeps M1, drops M4 ──
    [Fact]
    public async Task Movements_teamScope_dropsOutOfTeam()
    {
        var inputs = await NewRepo().GetMovementInputsAsync(
            Org, NoMovementFilter, TeamScope(), CancellationToken.None);
        var movements = NineBoxKernels.ComputeMovements(inputs);

        var only = Assert.Single(movements);
        Assert.Equal(NineBoxReadFixture.M1Id.ToString(), only.UserId);
    }

    // ── getEmployeeDetail: evaluation (with email) + cross-period history asc ──
    [Fact]
    public async Task EmployeeDetail_evaluationAndHistory()
    {
        var repo = NewRepo();
        var evaluation = await repo.GetEmployeeEvaluationAsync(
            Org, NineBoxReadFixture.M1Id, "2026Q2", CancellationToken.None);
        var history = await repo.GetEmployeeHistoryAsync(Org, NineBoxReadFixture.M1Id, CancellationToken.None);

        Assert.NotNull(evaluation);
        Assert.Equal("star", evaluation!.Quadrant);
        Assert.Equal("m1@tims.test", evaluation.User.Email); // getEmployeeDetail user select INCLUDES email
        Assert.NotNull(evaluation.AxisBreakdown);            // jsonb passthrough
        Assert.Equal(2, history.Count);
        Assert.Equal(new[] { "core_player", "star" }, history.Select(h => h.Quadrant).ToArray()); // evaluatedAt asc
    }

    // ── getAxisBreakdown: present → view; absent period → null (endpoint 404s) ──
    [Fact]
    public async Task AxisBreakdown_presentAndAbsent()
    {
        var repo = NewRepo();
        var present = await repo.GetAxisBreakdownAsync(Org, NineBoxReadFixture.M1Id, "2026Q2", CancellationToken.None);
        Assert.NotNull(present);
        Assert.Equal("star", present!.Quadrant);
        Assert.NotNull(present.AxisBreakdown);

        var absent = await repo.GetAxisBreakdownAsync(Org, NineBoxReadFixture.M1Id, "9999Q9", CancellationToken.None);
        Assert.Null(absent);
    }

    // ── listCalibrations: org sessions createdAt desc + _count.members ──
    [Fact]
    public async Task ListCalibrations_createdAtDesc_withMemberCounts()
    {
        var rows = await NewRepo().ListCalibrationsAsync(Org, CancellationToken.None);

        Assert.Equal(2, rows.Count);
        Assert.Equal(NineBoxReadFixture.Session1.ToString(), rows[0].Id); // createdAt 05-02 (later) first
        Assert.Equal(NineBoxReadFixture.Session2.ToString(), rows[1].Id);
        Assert.Equal(2, rows[0].Count.Members); // CS1: M1, M2
        Assert.Equal(2, rows[1].Count.Members); // CS2: MemberReader, M3
    }

    // ── getCalibration gate helpers (hand-rolled membership) ──
    [Fact]
    public async Task CalibrationGateHelpers_anchorAndMembership()
    {
        var repo = NewRepo();

        var anchor = await repo.GetCalibrationAnchorAsync(Org, NineBoxReadFixture.Session1, CancellationToken.None);
        Assert.NotNull(anchor);
        Assert.Equal(NineBoxReadFixture.TeamLeadId, anchor!.CreatedById);

        var missing = await repo.GetCalibrationAnchorAsync(Org, Guid.NewGuid(), CancellationToken.None);
        Assert.Null(missing);

        // MemberReader IS a member of CS2 but NOT of CS1.
        Assert.True(await repo.IsCalibrationMemberAsync(
            Org, NineBoxReadFixture.Session2, NineBoxReadFixture.MemberReaderId, CancellationToken.None));
        Assert.False(await repo.IsCalibrationMemberAsync(
            Org, NineBoxReadFixture.Session1, NineBoxReadFixture.MemberReaderId, CancellationToken.None));
    }

    // ── getCalibration full: creator + members + votes ──
    [Fact]
    public async Task GetCalibration_full_creatorMembersVotes()
    {
        var repo = NewRepo();

        var cs1 = await repo.GetCalibrationAsync(Org, NineBoxReadFixture.Session1, CancellationToken.None);
        Assert.NotNull(cs1);
        Assert.Equal("Tara", cs1!.Creator.FirstName);
        Assert.Equal(2, cs1.Members.Count);
        Assert.Empty(cs1.Votes);

        var cs2 = await repo.GetCalibrationAsync(Org, NineBoxReadFixture.Session2, CancellationToken.None);
        Assert.NotNull(cs2);
        var vote = Assert.Single(cs2!.Votes);
        Assert.Equal(NineBoxReadFixture.M3Id.ToString(), vote.EvaluatedUser.Id);
        Assert.Equal(NineBoxReadFixture.MemberReaderId.ToString(), vote.Voter.Id);
        Assert.Equal("star", vote.Quadrant);
    }

    // ── myCalibrations: created-by OR member surfaces only the caller's own sessions ──
    [Fact]
    public async Task MyCalibrations_createdByOrMember()
    {
        var repo = NewRepo();

        // TeamLead created CS1 (not a member/creator of CS2).
        var lead = await repo.MyCalibrationsAsync(Org, NineBoxReadFixture.TeamLeadId, CancellationToken.None);
        Assert.Equal(new[] { NineBoxReadFixture.Session1.ToString() }, lead.Select(s => s.Id).ToArray());

        // MemberReader is a member of CS2 (not CS1) → CS2 with vote count 1.
        var member = await repo.MyCalibrationsAsync(Org, NineBoxReadFixture.MemberReaderId, CancellationToken.None);
        var only = Assert.Single(member);
        Assert.Equal(NineBoxReadFixture.Session2.ToString(), only.Id);
        Assert.Equal(1, only.Count.Votes);
        Assert.Equal(2, only.Count.Members);
    }

    // ── cross-org isolation under RLS ──
    [Fact]
    public async Task GetGrid_crossOrg_isolatedUnderRls()
    {
        var rows = await NewRepo().GetGridEvaluationsAsync(
            NineBoxReadFixture.OrgB.ToString(), NineBoxReadFixture.Period, NoGridFilter,
            ScopePredicate.MatchAll, CancellationToken.None);

        var only = Assert.Single(rows);
        Assert.Equal(NineBoxReadFixture.MbId.ToString(), only.UserId);
    }

    // ── getDashboardKpis counts + getBenchStrength kernel ──
    [Fact]
    public async Task KpiCounts_andBenchStrength()
    {
        var repo = NewRepo();

        var counts = await repo.GetKpiCountsAsync(Org, NineBoxReadFixture.Period, CancellationToken.None);
        Assert.Equal(4, counts.TotalEvaluations);   // M1/M2/M3/M4 Q1
        Assert.Equal(2, counts.CalibrationSessions); // CS1, CS2
        Assert.Equal(1, counts.ActiveCalibrations);  // CS1 draft (CS2 finalized excluded)

        var quadrants = await repo.GetPeriodQuadrantsAsync(Org, NineBoxReadFixture.Period, CancellationToken.None);
        var bench = NineBoxKernels.BuildBenchStrength(quadrants);
        Assert.Equal(4, bench.Total);
        Assert.Equal(1, bench.BenchStrength);        // high_potential (M3) counts; star Q1 is OrgB (isolated)
        Assert.Equal(25, bench.HighPotentialRatio);  // round(1/4*100)
    }
}
