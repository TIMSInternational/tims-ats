using System.Net;
using System.Text.Json;
using Npgsql;
using Tims.IntegrationTests.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class UserInvitationEndpointTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task User_invitation_is_tenant_scoped_audited_and_only_marked_sent_after_acceptance(bool withRole)
    {
        var role = withRole ? await SeedRole(PlatformOrganizationsCreateFixture.OtherOrg) : null;
        var before = await fixture.Organizations.CountAllRowsAsync();
        var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        var response = await Post(client, Input(role: role));
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(body); var result = json.RootElement;
        Assert.Equal(3, result.EnumerateObject().Count());
        Assert.Equal("accepted", result.GetProperty("delivery").GetString());
        var id = result.GetProperty("id").GetGuid(); var row = await Read(id);
        Assert.Equal(PlatformOrganizationsCreateFixture.OtherOrg, row.Org); Assert.Equal(role, row.Role);
        Assert.Equal("sent", row.Status); Assert.Equal("user", row.Type); Assert.NotNull(row.SentAt);
        Assert.InRange((row.ExpiresAt - row.SentAt!.Value).TotalDays, 6.99, 7.01);
        Assert.Equal(before, await fixture.Organizations.CountAllRowsAsync());
        Assert.Contains(row.Token, sender.Html); Assert.DoesNotContain(row.Token, body); Assert.DoesNotContain("invitee@", body);
        var audit = await fixture.Organizations.ReadAuditRowsAsync(row.Org);
        Assert.Contains(audit, a => a.Action == "user_invitation_created" && a.EntityId == id.ToString() && a.ActorId == PlatformOrganizationsCreateFixture.Actor);
        Assert.Contains(audit, a => a.Action == "user_invitation_delivery" && a.EntityId == id.ToString());
        Assert.Equal(1, sender.Calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Foreign_or_inactive_role_is_rejected_before_insert_or_email(bool inactive)
    {
        var role = await SeedRole(inactive ? PlatformOrganizationsCreateFixture.OtherOrg : PlatformOrganizationsCreateFixture.HomeOrg, active: !inactive);
        var before = await CountInvitations(); var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, Input(role: role))).StatusCode);
        Assert.Equal(before, await CountInvitations()); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Missing_organization_or_role_never_creates_or_sends()
    {
        var before = await CountInvitations(); var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await Post(client, Input(Guid.NewGuid()))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, Input(role: "missing-role"))).StatusCode);
        Assert.Equal(before, await CountInvitations()); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Creation_is_committed_pending_before_failed_delivery()
    {
        long? observedCount = null;
        var before = await CountInvitations();
        var sender = new FakeSender { Handler = async () => { observedCount = await CountInvitations(); return false; } };
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        var response = await Post(client, Input());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(before + 1, observedCount); // Outside the application's sender exception catch.
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("unconfirmed", json.RootElement.GetProperty("delivery").GetString());
        var row = await Read(json.RootElement.GetProperty("id").GetGuid()); Assert.Equal("pending", row.Status); Assert.Null(row.SentAt);
        Assert.Equal(1, sender.Calls);
    }

    [Fact]
    public async Task Missing_audit_rolls_back_invitation_without_sending()
    {
        var connection = fixture.Organizations.MissingAuditTableConnectionString;
        var before = await CountInvitations(connection); var sender = new FakeSender();
        await using var factory = Factory(sender, connection: connection); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.InternalServerError, (await Post(client, Input())).StatusCode);
        Assert.Equal(before, await CountInvitations(connection)); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Real_disabled_sender_preserves_pending_invitation()
    {
        await using var factory = Factory(new FakeSender(), replaceSender: false); using var client = factory.CreateClient();
        var response = await Post(client, Input()); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("unconfirmed", json.RootElement.GetProperty("delivery").GetString());
        Assert.Equal("pending", (await Read(json.RootElement.GetProperty("id").GetGuid())).Status);
    }

    private async Task<string> SeedRole(Guid org, bool active = true)
    {
        var role = "role_" + Guid.NewGuid().ToString("N");
        await using var db = new NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("INSERT INTO roles(id,organization_id,name,slug,is_active,updated_at) VALUES (@id,@org,'Fixture Role',@role,@active,now())", db);
        cmd.Parameters.AddWithValue("id", Guid.NewGuid()); cmd.Parameters.AddWithValue("org", org); cmd.Parameters.AddWithValue("role", role); cmd.Parameters.AddWithValue("active", active);
        await cmd.ExecuteNonQueryAsync(); return role;
    }
    private async Task<long> CountInvitations(string? connection = null)
    {
        await using var db = new NpgsqlConnection(connection ?? fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(*) FROM platform_invitations", db); return (long)(await cmd.ExecuteScalarAsync())!;
    }
    private sealed record Row(Guid Org, string? Role, string Status, DateTime? SentAt, DateTime ExpiresAt, string Token, string Type);
    private async Task<Row> Read(Guid id)
    {
        await using var db = new NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT organization_id,role_slug,status::text,sent_at,expires_at,token,type::text FROM platform_invitations WHERE id=@id", db);
        cmd.Parameters.AddWithValue("id", id); await using var r = await cmd.ExecuteReaderAsync(); Assert.True(await r.ReadAsync());
        return new(r.GetGuid(0), r.IsDBNull(1) ? null : r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetDateTime(3), r.GetDateTime(4), r.GetString(5), r.GetString(6));
    }
}
