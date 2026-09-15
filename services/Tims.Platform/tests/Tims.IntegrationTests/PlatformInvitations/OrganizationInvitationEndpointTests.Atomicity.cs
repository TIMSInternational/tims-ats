using System.Net;
using System.Text.Json;
using Npgsql;
using Tims.Application.PlatformInvitations;
using Tims.Infrastructure.PlatformInvitations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class OrganizationInvitationEndpointTests
{
    [Fact]
    public async Task Invitation_insert_failure_rolls_back_all_provisioning()
    {
        var before = await fixture.Organizations.CountAllRowsAsync();
        await using var db = fixture.Organizations.NewContext(fixture.ConnectionString);
        var repository = new OrganizationInvitationCreateRepository(db);
        // Unknown inviter violates the real FK after all seven setup tables have been written.
        var failure = await Assert.ThrowsAsync<PostgresException>(() => repository.CreateAsync(
            new OrganizationInvitationInput("admin@example.test", "Example", "org-" + Guid.NewGuid().ToString("N")),
            Guid.NewGuid(), DateTime.UtcNow, CancellationToken.None));
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, failure.SqlState);
        Assert.Equal(before, await fixture.Organizations.CountAllRowsAsync());
    }

    [Fact]
    public async Task Concurrent_same_slug_creates_one_bundle_and_dispatches_once()
    {
        var before = await fixture.Organizations.CountAllRowsAsync();
        var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        var input = Input();
        var responses = await Task.WhenAll(Post(client, input), Post(client, input));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(1, sender.Calls);
        var after = await fixture.Organizations.CountAllRowsAsync();
        Assert.Equal(before.Organizations + 1, after.Organizations);
        Assert.Equal(before.Entitlements + 7, after.Entitlements);
    }

    [Theory]
    [InlineData("accepted")]
    [InlineData("revoked")]
    public async Task State_changed_during_initial_delivery_is_not_overwritten(string status)
    {
        var slug = "org-" + Guid.NewGuid().ToString("N");
        var sender = new FakeSender
        {
            Handler = async () =>
        {
            var id = await FindBySlug(slug);
            await using var db = new NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
            await using var cmd = new NpgsqlCommand("UPDATE platform_invitations SET status=@status::\"InvitationStatus\" WHERE id=@id", db);
            cmd.Parameters.AddWithValue("id", id); cmd.Parameters.AddWithValue("status", status);
            await cmd.ExecuteNonQueryAsync(); return true;
        }
        };
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        var response = await Post(client, Input(slug));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("changed", json.RootElement.GetProperty("delivery").GetString());
        var row = await ReadInvitation(await FindBySlug(slug)); Assert.Equal(status, row.Status); Assert.Null(row.SentAt);
    }
}
