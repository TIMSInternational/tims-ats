using System.Net;
using Microsoft.AspNetCore.Hosting;
using Tims.Domain.Identity;
using Tims.IntegrationTests.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class OrganizationInvitationEndpointTests
{
    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(PlatformOrganizationsCreateFixture.OrgUserSub, HttpStatusCode.Forbidden)]
    public async Task Authorization_precedes_body_validation(string? sub, HttpStatusCode expected)
    {
        var sender = new FakeSender();
        var before = await fixture.Organizations.CountAllRowsAsync();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(expected, (await Post(client, "invalid-json", sub)).StatusCode);
        Assert.Equal(expected, (await Post(client, Input(), sub)).StatusCode);
        Assert.Equal(0, sender.Calls); Assert.Equal(before, await fixture.Organizations.CountAllRowsAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("{\"email\":\"a@b.com\",\"email\":\"b@c.com\"}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationName\":\"Test\",\"organizationSlug\":\"ok\",\"organizationPlan\":null}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationName\":42,\"organizationSlug\":\"ok\"}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationName\":\"Test\",\"organizationSlug\":\"UPPER\"}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationName\":\"Test\\nInjected\",\"organizationSlug\":\"ok\"}")]
    [InlineData("{\"email\":\"a@b.com\",\"organizationName\":\"Test\",\"organizationSlug\":\"ok\",\"organizationPlan\":\"free\"}")]
    public async Task Invalid_body_cannot_create_or_send(string body)
    {
        var sender = new FakeSender(); var before = await fixture.Organizations.CountAllRowsAsync();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, body)).StatusCode);
        Assert.Equal(before, await fixture.Organizations.CountAllRowsAsync()); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Oversized_body_is_rejected_before_creation()
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, new string(' ', 8193) + Input())).StatusCode);
        Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Missing_plan_defaults_to_trial_and_slug_supports_63_characters()
    {
        await using var factory = Factory(new FakeSender()); using var client = factory.CreateClient();
        var slug = new string('a', 31) + Guid.NewGuid().ToString("N");
        var response = await Post(client, "{\"email\":\"a@b.com\",\"organizationName\":\"Test\",\"organizationSlug\":\"" + slug + "\"}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("trial", (await ReadInvitation(await FindBySlug(slug))).Plan);
    }

    [Fact]
    public async Task Disabled_flag_does_not_expose_creation()
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender, enabled: false); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await Post(client, Input())).StatusCode); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Mfa_enforcement_denies_unstepped_owner()
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender).WithWebHostBuilder(b => b.UseSetting("Platform:MfaEnforced", "true"));
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(client, Input())).StatusCode); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Signed_impersonation_denies_owner()
    {
        var secret = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        var sender = new FakeSender();
        await using var factory = Factory(sender).WithWebHostBuilder(b => b.UseSetting("Platform:ImpersonationSecret", secret));
        using var client = factory.CreateClient();
        var cookie = ImpersonationCookie.SignImpersonationToken(secret, PlatformOrganizationsCreateFixture.Actor.ToString(),
            PlatformOrganizationsCreateFixture.NonOwner.ToString(), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        client.DefaultRequestHeaders.Add("Cookie", $"{ImpersonationCookie.CookieName}={cookie}");
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(client, Input())).StatusCode); Assert.Equal(0, sender.Calls);
    }
}
