using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure;
using Tims.Infrastructure.Audit;

namespace Tims.IntegrationTests.Audit;

[Collection("TenantAudit")]
public sealed class TenantAuditRepositoryTests(TenantAuditFixture fixture)
{
    [Fact]
    public async Task Report_IsBoundedAndPreservesNullActor()
    {
        await using var db = fixture.NewReadContext();
        var rows = await new TenantAuditRepository(db).GetAccessReportAsync(
            TenantAuditFixture.OrgB, null, null, CancellationToken.None);
        Assert.Equal(50, rows.Count);
        Assert.Equal("foreign-only", rows[0].Entity);
        Assert.Equal(2, rows[0].Count.Id);
        Assert.All(rows, row => Assert.Null(row.ActorId));
        Assert.All(rows.Skip(1), row => Assert.Equal(1, row.Count.Id));
        Assert.DoesNotContain(rows, row => row.Entity == "candidate");
    }

    [Fact]
    public async Task TenantRole_HidesForeignRowsEvenWithoutApplicationFilter()
    {
        await using var db = fixture.NewReadContext();
        await using var tenant = await TenantScope.BeginAsync(db, TenantAuditFixture.OrgA, CancellationToken.None);
        var orgs = await db.AuditLogs.Select(row => row.OrganizationId).Distinct().ToListAsync();
        Assert.Equal(TenantAuditFixture.OrgA, Assert.Single(orgs));
        await tenant.CommitAsync(CancellationToken.None);
    }

    [Fact]
    public async Task EmptyTenant_HasNoGroups()
    {
        await using var db = fixture.NewReadContext();
        var rows = await new TenantAuditRepository(db).GetAccessReportAsync(
            Guid.NewGuid(), null, null, CancellationToken.None);
        Assert.Empty(rows);
    }
}
