using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;
using Tims.Application.Audit;
using Tims.Infrastructure.Audit;

namespace Tims.IntegrationTests.Audit;

[Collection("TenantAudit")]
public sealed class TenantAuditCrossRuntimeTests(TenantAuditFixture fixture)
{
    [Fact]
    [Trait("Category", "CrossRuntime")]
    public async Task BothProductionRepositoriesAndServicesAgreeOnTheSameDatabase()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "pnpm-workspace.yaml"))) root = root.Parent;
        Assert.NotNull(root);
        var connection = new NpgsqlConnectionStringBuilder(fixture.ConnectionString);
        var start = new ProcessStartInfo("pnpm")
        {
            WorkingDirectory = root.FullName,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        start.ArgumentList.Add("exec");
        start.ArgumentList.Add("tsx");
        start.ArgumentList.Add("scripts/parity/tenant-audit/read-local.ts");
        start.Environment["DATABASE_URL"] = new UriBuilder("postgresql", "127.0.0.1", connection.Port, connection.Database!)
        { UserName = connection.Username!, Password = connection.Password! }.Uri.AbsoluteUri;
        start.Environment["RLS_ENFORCED"] = "true";
        start.Environment["NODE_ENV"] = "test";
        start.Environment["TIMS_AUDIT_PARITY_LOCAL"] = "true";
        using var process = Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try { await process.WaitForExitAsync(timeout.Token); }
        finally { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        Assert.True(process.ExitCode == 0, await stderr);
        var ts = JsonNode.Parse(await stdout)!.AsObject();

        await using var db = fixture.NewReadContext();
        var useCase = new TenantAuditReadUseCase(new TenantAuditRepository(db));
        var org = TenantAuditFixture.OrgA;
        var date = DateTimeOffset.Parse("2026-07-20T10:00:00Z");
        var results = new Dictionary<string, object?>
        {
            ["report"] = await useCase.GetAccessReportAsync(org, null, null, default),
            ["list"] = await useCase.ListAsync(org, new(Entity: "auth"), 25, null, default),
            ["foreignList"] = await useCase.ListAsync(org, new(Entity: "foreign-only"), 25, null, default),
            ["excludedCursor"] = await useCase.ListAsync(org, new(Action: "access"), 25, Guid.Parse("d0000000-0000-0000-0000-000000000007"), default),
            ["detail"] = await useCase.GetDetailAsync(org, TenantAuditFixture.LogOrgA1, default),
            ["redactedActor"] = await useCase.GetDetailAsync(org, Guid.Parse("d0000000-0000-0000-0000-000000000006"), default),
            ["history"] = await useCase.HistoryAsync(org, "auth", "record-1", 25, null, default),
            ["listFirst"] = await useCase.ListAsync(org, new(Entity: "cross-page"), 1, null, default),
            ["historyFirst"] = await useCase.HistoryAsync(org, "cross-page", "cross-page", 1, null, default),
            ["listMiddle"] = await useCase.ListAsync(org, new(Entity: "cross-page"), 1, Guid.Parse("d0000000-0000-0000-0000-000000000015"), default),
            ["historyMiddle"] = await useCase.HistoryAsync(org, "cross-page", "cross-page", 1, Guid.Parse("d0000000-0000-0000-0000-000000000015"), default),
            ["listLast"] = await useCase.ListAsync(org, new(Entity: "cross-page"), 1, Guid.Parse("d0000000-0000-0000-0000-000000000014"), default),
            ["historyLast"] = await useCase.HistoryAsync(org, "cross-page", "cross-page", 1, Guid.Parse("d0000000-0000-0000-0000-000000000014"), default),
            ["csv"] = await useCase.ExportAsync(org, new(Entity: "csv-probe"), "csv", default),
            ["json"] = await useCase.ExportAsync(org, new(Entity: "csv-probe"), "json", default),
            ["dated"] = await useCase.ExportAsync(org, new(Action: "login_failed", DateFrom: date, DateTo: date), "json", default),
            ["truncated"] = await useCase.ExportAsync(TenantAuditFixture.OrgB, new(Entity: "export-cap"), "json", default),
        };
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        foreach (var (name, result) in results)
        {
            var csharp = JsonSerializer.SerializeToNode(result, options);
            Assert.True(JsonNode.DeepEquals(ts[name], csharp), $"Cross-runtime mismatch: {name}");
        }
    }
}
