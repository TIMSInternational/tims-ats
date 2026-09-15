using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Npgsql;
using Tims.IntegrationTests.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class OrganizationInvitationEndpointTests
{
    [Theory]
    [InlineData("trial")]
    [InlineData("starter")]
    [InlineData("professional")]
    [InlineData("enterprise")]
    public async Task Creates_complete_bundle_and_marks_sent_only_after_provider_acceptance(string plan)
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        var response = await Post(client, Input(plan: plan));
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(body);
        var result = json.RootElement;
        Assert.Equal(3, result.EnumerateObject().Count());
        var org = result.GetProperty("organizationId").GetGuid();
        var id = result.GetProperty("id").GetGuid();
        Assert.Equal("accepted", result.GetProperty("delivery").GetString());
        var counts = await fixture.Organizations.CountAllProvisionedRowsAsync(org);
        Assert.Equal(new PlatformOrganizationsCreateFixture.ProvisionedCounts(1, 1, 1, 1, 1, 1, 7), counts);
        var company = Assert.Single(await fixture.Organizations.ReadCompaniesAsync(org));
        var unit = Assert.Single(await fixture.Organizations.ReadBusinessUnitsAsync(org));
        var team = Assert.Single(await fixture.Organizations.ReadTeamsAsync(org));
        Assert.Equal(company.Id, unit.CompanyId); Assert.Equal(unit.Id, team.BusinessUnitId);
        var subscription = (await fixture.Organizations.ReadSubscriptionAsync(org))!;
        Assert.Equal(plan, subscription.Plan);
        Assert.Equal(plan == "trial" ? "trialing" : "active", subscription.Status);
        Assert.Equal(plan == "trial", subscription.TrialEndsAt.HasValue);
        var role = Assert.Single(await fixture.Organizations.ReadRolesAsync(org));
        Assert.Equal("super_admin", role.Slug); Assert.True(role.IsSystem);
        var entitlements = await fixture.Organizations.ReadEntitlementsAsync(org);
        Assert.Equal(5000, Assert.Single(entitlements, e => e.ModuleCode == "ai_screening").Limit);
        var invitation = await ReadInvitation(id);
        Assert.Equal(org, invitation.Org); Assert.Equal("sent", invitation.Status);
        Assert.NotNull(invitation.SentAt); Assert.Equal("org_admin", invitation.Type);
        Assert.Equal(plan, invitation.Plan); Assert.Equal(PlatformOrganizationsCreateFixture.Actor, invitation.Actor);
        Assert.Equal(7, (invitation.ExpiresAt - invitation.CreatedVersion).TotalDays);
        Assert.DoesNotContain(invitation.Token, body); Assert.DoesNotContain("admin@", body);
        Assert.Contains("?token=" + invitation.Token, sender.Html);
        Assert.Contains("&lt;script&gt;", sender.Html); Assert.DoesNotContain("<script>", sender.Html);
        var audit = await fixture.Organizations.ReadAuditRowsAsync(org);
        Assert.Contains(audit, a => a.Action == "org_invitation_created" && a.ActorId == PlatformOrganizationsCreateFixture.Actor && a.EntityId == id.ToString());
        Assert.Contains(audit, a => a.Action == "org_invitation_delivery");
        Assert.Equal(1, sender.Calls);
    }

    [Fact]
    public async Task Pending_row_and_entire_bundle_are_committed_before_email_dispatch()
    {
        var slug = "org-" + Guid.NewGuid().ToString("N");
        Invitation? observed = null;
        PlatformOrganizationsCreateFixture.ProvisionedCounts? observedCounts = null;
        Exception? observationError = null;
        var sender = new FakeSender
        {
            Handler = async () =>
        {
            try
            {
                var id = await FindBySlug(slug);
                observed = await ReadInvitation(id);
                observedCounts = await fixture.Organizations.CountAllProvisionedRowsAsync(observed.Org);
            }
            catch (Exception error) { observationError = error; }
            return false;
        }
        };
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        var response = await Post(client, Input(slug));
        Assert.Null(observationError);
        Assert.NotNull(observed);
        Assert.Equal("pending", observed.Status);
        Assert.Null(observed.SentAt);
        Assert.Equal(new PlatformOrganizationsCreateFixture.ProvisionedCounts(1, 1, 1, 1, 1, 1, 7), observedCounts);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("unconfirmed", await response.Content.ReadAsStringAsync());
        var stored = await ReadInvitation(await FindBySlug(slug));
        Assert.Equal("pending", stored.Status); Assert.Null(stored.SentAt);
        // Same slug cannot create another org or send again after uncertain delivery.
        Assert.Equal(HttpStatusCode.Conflict, (await Post(client, Input(slug))).StatusCode);
        Assert.Equal(1, sender.Calls);
    }

    [Fact]
    public async Task Missing_audit_rolls_back_every_setup_row_and_invitation_without_sending()
    {
        var connection = fixture.Organizations.MissingAuditTableConnectionString;
        var before = await fixture.Organizations.CountAllRowsAsync(connection);
        var sender = new FakeSender();
        await using var factory = Factory(sender, connection: connection);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.InternalServerError, (await Post(client, Input())).StatusCode);
        Assert.Equal(before, await fixture.Organizations.CountAllRowsAsync(connection));
        await using var db = new NpgsqlConnection(connection); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(*) FROM platform_invitations", db);
        Assert.Equal(0L, await cmd.ExecuteScalarAsync()); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Real_disabled_sender_retains_pending_creation()
    {
        await using var factory = Factory(new FakeSender(), replaceSender: false);
        using var client = factory.CreateClient();
        var response = await Post(client, Input());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("unconfirmed", json.RootElement.GetProperty("delivery").GetString());
        var row = await ReadInvitation(json.RootElement.GetProperty("id").GetGuid());
        Assert.Equal("pending", row.Status); Assert.Null(row.SentAt);
    }

    private sealed record Invitation(Guid Org, string Status, DateTime? SentAt, string Token, DateTime ExpiresAt,
        DateTime CreatedVersion, string Type, string? Plan, Guid Actor);
    private async Task<Invitation> ReadInvitation(Guid id)
    {
        await using var db = new NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT organization_id,status::text,sent_at,token,expires_at,(SELECT updated_at FROM organizations WHERE id=platform_invitations.organization_id),type::text,organization_plan,invited_by_id FROM platform_invitations WHERE id=@id", db);
        cmd.Parameters.AddWithValue("id", id);
        await using var r = await cmd.ExecuteReaderAsync(); Assert.True(await r.ReadAsync());
        return new(r.GetGuid(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetDateTime(2), r.GetString(3), r.GetDateTime(4),
            r.GetDateTime(5), r.GetString(6), r.IsDBNull(7) ? null : r.GetString(7), r.GetGuid(8));
    }
    private async Task<Guid> FindBySlug(string slug)
    {
        await using var db = new NpgsqlConnection(fixture.ConnectionString); await db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT id FROM platform_invitations WHERE organization_slug=@slug", db);
        cmd.Parameters.AddWithValue("slug", slug); return (Guid)(await cmd.ExecuteScalarAsync())!;
    }
}
