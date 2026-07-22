using Tims.Application.Succession;
using Tims.Domain.Access;
using Tims.Domain.Succession;
using Tims.Infrastructure.Succession;

namespace Tims.IntegrationTests.Succession;

/// <summary>
/// Phase-5 Slice 8 direct-repository tests (real Postgres + real RLS): each call runs UNDER TenantScope
/// (SET LOCAL ROLE app_tenant + org GUC), so these prove the EF queries + the ScopePredicateSqlTranslator
/// row filter fetch the right rows AND that RLS + the explicit org filter isolate the tenant (OrgB seeds a
/// DISTINCT role). The scope predicates are constructed directly (as the team-intel repo tests do); the pure
/// kernels are exhaustively golden-tested in the unit suite. Here we verify the DB wiring, the scopeWhereFor
/// drops (role AND nested successor), field-authed comp reads, and cross-org isolation end-to-end.
/// </summary>
[Collection("SuccessionRead")]
public sealed class SuccessionReadTests(SuccessionReadFixture fixture)
{
    private readonly SuccessionReadFixture _fixture = fixture;

    private SuccessionReadRepository NewRepo() => new(_fixture.NewReadContext());

    private static readonly CriticalRoleFilters NoFilters = new(null, null, null, null);

    private static ScopePredicate TeamRoleScope() =>
        new ScopePredicate.FieldIn("currentHolderId", SuccessionReadFixture.TeamMemberIds);

    private static ScopePredicate TeamSuccessorScope() =>
        new ScopePredicate.FieldIn("userId", SuccessionReadFixture.TeamMemberIds);

    [Fact]
    public async Task ListCriticalRoles_orgScope_returnsAllThree_titleAsc_withSuccessors()
    {
        var rows = await NewRepo().ListCriticalRolesAsync(
            SuccessionReadFixture.OrgA.ToString(), NoFilters, ScopePredicate.MatchAll, ScopePredicate.MatchAll, CancellationToken.None);

        Assert.Equal(3, rows.Count);
        Assert.Equal(new[] { "Alpha", "Beta", "Gamma" }, rows.Select(r => r.Title).ToArray()); // title asc
        var alpha = rows.Single(r => r.Title == "Alpha");
        Assert.Equal(3, alpha.Successors.Count); // S1, S2, S3 (org scope keeps all)
    }

    [Fact]
    public async Task ListCriticalRoles_teamScope_dropsOutOfScopeRole_andOutOfScopeSuccessor()
    {
        var rows = await NewRepo().ListCriticalRolesAsync(
            SuccessionReadFixture.OrgA.ToString(), NoFilters, TeamRoleScope(), TeamSuccessorScope(), CancellationToken.None);

        // scopeWhereFor('criticalRole'): Beta (holder OrgReader, out of team) drops → only Alpha + Gamma.
        Assert.Equal(new[] { "Alpha", "Gamma" }, rows.Select(r => r.Title).ToArray());

        // scopeWhereFor('successor'): Alpha's S3 (OrgReader, out of team) drops → only S1 (M1) + S2 (M2).
        var alpha = rows.Single(r => r.Title == "Alpha");
        Assert.Equal(2, alpha.Successors.Count);
        Assert.All(alpha.Successors, s => Assert.Contains(s.UserId, SuccessionReadFixture.TeamMemberIds));
    }

    [Fact]
    public async Task ListCriticalRoles_crossOrg_isolated_underRls()
    {
        // OrgB caller sees only its own role (RLS + org filter); the OrgA roles never bleed in.
        var rows = await NewRepo().ListCriticalRolesAsync(
            SuccessionReadFixture.OrgB.ToString(), NoFilters, ScopePredicate.MatchAll, ScopePredicate.MatchAll, CancellationToken.None);

        Assert.Single(rows);
        Assert.Equal("OrgB Role", rows[0].Title);
    }

