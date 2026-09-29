using System.Net;
using System.Text.Json;
using F = Tims.IntegrationTests.OrgStructure.OrgStructureFixture;

namespace Tims.IntegrationTests.OrgStructure;

[Collection("OrgStructure")]
public sealed class OrgStructureEndpointTests(F fixture)
{
    private const string Base = "/tenant/org-structure";

    private Task<HttpResponseMessage> Send(HttpMethod method, string path, Guid? user, string? json = null, bool enabled = true) =>
        OrgStructureTestClient.SendAsync(fixture.ConnectionString, method, path, user, json, enabled);

    private static async Task<string> Code(HttpResponseMessage response) =>
        (await OrgStructureTestClient.JsonAsync(response)).GetProperty("code").GetString()!;

    [Fact]
    public async Task FlagOff_RoutesAreNotMapped()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Get, Base, F.Hr, enabled: false)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Post, Base + "/business-units", F.Hr, """{"name":"X"}""", enabled: false)).StatusCode);
    }

    [Fact]
    public async Task Read_ShowsOnlyTheCallersTenantWithLeadersAndAssignees()
    {
        var response = await Send(HttpMethod.Get, Base, F.Hr);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await OrgStructureTestClient.JsonAsync(response);
        var units = json.GetProperty("businessUnits").EnumerateArray().ToList();
        Assert.DoesNotContain(units, unit => unit.GetProperty("id").GetGuid() == F.ForeignUnit);
        var unit1 = units.Single(unit => unit.GetProperty("id").GetGuid() == F.Unit1);
        Assert.Equal(F.Hrbp, unit1.GetProperty("unitAssignees")[0].GetProperty("userId").GetGuid());
        var team1 = unit1.GetProperty("teams").EnumerateArray().Single(team => team.GetProperty("id").GetGuid() == F.Team1);
        Assert.Equal(F.LeaderA, team1.GetProperty("leader").GetProperty("userId").GetGuid());
        Assert.Equal("Lia LeaderA", team1.GetProperty("leader").GetProperty("fullName").GetString());
        Assert.Equal([F.CompanyA], json.GetProperty("companies").EnumerateArray().Select(c => c.GetProperty("id").GetGuid()));
    }

    [Fact]
    public async Task RoleWithoutOrganizationGrant_Is403_ButOptionsFollowVacancyCreate()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, Base, F.Recruiter)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Send(HttpMethod.Post, Base + "/business-units", F.Recruiter, """{"name":"Nope"}""")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Send(HttpMethod.Patch, $"{Base}/teams/{F.Team1}", F.LeaderA, """{"name":"Hijack"}""")).StatusCode);
        Assert.Equal(0, await fixture.CountAsync("SELECT count(*) FROM business_units WHERE name IN ('Nope')"));
        Assert.Equal(0, await fixture.CountAsync("SELECT count(*) FROM teams WHERE name = 'Hijack'"));

        var options = await Send(HttpMethod.Get, Base + "/options", F.Recruiter);
        Assert.Equal(HttpStatusCode.OK, options.StatusCode);
        var body = await options.Content.ReadAsStringAsync();
        Assert.DoesNotContain("@acme.test", body, StringComparison.Ordinal);
        Assert.Contains("\"hasLeader\":true", body, StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, Base + "/options", F.Employee)).StatusCode);
    }

    [Fact]
    public async Task CreateBusinessUnit_ResolvesTheOnlyCompany_TrimsAndAudits()
    {
        var response = await Send(HttpMethod.Post, Base + "/business-units", F.Hr, """{"name":"  Finanzas  ","code":"FIN"}""");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var row = await OrgStructureTestClient.JsonAsync(response);
        Assert.Equal("Finanzas", row.GetProperty("name").GetString());
        Assert.Equal(F.CompanyA, row.GetProperty("companyId").GetGuid());
        var id = row.GetProperty("id").GetGuid();
        Assert.Equal(1, await fixture.CountAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'business_unit_created' AND entity_id = '{id}' AND actor_id = '{F.Hr}' AND organization_id = '{F.OrgA}'"));
    }

    [Theory]
    [InlineData("""{"name":""}""")]
    [InlineData("""{"name":"   "}""")]
    [InlineData("""{"name":"x","code":"12345678901234567890123456789012345678901"}""")]
    [InlineData("""{"name":"x","companyId":"not-a-uuid"}""")]
    [InlineData("""{"name":"x","unknown":1}""")]
    [InlineData("""{"code":"only"}""")]
    [InlineData("""[1]""")]
    public async Task CreateBusinessUnit_RejectsOutOfBoundsInput(string json)
    {
        var response = await Send(HttpMethod.Post, Base + "/business-units", F.Hr, json);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_input", await Code(response));
    }

    [Fact]
    public async Task CreateBusinessUnit_ForeignCompany_Is404()
    {
        var response = await Send(HttpMethod.Post, Base + "/business-units", F.Hr,
            """{"name":"Cross","companyId":"d2000000-0000-0000-0000-000000000001"}""");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(0, await fixture.CountAsync("SELECT count(*) FROM business_units WHERE name = 'Cross'"));
    }

    [Fact]
    public async Task DeactivatingUnitWithActiveTeams_Is409_AndEmptyUnitDeactivates()
    {
        var conflict = await Send(HttpMethod.Patch, $"{Base}/business-units/{F.Unit2}", F.Hr, """{"isActive":false}""");
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal("business_unit_has_active_teams", await Code(conflict));
        Assert.Equal(true, await fixture.ScalarAsync($"SELECT is_active FROM business_units WHERE id = '{F.Unit2}'"));

        var created = await OrgStructureTestClient.JsonAsync(
            await Send(HttpMethod.Post, Base + "/business-units", F.Hr, """{"name":"Temporal"}"""));
        var id = created.GetProperty("id").GetGuid();
        var ok = await Send(HttpMethod.Patch, $"{Base}/business-units/{id}", F.Hr, """{"isActive":false,"code":null}""");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.False((await OrgStructureTestClient.JsonAsync(ok)).GetProperty("isActive").GetBoolean());
        var inactiveTeam = await Send(HttpMethod.Post, Base + "/teams", F.Hr, $$"""{"businessUnitId":"{{id}}","name":"Late"}""");
        Assert.Equal(HttpStatusCode.Conflict, inactiveTeam.StatusCode);
        Assert.Equal("business_unit_inactive", await Code(inactiveTeam));
    }

    [Fact]
    public async Task CrossTenantIds_Are404_AndWriteNothing()
    {
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Patch, $"{Base}/business-units/{F.ForeignUnit}", F.Hr, """{"name":"Pwned"}""")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Patch, $"{Base}/teams/{F.ForeignTeam}", F.Hr, """{"leaderUserId":null}""")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Put, $"{Base}/teams/{F.ForeignTeam}/members/{F.Employee}", F.Hr)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Put, $"{Base}/teams/{F.Team1}/members/{F.ForeignHr}", F.Hr)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Put, $"{Base}/business-units/{F.ForeignUnit}/assignees/{F.Employee}", F.Hr)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Put, $"{Base}/users/{F.ForeignHr}/business-unit", F.Hr, $$"""{"businessUnitId":"{{F.Unit1}}"}""")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Put, $"{Base}/users/{F.Employee}/business-unit", F.Hr, $$"""{"businessUnitId":"{{F.ForeignUnit}}"}""")).StatusCode);
        // The foreign tenant's admin cannot reach Acme's rows either.
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Patch, $"{Base}/teams/{F.Team1}", F.ForeignHr, """{"name":"Pwned"}""")).StatusCode);

        Assert.Equal("Foreign unit", await fixture.ScalarAsync($"SELECT name FROM business_units WHERE id = '{F.ForeignUnit}'"));
        Assert.Equal(F.ForeignHr, await fixture.ScalarAsync($"SELECT leader_id FROM teams WHERE id = '{F.ForeignTeam}'"));
        Assert.Equal("Ventas", await fixture.ScalarAsync($"SELECT name FROM teams WHERE id = '{F.Team1}'"));
        Assert.Equal(0, await fixture.CountAsync($"SELECT count(*) FROM user_teams WHERE user_id = '{F.ForeignHr}' OR team_id = '{F.ForeignTeam}'"));
        Assert.Equal(DBNull.Value, await fixture.ScalarAsync($"SELECT business_unit_id FROM users WHERE id = '{F.ForeignHr}'"));
        Assert.Equal(0, await fixture.CountAsync($"SELECT count(*) FROM audit_logs WHERE organization_id = '{F.OrgB}'"));
    }

    [Fact]
    public async Task TeamLeader_MustBeAnActiveUserOfTheSameOrganization()
    {
        var foreign = await Send(HttpMethod.Post, Base + "/teams", F.Hr,
            $$"""{"businessUnitId":"{{F.Unit1}}","name":"Foreign led","leaderUserId":"{{F.ForeignHr}}"}""");
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        var inactive = await Send(HttpMethod.Post, Base + "/teams", F.Hr,
            $$"""{"businessUnitId":"{{F.Unit1}}","name":"Dormant led","leaderUserId":"{{F.Inactive}}"}""");
        Assert.Equal(HttpStatusCode.BadRequest, inactive.StatusCode);
        Assert.Equal("user_inactive", await Code(inactive));
        Assert.Equal(0, await fixture.CountAsync("SELECT count(*) FROM teams WHERE name IN ('Foreign led','Dormant led')"));

        var created = await Send(HttpMethod.Post, Base + "/teams", F.Hr,
            $$"""{"businessUnitId":"{{F.Unit1}}","name":"Soporte","leaderUserId":"{{F.Employee}}"}""");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var teamId = (await OrgStructureTestClient.JsonAsync(created)).GetProperty("id").GetGuid();
        var cleared = await Send(HttpMethod.Patch, $"{Base}/teams/{teamId}", F.Hr, """{"leaderUserId":null}""");
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await OrgStructureTestClient.JsonAsync(cleared)).GetProperty("leaderUserId").ValueKind);
        Assert.Equal(1, await fixture.CountAsync($"SELECT count(*) FROM audit_logs WHERE action = 'team_updated' AND entity_id = '{teamId}'"));
    }

    [Fact]
    public async Task Membership_And_UnitAssignment_AreIdempotent_AndAudited()
    {
        var team = await OrgStructureTestClient.JsonAsync(await Send(HttpMethod.Post, Base + "/teams", F.Hr,
            $$"""{"businessUnitId":"{{F.Unit1}}","name":"Miembros"}"""));
        var teamId = team.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Put, $"{Base}/teams/{teamId}/members/{F.Employee}", F.Hr)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Put, $"{Base}/teams/{teamId}/members/{F.Employee}", F.Hr, """{"role":"member"}""")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Put, $"{Base}/teams/{teamId}/members/{F.Employee}", F.Hr, """{"role":"owner"}""")).StatusCode);
        Assert.Equal(1, await fixture.CountAsync($"SELECT count(*) FROM user_teams WHERE team_id = '{teamId}'"));
        Assert.Equal(1, await fixture.CountAsync($"SELECT count(*) FROM audit_logs WHERE action = 'team_member_added' AND entity_id = '{teamId}'"));
        Assert.Equal(HttpStatusCode.NoContent, (await Send(HttpMethod.Delete, $"{Base}/teams/{teamId}/members/{F.Employee}", F.Hr)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Delete, $"{Base}/teams/{teamId}/members/{F.Employee}", F.Hr)).StatusCode);

        var unit = await OrgStructureTestClient.JsonAsync(await Send(HttpMethod.Post, Base + "/business-units", F.Hr, """{"name":"Asignados"}"""));
        var unitId = unit.GetProperty("id").GetGuid();
        for (var i = 0; i < 2; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Put, $"{Base}/business-units/{unitId}/assignees/{F.Employee}", F.Hr)).StatusCode);
        }

        Assert.Equal(1, await fixture.CountAsync($"SELECT count(*) FROM user_business_units WHERE business_unit_id = '{unitId}'"));
        Assert.Equal(1, await fixture.CountAsync($"SELECT count(*) FROM audit_logs WHERE action = 'business_unit_assignee_added' AND entity_id = '{unitId}'"));
        Assert.Equal(HttpStatusCode.NoContent, (await Send(HttpMethod.Delete, $"{Base}/business-units/{unitId}/assignees/{F.Employee}", F.Hr)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Delete, $"{Base}/business-units/{unitId}/assignees/{F.Employee}", F.Hr)).StatusCode);

        var home = await Send(HttpMethod.Put, $"{Base}/users/{F.Assignee}/business-unit", F.Hr, $$"""{"businessUnitId":"{{unitId}}"}""");
        Assert.Equal(HttpStatusCode.OK, home.StatusCode);
        Assert.Equal(unitId, await fixture.ScalarAsync($"SELECT business_unit_id FROM users WHERE id = '{F.Assignee}'"));
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Put, $"{Base}/users/{F.Assignee}/business-unit", F.Hr, "{}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Put, $"{Base}/users/{F.Assignee}/business-unit", F.Hr, """{"businessUnitId":null}""")).StatusCode);
        Assert.Equal(DBNull.Value, await fixture.ScalarAsync($"SELECT business_unit_id FROM users WHERE id = '{F.Assignee}'"));
    }
}
