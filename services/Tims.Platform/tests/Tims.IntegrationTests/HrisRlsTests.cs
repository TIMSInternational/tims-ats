using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Infrastructure;
using Tims.Infrastructure.Hris;

namespace Tims.IntegrationTests;

/// <summary>
/// WP3.1 — proves tenant isolation on the FIRST EF-OWNED product tables (hris_*) FOR REAL, against the
/// migration's own RLS blocks in a Postgres container (never mocked). Same doctrine as the Phase-1
/// Spike A widget tests: the four assertions the C# convergence requires before HRIS data can land.
/// </summary>
[Collection("HrisRls")]
public sealed class HrisRlsTests(HrisSchemaFixture fixture)
{
    // ---- Assertion (a): org A reads only org A's rows -----------------------------------
    [Fact]
    public async Task TenantScope_OrgA_ReadsOnlyOwnRows()
    {
        await using var db = new HrisDbContext(HrisSchemaFixture.BuildOptions(fixture.ConnectionString));
        await using var scope = await TenantScope.BeginAsync(db, HrisSchemaFixture.OrgA);

        var connectors = await db.Connectors.AsNoTracking().ToListAsync();
        var employees = await db.ExternalEmployees.AsNoTracking().ToListAsync();
        await scope.CommitAsync();

        Assert.Equal(HrisSchemaFixture.ConnectorA, Assert.Single(connectors).Id);
        Assert.Equal(HrisSchemaFixture.EmployeeA, Assert.Single(employees).Id);
        Assert.All(connectors, c => Assert.Equal(HrisSchemaFixture.OrgA, c.OrganizationId));
        Assert.All(employees, e => Assert.Equal(HrisSchemaFixture.OrgA, e.OrganizationId));
    }

    // ---- Assertion (b): org A cannot read/update/delete org B's rows --------------------
    [Fact]
    public async Task TenantScope_OrgA_CannotReadUpdateOrDeleteOrgBRows()
    {
        await using var db = new HrisDbContext(HrisSchemaFixture.BuildOptions(fixture.ConnectionString));
        await using var scope = await TenantScope.BeginAsync(db, HrisSchemaFixture.OrgA);

        // Hidden by RLS, not merely filtered by a WHERE clause.
        var bConnector = await db.Connectors.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == HrisSchemaFixture.ConnectorB);
        Assert.Null(bConnector);

        var bEmployee = await db.ExternalEmployees.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == HrisSchemaFixture.EmployeeB);
        Assert.Null(bEmployee);

        var updated = await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE hris_external_employees SET first_name = 'hacked' WHERE id = {HrisSchemaFixture.EmployeeB}");
        Assert.Equal(0, updated);

        var deleted = await db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM hris_connectors WHERE id = {HrisSchemaFixture.ConnectorB}");
        Assert.Equal(0, deleted);

        await scope.CommitAsync();
    }

    // ---- Assertion (c): unset GUC -> 0 rows, fail-closed --------------------------------
    [Fact]
    public async Task TenantScope_UnsetOrganization_ReturnsZeroRows_FailClosed()
    {
        await using var db = new HrisDbContext(HrisSchemaFixture.BuildOptions(fixture.ConnectionString));
        await using var scope = await TenantScope.BeginAsync(db, organizationId: null);

        var connectors = await db.Connectors.AsNoTracking().ToListAsync();
        var employees = await db.ExternalEmployees.AsNoTracking().ToListAsync();
        await scope.CommitAsync();

        Assert.Empty(connectors);
        Assert.Empty(employees);
    }

    // ---- Assertion (d): org A INSERT stamped org B -> WITH CHECK violation (42501) ------
    [Fact]
    public async Task TenantScope_OrgA_CannotInsertRowForOrgB_WithCheck()
    {
        await using var db = new HrisDbContext(HrisSchemaFixture.BuildOptions(fixture.ConnectionString));
        await using var scope = await TenantScope.BeginAsync(db, HrisSchemaFixture.OrgA);

        var ex = await Assert.ThrowsAsync<PostgresException>(async () =>
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO hris_external_employees
                     (id, organization_id, connector_id, external_id, first_name, last_name, source_hash)
                 VALUES ({Guid.NewGuid()}, {HrisSchemaFixture.OrgB}, {HrisSchemaFixture.ConnectorA},
                         'smuggled', 'Mal', 'Lory', 'hash-x')
                 """));

        Assert.Equal("42501", ex.SqlState); // RLS WITH CHECK policy violation
    }

    // ---- Bonus control: without the role switch, the superuser sees every org's rows ----
    [Fact]
    public async Task WithoutTenantScope_SuperuserConnection_SeesAllRows()
    {
        await using var db = new HrisDbContext(HrisSchemaFixture.BuildOptions(fixture.ConnectionString));

        var connectors = await db.Connectors.AsNoTracking().ToListAsync();

        Assert.Equal(2, connectors.Count);
    }
}