    [Fact]
    public async Task GetCriticalRole_orgScope_hasHolderEmailAndAddedBy()
    {
        var row = await NewRepo().GetCriticalRoleAsync(
            SuccessionReadFixture.OrgA.ToString(), SuccessionReadFixture.CriticalRole1, ScopePredicate.MatchAll, CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal("Alpha", row!.Title);
        Assert.Equal("m1@tims.test", row.CurrentHolder!.Email); // getCriticalRole holder select INCLUDES email
        Assert.Equal(3, row.Successors.Count);
        Assert.All(row.Successors, s => Assert.NotNull(s.AddedByUser)); // addedBy include
    }

    [Fact]
    public async Task DashboardCounts_OrgA_underRls()
    {
        var counts = await NewRepo().GetDashboardCountsAsync(SuccessionReadFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Equal(3, counts.TotalCriticalRoles);      // CR1, CR2, CR3
        Assert.Equal(5, counts.TotalSuccessors);          // S1, S2, S3, S4, S6
        Assert.Equal(0, counts.RolesWithoutSuccessor);    // all three roles now have ≥1 successor
        Assert.Equal(1, counts.HighFlightRiskRoles);      // CR1 (0.9 >= 0.7)
        Assert.Equal(3, counts.ReadyNowCount);            // S1, S4, S6
        Assert.Equal(1, counts.Ready1To2YearsCount);      // S2
    }

    [Fact]
    public async Task CompGap_entitled_orgCompScope_detectsBothGaps_withHalfUpGapPercent()
    {
        // Org/company comp scope (MatchAll → TRUE no-op) → BOTH ready_now-on-banded-role successors alert:
        // M1 (userA) 87500 < 90000 → gapPercent round(12.5)=13; M4 (userB) 80000 < 90000 → gapPercent 20.
        var data = await NewRepo().GetCompGapDataAsync(
            SuccessionReadFixture.OrgA.ToString(), includeCurrentSalary: true, includeCurrency: true, ScopePredicate.MatchAll, CancellationToken.None);
        var result = SuccessionKernels.BuildCompGapAlerts(data.Roles, data.Bands, data.Comps);

        Assert.Equal(2, result.Alerts.Count);
        var alpha = result.Alerts.Single(a => a.RoleTitle == "Alpha");
        Assert.Equal(SuccessionReadFixture.M1Id.ToString(), alpha.UserId);
        Assert.Equal(87500, alpha.CurrentSalary);
        Assert.Equal(13, alpha.GapPercent);
        var gamma = result.Alerts.Single(a => a.RoleTitle == "Gamma");
        Assert.Equal(SuccessionReadFixture.M4Id.ToString(), gamma.UserId);
        Assert.Equal(20, gamma.GapPercent);
        Assert.Equal(2, result.AuditedCompIds.Count);
    }

    [Fact]
    public async Task CompGap_narrowTeamCompScope_keepsUserA_dropsUserB()
    {
        // Codex hardening BITE: a TEAM compensation scope (userId in {TeamLead, M1, M2, M3}) applied as the
        // employee_compensations ROW filter loads ONLY M1's comp row — M4 (userB, out of every team) is
        // filtered out at the DB, so its Gamma comp-gap never surfaces. Only userA's alert survives.
        // Neutralize the row filter (drop the AND (translated) clause in LoadCompensationsAsync) → M4's row
        // loads too → 2 alerts → this test goes RED.
        var teamCompScope = new ScopePredicate.FieldIn("userId", SuccessionReadFixture.TeamMemberIds);
        var data = await NewRepo().GetCompGapDataAsync(
            SuccessionReadFixture.OrgA.ToString(), includeCurrentSalary: true, includeCurrency: true, teamCompScope, CancellationToken.None);
        var result = SuccessionKernels.BuildCompGapAlerts(data.Roles, data.Bands, data.Comps);

        var alert = Assert.Single(result.Alerts);
        Assert.Equal(SuccessionReadFixture.M1Id.ToString(), alert.UserId);
        Assert.Equal("Alpha", alert.RoleTitle);
        // The out-of-scope comp row was never even loaded (row filter, not post-hoc null-ing).
        Assert.DoesNotContain(data.Comps, c => c.UserId == SuccessionReadFixture.M4Id.ToString());
    }

    [Fact]
    public async Task CompGap_unentitled_omitsSalaryColumn_soNoAlert()
    {
        // §21: not entitled → current_salary/currency are NOT selected → CompGapCompInput fields null → the
        // kernel skips the successor → zero alerts, nothing to audit (never a null-ed sensitive field).
        var data = await NewRepo().GetCompGapDataAsync(
            SuccessionReadFixture.OrgA.ToString(), includeCurrentSalary: false, includeCurrency: false, ScopePredicate.MatchAll, CancellationToken.None);
        var result = SuccessionKernels.BuildCompGapAlerts(data.Roles, data.Bands, data.Comps);

        Assert.Empty(result.Alerts);
        Assert.Empty(result.AuditedCompIds);
        Assert.All(data.Comps, c => Assert.Null(c.CurrentSalary));
    }

    [Fact]
    public async Task SuggestedData_orgScope_excludesExistingSuccessors_keepsStar()
    {
        // CR1's existing successors are M1/M2/OrgReader; M3 is a star NOT already a successor → the candidate.
        var data = await NewRepo().GetSuggestedDataAsync(
            SuccessionReadFixture.OrgA.ToString(), SuccessionReadFixture.CriticalRole1, ScopePredicate.MatchAll, CancellationToken.None);
        var suggestions = SuccessionKernels.BuildSuggestedSuccessors(data.Evaluations, data.ExistingUserIds);

        var one = Assert.Single(suggestions);
        Assert.Equal(SuccessionReadFixture.M3Id.ToString(), one.UserId);
        Assert.Equal("ready_now", one.SuggestedReadiness); // star → ready_now
        // Finding 3 tiebreak: three M3 rows (see fixture) make BOTH ordering clauses bite. The winner R1
        // (95/92) has the latest evaluatedAt AND the latest createdAt within that group. Removing/reversing
        // the PRIMARY evaluatedAt-desc → R3 (60/60) wins on createdAt → RED; reversing the SECONDARY
        // createdAt-desc → R2 (88/80) wins the same-evaluatedAt group → RED.
        Assert.Equal(95, one.PotentialScore);
        Assert.Equal(92, one.PerformanceScore);
    }

    [Fact]
    public async Task SimulateExit_orgScope_lowRisk_readyNowFirst()
    {
        var data = await NewRepo().GetSimulateExitDataAsync(
            SuccessionReadFixture.OrgA.ToString(), SuccessionReadFixture.CriticalRole1, ScopePredicate.MatchAll, CancellationToken.None);

        Assert.NotNull(data);
        var simulation = SuccessionKernels.BuildExitSimulation(
            data!.Successors.Select(s => new ExitSuccessorInput(s.Readiness, new ExitSuccessorUser(s.User.FirstName, s.User.LastName))).ToList());
        Assert.Equal("low", simulation.RiskLevel);       // S1 is ready_now
        Assert.Equal(3, simulation.PipelineCount);
        Assert.Equal(1, simulation.ReadyNowCount);
    }
}
