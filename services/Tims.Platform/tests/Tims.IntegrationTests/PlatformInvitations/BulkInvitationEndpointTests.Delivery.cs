using System.Net;
using System.Text.Json;
using Npgsql;
using Tims.IntegrationTests.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class BulkInvitationEndpointTests
{
    [Fact]
    public async Task Mixed_case_duplicates_send_once_with_ordered_results_and_safe_batch_audit()
    {
        var email = Email(); var other = Email(); var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        var response = await Post(client, Input(email, email.ToUpperInvariant(), other)); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()); var rows = json.RootElement.GetProperty("results");
        Assert.Equal(3, rows.GetArrayLength()); Assert.Equal("duplicate_row", rows[1].GetProperty("reason").GetString());
        Assert.Equal("sent", rows[0].GetProperty("status").GetString()); Assert.Equal(2, sender.Calls);
        Assert.Equal(2, json.RootElement.GetProperty("summary").GetProperty("sent").GetInt32());
        Assert.Equal(1, await Count(email)); Assert.Equal("sent", await Status(email));
        await using var db = new NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT metadata::text FROM audit_logs WHERE action='bulk_invitation_delivery' AND organization_id=@org ORDER BY created_at DESC LIMIT 1", db);
        cmd.Parameters.AddWithValue("org", PlatformOrganizationsCreateFixture.OtherOrg); var metadata = (string)(await cmd.ExecuteScalarAsync())!;
        Assert.Contains("\"total\": 3", metadata); Assert.DoesNotContain(email, metadata); Assert.DoesNotContain("token", metadata);
    }
    [Fact]
    public async Task Concurrent_batches_share_the_database_lock_and_only_send_once()
    {
        var email = Email(); var sender = new FakeSender(); await using var factory = Factory(sender); using var client = factory.CreateClient();
        var responses = await Task.WhenAll(Post(client, Input(email)), Post(client, Input(email.ToUpperInvariant())));
        var statuses = new List<string>();
        foreach (var response in responses)
        { Assert.Equal(HttpStatusCode.OK, response.StatusCode); using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()); statuses.Add(json.RootElement.GetProperty("results")[0].GetProperty("status").GetString()!); }
        Assert.Single(statuses, s => s == "sent"); Assert.Single(statuses, s => s == "duplicate"); Assert.Equal(1, sender.Calls); Assert.Equal(1, await Count(email));
    }
    [Theory]
    [InlineData("pending", true)]
    [InlineData("sent", true)]
    [InlineData("accepted", true)]
    [InlineData("expired", false)]
    [InlineData("revoked", false)]
    public async Task Existing_status_matches_bulk_duplicate_policy(string status, bool duplicate)
    {
        var email = Email(); await Seed(email, status); var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient(); var response = await Post(client, Input(email));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(duplicate ? "duplicate" : "sent", json.RootElement.GetProperty("results")[0].GetProperty("status").GetString());
        Assert.Equal(duplicate ? 0 : 1, sender.Calls); Assert.Equal(duplicate ? 1 : 2, await Count(email));
    }
    [Fact]
    public async Task Unconfirmed_delivery_is_pending_and_retrying_batch_does_not_resend()
    {
        var email = Email(); long? observed = null;
        var sender = new FakeSender { Handler = async () => { observed = await Count(email); return false; } };
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        var response = await Post(client, Input(email)); Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal(1, observed);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()); Assert.Equal("delivery_unconfirmed", json.RootElement.GetProperty("results")[0].GetProperty("reason").GetString());
        Assert.Equal("pending", await Status(email)); await Post(client, Input(email)); Assert.Equal(1, sender.Calls);
    }
    [Fact]
    public async Task Duplicate_check_is_tenant_scoped_and_uses_literal_email_equality()
    {
        var email = Email(); await Seed(email, "pending", PlatformOrganizationsCreateFixture.HomeOrg);
        var wildcard = "a_b" + Email(); await Seed(wildcard.Replace("_", "x"), "pending");
        var sender = new FakeSender(); await using var factory = Factory(sender); using var client = factory.CreateClient();
        var response = await Post(client, Input(email, wildcard)); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()); Assert.Equal(2, json.RootElement.GetProperty("summary").GetProperty("sent").GetInt32());
    }
    private async Task Seed(string email, string status, Guid? org = null)
    {
        await using var db = new NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO platform_invitations(id,email,type,organization_id,organization_name,token,status,invited_by_id,expires_at,updated_at)
            VALUES (@id,@email,'user',@org,'Target',@token,@status::"InvitationStatus",@actor,now()+INTERVAL '7 days',now())
            """, db);
        cmd.Parameters.AddWithValue("id", Guid.NewGuid()); cmd.Parameters.AddWithValue("email", email); cmd.Parameters.AddWithValue("org", org ?? PlatformOrganizationsCreateFixture.OtherOrg);
        cmd.Parameters.AddWithValue("token", Guid.NewGuid().ToString()); cmd.Parameters.AddWithValue("status", status); cmd.Parameters.AddWithValue("actor", PlatformOrganizationsCreateFixture.Actor); await cmd.ExecuteNonQueryAsync();
    }
    private async Task<long> Count(string email, string? connection = null)
    {
        await using var db = new NpgsqlConnection(connection ?? fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(*) FROM platform_invitations WHERE organization_id=@org AND lower(email)=lower(@email)", db);
        cmd.Parameters.AddWithValue("org", PlatformOrganizationsCreateFixture.OtherOrg); cmd.Parameters.AddWithValue("email", email); return (long)(await cmd.ExecuteScalarAsync())!;
    }
    private async Task<string> Status(string email)
    {
        await using var db = new NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT status::text FROM platform_invitations WHERE organization_id=@org AND email=@email ORDER BY created_at DESC LIMIT 1", db);
        cmd.Parameters.AddWithValue("org", PlatformOrganizationsCreateFixture.OtherOrg); cmd.Parameters.AddWithValue("email", email); return (string)(await cmd.ExecuteScalarAsync())!;
    }
}
