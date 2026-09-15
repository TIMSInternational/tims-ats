using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Tims.Domain.Identity;
using Tims.IntegrationTests.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class UserInvitationEndpointTests
{
    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(PlatformOrganizationsCreateFixture.OrgUserSub, HttpStatusCode.Forbidden)]
    public async Task Authorization_precedes_body_and_role_lookup_validation(string? sub, HttpStatusCode status)
    {
        var sender = new FakeSender(); await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(status, (await Post(client, "invalid-json", sub)).StatusCode);
        Assert.Equal(status, (await Post(client, Input(), sub)).StatusCode);
        Assert.Equal(status, (await GetRoles(client, "bad-id", sub)).StatusCode); Assert.Equal(0, sender.Calls);
    }
    [Theory]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"email\":null,\"organizationId\":\"22222222-2222-2222-2222-222222222222\"}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationId\":\"bad\"}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationId\":\"00000000-0000-0000-0000-000000000000\"}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationId\":\"22222222-2222-2222-2222-222222222222\",\"roleSlug\":null}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationId\":\"22222222-2222-2222-2222-222222222222\",\"roleSlug\":\"\"}")]
    [InlineData("{\"email\":\"a@b.com\",\"email\":\"c@d.com\"}")]
    public async Task Invalid_body_never_inserts_or_sends(string body)
    {
        var sender = new FakeSender(); var before = await CountInvitations();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, body)).StatusCode);
        Assert.Equal(before, await CountInvitations()); Assert.Equal(0, sender.Calls);
    }
    [Fact]
    public async Task Role_lookup_only_returns_active_roles_in_the_selected_tenant()
    {
        var own = await SeedRole(PlatformOrganizationsCreateFixture.OtherOrg);
        var foreign = await SeedRole(PlatformOrganizationsCreateFixture.HomeOrg);
        var inactive = await SeedRole(PlatformOrganizationsCreateFixture.OtherOrg, false);
        await using var factory = Factory(new FakeSender()); using var client = factory.CreateClient();
        var response = await GetRoles(client, PlatformOrganizationsCreateFixture.OtherOrg.ToString());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(own, body); Assert.DoesNotContain(foreign, body); Assert.DoesNotContain(inactive, body);
        using var json = JsonDocument.Parse(body);
        Assert.All(json.RootElement.GetProperty("roles").EnumerateArray(), r => Assert.Equal(2, r.EnumerateObject().Count()));
        Assert.Equal(HttpStatusCode.NotFound, (await GetRoles(client, Guid.NewGuid().ToString())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await GetRoles(client, "bad-id")).StatusCode);
    }
    [Fact]
    public async Task Disabled_flag_hides_both_routes()
    {
        await using var factory = Factory(new FakeSender(), enabled: false); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await Post(client, Input())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await GetRoles(client, PlatformOrganizationsCreateFixture.OtherOrg.ToString())).StatusCode);
    }
    [Fact]
    public async Task Mfa_and_signed_impersonation_deny_mutation()
    {
        var sender = new FakeSender();
        await using (var factory = Factory(sender).WithWebHostBuilder(b => b.UseSetting("Platform:MfaEnforced", "true")))
        { using var client = factory.CreateClient(); Assert.Equal(HttpStatusCode.Forbidden, (await Post(client, Input())).StatusCode); }
        var secret = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        await using var impersonated = Factory(sender).WithWebHostBuilder(b => b.UseSetting("Platform:ImpersonationSecret", secret));
        using var other = impersonated.CreateClient();
        var cookie = ImpersonationCookie.SignImpersonationToken(secret, PlatformOrganizationsCreateFixture.Actor.ToString(), PlatformOrganizationsCreateFixture.NonOwner.ToString(), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        other.DefaultRequestHeaders.Add("Cookie", $"{ImpersonationCookie.CookieName}={cookie}");
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(other, Input())).StatusCode); Assert.Equal(0, sender.Calls);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Inactive_or_deleted_organization_denies_both_routes(bool deleted)
    {
        await using var db = new Npgsql.NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new Npgsql.NpgsqlCommand(deleted
            ? "UPDATE organizations SET deleted_at=now() WHERE id=@id"
            : "UPDATE organizations SET is_active=false WHERE id=@id", db);
        cmd.Parameters.AddWithValue("id", PlatformOrganizationsCreateFixture.OtherOrg);
        await cmd.ExecuteNonQueryAsync();
        var sender = new FakeSender(); var before = await CountInvitations();
        try
        {
            await using var factory = Factory(sender); using var client = factory.CreateClient();
            Assert.Equal(HttpStatusCode.NotFound, (await Post(client, Input())).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await GetRoles(client, PlatformOrganizationsCreateFixture.OtherOrg.ToString())).StatusCode);
            Assert.Equal(before, await CountInvitations()); Assert.Equal(0, sender.Calls);
        }
        finally { cmd.CommandText = "UPDATE organizations SET deleted_at=null,is_active=true WHERE id=@id"; await cmd.ExecuteNonQueryAsync(); }
    }

    [Fact]
    public async Task Role_lookup_is_ordered_and_capped_at_100()
    {
        var org = Guid.NewGuid();
        await using var db = new Npgsql.NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new Npgsql.NpgsqlCommand("""
            INSERT INTO organizations(id,name,slug,updated_at) VALUES (@org,'Role cap',@slug,now());
            INSERT INTO roles(id,organization_id,name,slug,updated_at)
              SELECT gen_random_uuid(),@org,'Role ' || lpad(i::text,3,'0'),'role_' || lpad(i::text,3,'0'),now()
              FROM generate_series(105,1,-1) i;
            """, db);
        cmd.Parameters.AddWithValue("org", org); cmd.Parameters.AddWithValue("slug", org.ToString()); await cmd.ExecuteNonQueryAsync();
        await using var factory = Factory(new FakeSender()); using var client = factory.CreateClient();
        var response = await GetRoles(client, org.ToString()); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()); var roles = json.RootElement.GetProperty("roles");
        Assert.Equal(100, roles.GetArrayLength()); Assert.Equal("role_001", roles[0].GetProperty("slug").GetString());
        Assert.Equal("role_100", roles[99].GetProperty("slug").GetString());
    }

    private static Task<HttpResponseMessage> GetRoles(HttpClient client, string id, string? sub = PlatformOrganizationsCreateFixture.PlatformOwnerSub)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"/platform/invitations/organizations/{id}/roles");
        if (sub is not null) request.Headers.Add("Authorization", "Bearer " + Mint(sub)); return client.SendAsync(request);
    }
}
