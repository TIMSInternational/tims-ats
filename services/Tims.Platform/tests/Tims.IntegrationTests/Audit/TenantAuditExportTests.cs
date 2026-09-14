using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Tims.Application.Audit;
using Tims.Infrastructure.Audit;
using Tims.Domain.Identity;

namespace Tims.IntegrationTests.Audit;

public sealed partial class TenantAuditEndpointTests
{
    [Theory]
    [InlineData("json")]
    [InlineData("csv")]
    public async Task Export_RedactsPayloadAndAuditsActor(string format)
    {
        var audit = new RecordingAudit();
        await using var factory = EnabledFactory(audit);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", "Bearer " + Mint(TenantAuditFixture.OrgUserSub));
        var response = await client.PostAsJsonAsync("/tenant-audit/export", new { format, action = "login_failed" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, json.RootElement.GetProperty("count").GetInt32());
        Assert.False(json.RootElement.GetProperty("truncated").GetBoolean());
        var data = json.RootElement.GetProperty("data").GetString()!;
        Assert.Contains("Rick Recruiter", data);
        Assert.DoesNotContain("before", data);
        Assert.DoesNotContain("metadata", data);
        Assert.DoesNotContain("foreign-only", data);
        if (format == "json")
        {
            using var records = JsonDocument.Parse(data);
            Assert.Equal(8, Assert.Single(records.RootElement.EnumerateArray()).EnumerateObject().Count());
        }
        var entry = Assert.Single(audit.Events);
        Assert.Equal(TenantAuditFixture.OrgA, entry.OrganizationId);
        Assert.Equal(TenantAuditFixture.OrgUserId, entry.ActorId);
        Assert.Equal("platform_export", entry.Action);
        Assert.Equal("export:audit_log", entry.Entity);
        Assert.Equal(1, entry.Metadata!["count"]!.GetValue<int>());
        Assert.False(audit.Cancellable);
    }

    [Theory]
    [InlineData(null, "json", 401)]
    [InlineData("sub-audit-denied", "json", 403)]
    [InlineData(TenantAuditFixture.OrgUserSub, "xlsx", 400)]
    public async Task Export_RejectsUnauthorizedOrInvalid(string? sub, string format, int status)
    {
        var audit = new RecordingAudit();
        await using var factory = EnabledFactory(audit);
        using var client = factory.CreateClient();
        if (sub is not null) client.DefaultRequestHeaders.Add("Authorization", "Bearer " + Mint(sub));
        var response = await client.PostAsJsonAsync("/tenant-audit/export", new { format });
        Assert.Equal(status, (int)response.StatusCode);
        Assert.DoesNotContain(audit.Events, entry => entry.Action == "platform_export");
    }

    [Fact]
    public async Task Export_TruncatesAtTenThousandWithoutSensitivePayload()
    {
        await using var db = _fixture.NewReadContext();
        var result = await new TenantAuditReadUseCase(new TenantAuditRepository(db)).ExportAsync(
            TenantAuditFixture.OrgB, new(Entity: "export-cap"), "json", CancellationToken.None);
        Assert.True(result.Truncated);
        Assert.Equal(10000, result.Count);
        using var records = JsonDocument.Parse(result.Data);
        Assert.Equal(10000, records.RootElement.GetArrayLength());
        Assert.DoesNotContain("secret", result.Data);
    }

    [Fact]
    public async Task ReadGrantDoesNotPermitExport()
    {
        var audit = new RecordingAudit();
        await using var factory = EnabledFactory(audit);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", "Bearer " + Mint("sub-audit-read-only"));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(LogsPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/tenant-audit/export", new { format = "json" })).StatusCode);
        Assert.DoesNotContain(audit.Events, entry => entry.Action == "platform_export");
    }

    [Fact]
    public async Task CsvNeutralizesFormulaAndQuotesComma()
    {
        await using var db = _fixture.NewReadContext();
        var result = await new TenantAuditReadUseCase(new TenantAuditRepository(db)).ExportAsync(
            TenantAuditFixture.OrgA, new(Entity: "csv-probe"), "csv", CancellationToken.None);
        Assert.Equal(1, result.Count);
        Assert.Contains("\"'=SUM(1,2)\"", result.Data);
    }

    [Fact]
    public async Task ImpersonatedExport_UsesTargetGrantAndAttributesOwner()
    {
        var secret = Guid.NewGuid().ToString("N");
        var owner = "c0000000-0000-0000-0000-000000000001";
        var audit = new RecordingAudit();
        await using var factory = EnabledFactory(audit, secret);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", "Bearer " + Mint(TenantAuditFixture.PlatformOwnerSub));
        var cookie = ImpersonationCookie.SignImpersonationToken(secret, owner,
            TenantAuditFixture.OrgUserId.ToString(), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        client.DefaultRequestHeaders.Add("Cookie", $"{ImpersonationCookie.CookieName}={cookie}");
        var response = await client.PostAsJsonAsync("/tenant-audit/export", new { format = "json", action = "login_failed" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var entry = Assert.Single(audit.Events, entry => entry.Action == "platform_export");
        Assert.Equal(Guid.Parse(owner), entry.ActorId);
        Assert.Equal(TenantAuditFixture.OrgA, entry.OrganizationId);
    }

    [Fact]
    public async Task JsonExportPreservesUnicodeAndMarkupCharactersAsData()
    {
        await using var db = _fixture.NewReadContext();
        var result = await new TenantAuditReadUseCase(new TenantAuditRepository(db)).ExportAsync(
            TenantAuditFixture.OrgA, new(Entity: "csv-probe"), "json", CancellationToken.None);
        Assert.Contains("José <&>", result.Data);
    }

    [Fact]
    public async Task ExportAppliesActorAndInclusiveDates()
    {
        await using var db = _fixture.NewReadContext();
        var useCase = new TenantAuditReadUseCase(new TenantAuditRepository(db));
        var date = DateTimeOffset.Parse("2026-07-21T10:00:00Z");
        var matching = await useCase.ExportAsync(TenantAuditFixture.OrgA,
            new(TenantAuditFixture.OrgUserId, Action: "access", DateFrom: date, DateTo: date), "json", CancellationToken.None);
        Assert.Equal(2, matching.Count);
        var other = await useCase.ExportAsync(TenantAuditFixture.OrgA,
            new(Guid.NewGuid(), DateFrom: date, DateTo: date), "json", CancellationToken.None);
        Assert.Equal(0, other.Count);
    }

    private sealed class RecordingAudit : ISecurityEventWriter
    {
        public List<SecurityEvent> Events { get; } = [];
        public bool Cancellable { get; private set; }
        public Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken)
        {
            Cancellable = cancellationToken.CanBeCanceled;
            Events.Add(securityEvent);
            return Task.CompletedTask;
        }
    }
}
