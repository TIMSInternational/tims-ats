using Tims.Infrastructure.Audit;
using Xunit;

namespace Tims.IntegrationTests.Audit;

[Collection("AuditRead")]
public sealed class AuditReadCrossOrgTests(AuditReadFixture fixture)
{
    private readonly AuditReadFixture _fixture = fixture;

    [Fact]
    public async Task QueryingWithoutTenantScope_SeesRowsFromEveryOrg()
    {
        // No TenantScope.BeginAsync anywhere in this test — proves the repository's default
        // (privileged) connection is NOT subject to the tenant_isolation RLS policy, by design.
        await using var db = _fixture.NewReadContext();

        var orgIds = db.AuditLogs.Select(a => a.OrganizationId).Distinct().ToList();

        Assert.Contains(AuditReadFixture.OrgA, orgIds);
        Assert.Contains(AuditReadFixture.OrgB, orgIds);
    }
}
