using Tims.Infrastructure.Access;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.5b Part A: proves <see cref="EfAnchorLoader"/> returns the exact anchor sets + floors over a
/// real tenant-RLS schema. Every method runs under <c>TenantScope</c> (app_tenant + org GUC), so
/// org B's parallel rows are invisible.
/// </summary>
[Collection("AnchorProbe")]
public sealed class EfAnchorLoaderTests(AnchorProbeFixture fixture)
{
    private EfAnchorLoader Loader(Guid org, Guid user) =>
        new(new AnchorDbContext(AnchorProbeFixture.BuildOptions(fixture.ConnectionString)), org, user);

    private static HashSet<string> Set(params Guid[] ids) => ids.Select(id => id.ToString()).ToHashSet();

    [Fact]
    public async Task LedTeamIds_returns_only_active_led_teams()
    {
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
        var led = await loader.LedTeamIdsAsync();
        Assert.Equal(Set(AnchorProbeFixture.T1), led.ToHashSet()); // TInactive excluded
    }

    [Fact]
    public async Task TeamMemberIds_returns_self_plus_members_of_led_teams()
    {
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
        var members = await loader.TeamMemberIdsAsync();
        Assert.Equal(
            Set(AnchorProbeFixture.U1, AnchorProbeFixture.U2, AnchorProbeFixture.U3),
            members.ToHashSet());
        Assert.Equal(AnchorProbeFixture.U1.ToString(), members[0]); // self first (order preserved)
    }

    [Fact]
    public async Task TeamMemberIds_floors_to_self_when_no_led_teams()
    {
        // U2 leads no team → floor is [self], NOT [] (keeps team ⊇ own).
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U2);
        var members = await loader.TeamMemberIdsAsync();
        Assert.Equal(new[] { AnchorProbeFixture.U2.ToString() }, members);
    }

    [Fact]
    public async Task UnitIds_returns_only_active_assigned_units()
    {
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
        var units = await loader.UnitIdsAsync();
        Assert.Equal(Set(AnchorProbeFixture.Bu1), units.ToHashSet()); // BuInactive excluded
    }

    [Fact]
    public async Task UnitIds_floors_to_empty_when_no_units()
    {
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U2);
        Assert.Empty(await loader.UnitIdsAsync());
    }

    [Fact]
    public async Task UnitMemberIds_unions_direct_and_team_members()
    {
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
        var members = await loader.UnitMemberIdsAsync();
        Assert.Equal(
            Set(AnchorProbeFixture.U2, AnchorProbeFixture.U3, AnchorProbeFixture.U4, AnchorProbeFixture.U5),
            members.ToHashSet());
    }

    [Fact]
    public async Task UnitMemberIds_floors_to_empty_when_no_units()
    {
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U2);
        Assert.Empty(await loader.UnitMemberIdsAsync());
    }

    [Fact]
    public async Task PanelInterviewIds_returns_interviews_where_evaluator()
    {
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U1);
        var panels = await loader.PanelInterviewIdsAsync();
        Assert.Equal(Set(AnchorProbeFixture.I1, AnchorProbeFixture.I4), panels.ToHashSet());
    }

    [Fact]
    public async Task PanelInterviewIds_floors_to_empty_when_not_an_evaluator()
    {
        await using var loader = Loader(AnchorProbeFixture.OrgA, AnchorProbeFixture.U2);
        Assert.Empty(await loader.PanelInterviewIdsAsync());
    }

    [Fact]
    public async Task Anchors_are_org_isolated_by_rls()
    {
        // Same user U1, but a DIFFERENT org context (Org B) — RLS + explicit org filter hide Org A's
        // led team T1, so the anchor is empty. Proves org B cannot inherit U1's Org A leadership.
        await using var loader = Loader(AnchorProbeFixture.OrgB, AnchorProbeFixture.U1);
        Assert.Empty(await loader.LedTeamIdsAsync());
    }
}
