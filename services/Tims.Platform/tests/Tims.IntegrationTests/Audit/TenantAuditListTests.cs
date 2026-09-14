using System.Net;
using System.Text.Json;

namespace Tims.IntegrationTests.Audit;

public sealed partial class TenantAuditEndpointTests
{
    [Fact]
    public async Task List_PaginatesTiesWithoutDuplicatesAndOmitsTerminalCursor()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var ids = new HashSet<Guid>();
        string? cursor = null;
        for (var i = 0; i < 10; i++)
        {
            var response = await Get(client, "/tenant-audit/logs?take=1&action=access" + (cursor is null ? "" : "&cursor=" + cursor), Mint(TenantAuditFixture.OrgUserSub));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var log = Assert.Single(json.RootElement.GetProperty("items").EnumerateArray());
            Assert.Equal(TenantAuditFixture.OrgA, log.GetProperty("organizationId").GetGuid());
            Assert.True(ids.Add(log.GetProperty("id").GetGuid()), "Cursor repeated a row");
            if (log.GetProperty("actor").ValueKind != JsonValueKind.Null)
            {
                Assert.True(log.GetProperty("actor").TryGetProperty("avatar", out _));
                Assert.False(log.GetProperty("actor").TryGetProperty("email", out _));
            }
            cursor = json.RootElement.TryGetProperty("nextCursor", out var next) ? next.GetString() : null;
            if (cursor is null) break;
        }
        Assert.Null(cursor);
        Assert.Equal(2, ids.Count);
    }

    [Theory]
    [InlineData("/tenant-audit/logs?action=page-test")]
    [InlineData("/tenant-audit/history?entity=history&entityId=pagination")]
    public async Task PagesAcrossMixedDatesAndTies(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        string? cursor = null;
        foreach (var suffix in new[] { "012", "011", "010" })
        {
            var response = await Get(client, path + "&take=1" + (cursor is null ? "" : "&cursor=" + cursor), Mint(TenantAuditFixture.OrgUserSub));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var row = Assert.Single(json.RootElement.GetProperty("items").EnumerateArray());
            Assert.EndsWith(suffix, row.GetProperty("id").GetString());
            cursor = json.RootElement.TryGetProperty("nextCursor", out var next) ? next.GetString() : null;
        }
        Assert.Null(cursor);
    }

    [Theory]
    [InlineData("/tenant-audit/logs?entity=candidate&action=access", 2)]
    [InlineData("/tenant-audit/logs?entity=foreign-only", 0)]
    [InlineData("/tenant-audit/logs?cursor=d0000000-0000-0000-0000-000000000003", 0)]
    [InlineData("/tenant-audit/history?entity=auth&entityId=record-1", 1)]
    [InlineData("/tenant-audit/history?entity=wrong&entityId=record-1", 0)]
    public async Task ListAndHistory_ApplyFilters(string path, int count)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, path, Mint(TenantAuditFixture.OrgUserSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(count, json.RootElement.GetProperty("items").GetArrayLength());
        if (path.Contains("history") && count > 0)
            Assert.Equal(3, json.RootElement.GetProperty("items")[0].GetProperty("actor").EnumerateObject().Count());
    }

    [Theory]
    [InlineData("/tenant-audit/logs?take=0", 400)]
    [InlineData("/tenant-audit/logs?take=101", 400)]
    [InlineData("/tenant-audit/logs?cursor=bad", 400)]
    [InlineData("/tenant-audit/history?entity=auth", 400)]
    public async Task ListAndHistory_RejectInvalidInput(string path, int expected)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(expected, (int)(await Get(client, path, Mint(TenantAuditFixture.OrgUserSub))).StatusCode);
    }

    [Theory]
    [InlineData("/tenant-audit/logs")]
    [InlineData("/tenant-audit/history?entity=auth&entityId=record-1")]
    public async Task ListAndHistory_RequirePermission(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, path, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Get(client, path, Mint("sub-audit-denied"))).StatusCode);
    }
}
