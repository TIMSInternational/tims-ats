using Tims.Domain.Access;
using Tims.Domain.TeamIntel;
using Tims.Infrastructure.TeamIntel;

namespace Tims.IntegrationTests.TeamIntel;

/// <summary>
/// Phase-5 Slice 6 direct-repository tests (real Postgres + real RLS): each call runs UNDER TenantScope
/// (SET LOCAL ROLE app_tenant + org GUC), so these prove the EF queries fetch the right rows AND that RLS +
/// the explicit org filter isolate the tenant — a cross-org bleed would change OrgA's counts (OrgB seeds a
/// DISTINCT single team). The pure kernels are exhaustively golden-tested in the unit suite; here we verify
/// the DB wiring, the raw shapes, joinedAt ordering, and the scopeWhereFor drop end-to-end.
/// </summary>
[Collection("TeamIntelRead")]
public sealed class TeamIntelReadTests(TeamIntelReadFixture fixture)
{
    // A fixed injected `now` for the balance kernel — the deterministic fields asserted here do not depend on it.
    private static readonly long NowMs = new DateTimeOffset(2026, 7, 1, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();

    private readonly TeamIntelReadFixture _fixture = fixture;

    private TeamIntelReadRepository NewRepo() => new(_fixture.NewReadContext());

    [Fact]
    public async Task Profile_OrgA_Team1_rawShapeWithLeaderUnitMembersAndCounts()
    {
        var profile = await NewRepo().GetTeamProfileAsync(TeamIntelReadFixture.OrgA.ToString(), TeamIntelReadFixture.Team1, CancellationToken.None);

        Assert.NotNull(profile);
        Assert.Equal("Alpha", profile!.Name);
        Assert.Equal(TeamIntelReadFixture.OrgA.ToString(), profile.OrganizationId);
        Assert.NotNull(profile.Leader);
        Assert.Equal("lead@tims.test", profile.Leader!.Email); // leader select INCLUDES email
        Assert.Equal("Unit One", profile.BusinessUnit!.Name);
        Assert.Equal(TeamIntelReadFixture.Team1MemberCount, profile.Members.Count);
        Assert.Equal(TeamIntelReadFixture.Team1Vacancies, profile.Count.Vacancies);
        Assert.Equal(TeamIntelReadFixture.Team1Okrs, profile.Count.Okrs);
        Assert.Equal("blue", profile.Settings!["color"]!.GetValue<string>()); // jsonb settings passed through
    }

    [Fact]
    public async Task Profile_crossOrgTeam_isNull_underRls()
    {
        // OrgA caller asking for an OrgB team → RLS hides it → null (→ NOT_FOUND at the endpoint).
        var profile = await NewRepo().GetTeamProfileAsync(TeamIntelReadFixture.OrgA.ToString(), TeamIntelReadFixture.Team3OrgB, CancellationToken.None);
        Assert.Null(profile);
    }

    [Fact]
    public async Task Members_Team1_orderedByJoinedAtAsc_withEmailAndCreatedAt()
    {
        var members = await NewRepo().GetMembersAsync(TeamIntelReadFixture.OrgA.ToString(), TeamIntelReadFixture.Team1, CancellationToken.None);

        Assert.Equal(3, members.Count);
        // joinedAt: M1 06-01, M3 06-02, M2 06-03 → asc order M1, M3, M2.
        Assert.Equal("m1@tims.test", members[0].User.Email);
        Assert.Equal("m3@tims.test", members[1].User.Email);
        Assert.Equal("m2@tims.test", members[2].User.Email);
        Assert.NotEqual(default, members[0].User.CreatedAt); // getMembers user select INCLUDES createdAt
    }

    [Fact]
    public async Task BalanceMembers_Team1_feedKernel_deterministicFields()
    {
        var members = await NewRepo().GetBalanceMembersAsync(TeamIntelReadFixture.OrgA.ToString(), TeamIntelReadFixture.Team1, CancellationToken.None);
        var view = BalanceScoreBuilder.Build(members, NowMs);

        Assert.Equal(TeamIntelReadFixture.Team1MemberCount, view.MemberCount);
        Assert.Equal(TeamIntelReadFixture.Team1UniqueRoles, view.UniqueRoles);   // Eng, PM (M3 null dropped)
        Assert.Equal(TeamIntelReadFixture.Team1RoleDiversity, view.RoleDiversity); // 67
        Assert.Equal(TeamIntelReadFixture.Team1SizeScore, view.SizeScore);        // 100
        Assert.Equal(TeamIntelReadFixture.Team1BalanceScore, view.BalanceScore);  // 84
    }

    [Fact]
    public async Task Comparison_teamScope_dropsOutOfScopeTeamId()
    {
        // Team scope resolves to id IN [T1] (the team the lead leads). Comparing [T1, T2] → only T1 survives.
        var teamScope = new ScopePredicate.FieldIn("id", new[] { TeamIntelReadFixture.Team1.ToString() });
        var scoped = await NewRepo().GetComparisonTeamsAsync(
            TeamIntelReadFixture.OrgA.ToString(), teamScope, new[] { TeamIntelReadFixture.Team1, TeamIntelReadFixture.Team2 }, CancellationToken.None);

        Assert.Single(scoped);
        Assert.Equal(TeamIntelReadFixture.Team1.ToString(), scoped[0].Id);
        Assert.Equal(TeamIntelReadFixture.Team1MemberCount, scoped[0].Members.Count);
        Assert.Equal(TeamIntelReadFixture.Team1Vacancies, scoped[0].OpenVacancies);
    }

    [Fact]
    public async Task Comparison_orgScope_matchAll_returnsBothTeams()
    {
        var scoped = await NewRepo().GetComparisonTeamsAsync(
            TeamIntelReadFixture.OrgA.ToString(), ScopePredicate.MatchAll, new[] { TeamIntelReadFixture.Team1, TeamIntelReadFixture.Team2 }, CancellationToken.None);

        Assert.Equal(2, scoped.Count);
    }

    [Fact]
    public async Task DashboardKpiData_OrgA_countsUnderRls()
    {
        var data = await NewRepo().GetDashboardKpiDataAsync(TeamIntelReadFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Equal(TeamIntelReadFixture.OrgATotalTeams, data.TotalTeams);        // 2 (T1, T2)
        Assert.Equal(TeamIntelReadFixture.OrgATotalMembers, data.TotalMembers);    // 4 (3 on T1 + 1 on T2)
        Assert.Equal(TeamIntelReadFixture.OrgATeamsWithLeader, data.TeamsWithLeader); // 2
    }

    [Fact]
    public async Task DashboardKpiData_OrgB_isIsolated_fromOrgA()
    {
        // OrgB's own rollup — proves RLS scopes to the caller's org (OrgB seeds a single team with one member).
        var data = await NewRepo().GetDashboardKpiDataAsync(TeamIntelReadFixture.OrgB.ToString(), CancellationToken.None);

        Assert.Equal(1, data.TotalTeams);
        Assert.Equal(1, data.TotalMembers);
        Assert.Equal(0, data.TeamsWithLeader); // OrgB team has no leader
    }
}
