using System.Net;
using System.Text.Json;
using Tims.IntegrationTests.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class BulkInvitationEndpointTests
{
    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(PlatformOrganizationsCreateFixture.OrgUserSub, HttpStatusCode.Forbidden)]
    public async Task Authorization_precedes_body_validation(string? sub, HttpStatusCode status)
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(status, (await Post(client, "invalid-json", sub)).StatusCode);
        Assert.Equal(status, (await Post(client, Input(Email()), sub)).StatusCode);
        Assert.Equal(0, sender.Calls);
    }
    [Theory]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("null")]
    public async Task Invalid_body_never_sends(string body)
    {
        var sender = new FakeSender(); await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, body)).StatusCode);
        Assert.Equal(0, sender.Calls);
    }
    [Theory]
    [InlineData(0)]
    [InlineData(201)]
    public async Task Rejects_out_of_bounds_batch(int count)
    {
        var sender = new FakeSender(); await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, Input(Enumerable.Range(0, count).Select(_ => Email()).ToArray()))).StatusCode);
        Assert.Equal(0, sender.Calls);
    }
    [Fact]
    public async Task Rejects_oversized_body_without_sending()
    {
        var sender = new FakeSender(); await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, new string(' ', 131073))).StatusCode);
        Assert.Equal(0, sender.Calls);
    }
    [Fact]
    public async Task Disabled_flag_hides_route()
    {
        var sender = new FakeSender(); await using var factory = Factory(sender, enabled: false); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await Post(client, Input(Email()))).StatusCode);
        Assert.Equal(0, sender.Calls);
    }
    [Fact]
    public async Task Unknown_role_fails_only_its_row()
    {
        var bad = Email(); var good = Email(); var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        var response = await Post(client, JsonSerializer.Serialize(new
        {
            organizationId = PlatformOrganizationsCreateFixture.OtherOrg,
            users = new[] { new { email = bad, roleSlug = (string?)"missing-role" }, new { email = good, roleSlug = (string?)null } }
        }).Replace(",\"roleSlug\":null", ""));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("role_unavailable", json.RootElement.GetProperty("results")[0].GetProperty("reason").GetString());
        Assert.Equal("sent", json.RootElement.GetProperty("results")[1].GetProperty("status").GetString());
        Assert.Equal(1, sender.Calls); Assert.Equal(0, await Count(bad)); Assert.Equal(1, await Count(good));
    }
}
