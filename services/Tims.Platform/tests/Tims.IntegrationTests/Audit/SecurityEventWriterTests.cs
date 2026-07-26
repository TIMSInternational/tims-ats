using System.Linq;
using System.Text.Json.Nodes;
using Tims.Application.Audit;
using Tims.Infrastructure.Audit;
using Xunit;

namespace Tims.IntegrationTests.Audit;

/// <summary>
/// Phase-5 Slice-18 Testcontainers proof of <see cref="SecurityEventWriter"/> — the NEW, generic,
/// privileged writer into <c>audit_logs</c> (sibling to <see cref="BillingAuditWriter"/>, NOT a
/// replacement: this one never wraps writes in <see cref="TenantScope"/>, since the caller is always a
/// resolved platform owner acting cross-org, never a tenant context). Reuses the shared
/// <see cref="AuditWriterFixture"/> (same container as <c>DataAccessAuditWriterTests</c>), so the
/// happy-path write targets the fixture's seeded <see cref="AuditWriterFixture.OrgA"/> /
/// <see cref="AuditWriterFixture.RealOwner"/> rows to satisfy the <c>audit_logs</c> FK constraints
/// (organization_id -&gt; organizations, actor_id -&gt; users_audit). The fail-soft test points the writer
/// at <see cref="AuditWriterFixture.MissingTableConnectionString"/> — a real, separate database on the
/// same server with no <c>audit_logs</c> table — for a deterministic INSERT failure, rather than
/// dropping the shared collection's database out from under other tests.
/// </summary>
[Collection("AuditWriter")]
public sealed class SecurityEventWriterTests(AuditWriterFixture fixture)
{
    private readonly AuditWriterFixture _fixture = fixture;

    [Fact]
    public async Task WriteAsync_InsertsARow_WithTheGivenEntityActionAndMetadata()
    {
        await using var db = _fixture.NewAuditLogContext(_fixture.ConnectionString);
        var writer = new SecurityEventWriter(db);
        var orgId = AuditWriterFixture.OrgA;
        var actorId = AuditWriterFixture.RealOwner;

        await writer.WriteAsync(
            new SecurityEvent(orgId, actorId, "access_review_viewed", "access_review", null,
                new JsonObject { ["targetOrgId"] = orgId.ToString(), ["userCount"] = 6 }),
            CancellationToken.None);

        await using var readback = _fixture.NewAuditLogContext(_fixture.ConnectionString);
        var row = readback.AuditLogs
            .Where(a => a.OrganizationId == orgId && a.Action == "access_review_viewed")
            .OrderByDescending(a => a.CreatedAt)
            .First();
        Assert.Equal("access_review_viewed", row.Action);
        Assert.Equal("access_review", row.Entity);
        Assert.Equal(actorId, row.ActorId);
        Assert.Contains("targetOrgId", row.Metadata);
    }

    [Fact]
    public async Task WriteAsync_NeverThrows_WhenTheUnderlyingWriteFails()
    {
        // MissingTableConnectionString points at a real, separate DB with NO audit_logs table, so the
        // INSERT fails deterministically ("relation does not exist") without touching the shared
        // collection's main database (which other AuditWriter-collection tests still rely on).
        await using var db = _fixture.NewAuditLogContext(_fixture.MissingTableConnectionString);
        var writer = new SecurityEventWriter(db);

        var exception = await Record.ExceptionAsync(() =>
            writer.WriteAsync(
                new SecurityEvent(Guid.NewGuid(), null, "access_review_viewed", "access_review", null, null),
                CancellationToken.None));

        Assert.Null(exception); // fail-soft: never throws into the caller
    }
}
