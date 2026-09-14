using System.Net;
using System.Text.Json;

namespace Tims.IntegrationTests.Audit;

public sealed partial class TenantAuditEndpointTests
{
    private static string Detail(Guid id) => $"/tenant-audit/logs/{id}";

    [Fact]
    public async Task Detail_ReturnsNestedJsonAndTenantPeople()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Detail(TenantAuditFixture.LogOrgA1), Mint(TenantAuditFixture.OrgUserSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var log = json.RootElement;
        Assert.Equal(TenantAuditFixture.LogOrgA1, log.GetProperty("id").GetGuid());
        Assert.Equal(TenantAuditFixture.OrgA, log.GetProperty("organizationId").GetGuid());
        Assert.Equal("old", log.GetProperty("changes").GetProperty("before").GetProperty("status").GetString());
        Assert.Equal("test", log.GetProperty("metadata").GetProperty("source").GetString());
        Assert.Equal("2026-07-20T10:00:00.000Z", log.GetProperty("createdAt").GetString());
        foreach (var key in new[] { "actor", "user" })
        {
            var person = log.GetProperty(key);
            Assert.Equal(TenantAuditFixture.OrgUserId, person.GetProperty("id").GetGuid());
            Assert.Equal("orguser@tims.test", person.GetProperty("email").GetString());
            Assert.Equal(4, person.EnumerateObject().Count());
        }
        Assert.Equal(14, log.EnumerateObject().Count());
    }

    [Fact]
    public async Task Detail_ForeignAndMissingIdsAreBoth404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        foreach (var id in new[] { TenantAuditFixture.LogOrgB1, Guid.NewGuid() })
        {
            var response = await Get(client, Detail(id), Mint(TenantAuditFixture.OrgUserSub));
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }

    [Fact]
    public async Task Detail_ForeignPersonReferenceDoesNotExposeIdentity()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Detail(Guid.Parse("d0000000-0000-0000-0000-000000000006")), Mint(TenantAuditFixture.OrgUserSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("actor").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("user").ValueKind);
    }

    [Theory]
    [InlineData(null, 401)]
    [InlineData("sub-audit-denied", 403)]
    [InlineData(TenantAuditFixture.PlatformOwnerSub, 400)]
    public async Task Detail_RejectsUnauthorizedCaller(string? sub, int expected)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Detail(TenantAuditFixture.LogOrgA1), sub is null ? null : Mint(sub));
        Assert.Equal(expected, (int)response.StatusCode);
    }

    [Fact]
    public async Task Detail_DefaultFlagIsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Detail(TenantAuditFixture.LogOrgA1), null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
