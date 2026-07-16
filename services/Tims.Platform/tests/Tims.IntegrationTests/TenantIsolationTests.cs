using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Infrastructure;

namespace Tims.IntegrationTests;

/// <summary>
/// Phase 1 Spike A: proves EF Core + Npgsql can reproduce Postgres RLS tenant
/// isolation under transaction pooling. See
/// docs/architecture/csharp-migration/phase-1-runway-and-spikes.md (WP1.4) and
/// docs/architecture/2026-07-15-csharp-backend-target-architecture.md §3.
///
/// This IS the deliverable — every assertion below must hold for the C#
/// convergence plan to proceed past Phase 1.
/// </summary>
[Collection("RLS")]
public sealed class TenantIsolationTests(RlsFixture fixture)
{
    // ---- Assertion 1: org A reads only org A's rows ----------------------------
    [Fact]
    public async Task TenantScope_OrgA_ReadsOnlyOwnRows()
    {
        await using var db = new TenantWidgetDbContext(RlsFixture.BuildOptions(fixture.ConnectionString));
        await using var scope = await TenantScope.BeginAsync(db, RlsFixture.OrgA);

        var rows = await db.Widgets.AsNoTracking().ToListAsync();
        await scope.CommitAsync();

        Assert.Equal(2, rows.Count);
        Assert.All(rows, w => Assert.Equal(RlsFixture.OrgA, w.OrganizationId));
        Assert.DoesNotContain(rows, w => w.Id == RlsFixture.WidgetB1 || w.Id == RlsFixture.WidgetB2);
    }

    // ---- Assertion 2: org A cannot read/update/delete org B's rows -------------
    [Fact]
    public async Task TenantScope_OrgA_CannotReadUpdateOrDeleteOrgBRows()
    {
        await using var db = new TenantWidgetDbContext(RlsFixture.BuildOptions(fixture.ConnectionString));
        await using var scope = await TenantScope.BeginAsync(db, RlsFixture.OrgA);

        var bWidget = await db.Widgets.AsNoTracking()
            .FirstOrDefaultAsync(w => w.Id == RlsFixture.WidgetB1);
        Assert.Null(bWidget); // hidden by RLS, not just filtered by a WHERE clause

        var updated = await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE widgets SET name = 'hacked' WHERE id = {RlsFixture.WidgetB1}");
        Assert.Equal(0, updated);

        var deleted = await db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM widgets WHERE id = {RlsFixture.WidgetB1}");
        Assert.Equal(0, deleted);

        await scope.CommitAsync();
    }

    // ---- Assertion 2b: org A cannot INSERT a row belonging to org B (WITH CHECK) ----
    // USING gates reads/updates/deletes; the policy's WITH CHECK clause is what stops a
    // scoped caller from WRITING a row into another tenant. Postgres raises
    // "new row violates row-level security policy" (SQLSTATE 42501) on such an insert.
    [Fact]
    public async Task TenantScope_OrgA_CannotInsertRowForOrgB_WithCheck()
    {
        await using var db = new TenantWidgetDbContext(RlsFixture.BuildOptions(fixture.ConnectionString));
        await using var scope = await TenantScope.BeginAsync(db, RlsFixture.OrgA);

        var ex = await Assert.ThrowsAsync<PostgresException>(async () =>
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO widgets (id, organization_id, name) VALUES ({Guid.NewGuid()}, {RlsFixture.OrgB}, 'smuggled')"));

        Assert.Equal("42501", ex.SqlState); // insufficient_privilege / RLS policy violation
    }

    // ---- Assertion 3: unset GUC (app_tenant role, no org) -> 0 rows, fail-closed
    [Fact]
    public async Task TenantScope_UnsetOrganization_ReturnsZeroRows_FailClosed()
    {
        await using var db = new TenantWidgetDbContext(RlsFixture.BuildOptions(fixture.ConnectionString));
        await using var scope = await TenantScope.BeginAsync(db, organizationId: null);

        var rows = await db.Widgets.AsNoTracking().ToListAsync();
        await scope.CommitAsync();

        Assert.Empty(rows);
    }

    // ---- Assertion 4 (the critical one): no leak across pooled connection reuse
    //
    // IMPORTANT: this test manages ONE physical NpgsqlConnection directly and NEVER
    // closes it between the two "requests" below. That is deliberate, and it is why
    // this is a valid simulation of Supavisor/pgbouncer transaction-mode pooling and
    // NOT of Npgsql's own ADO.NET connection pool.
    //
    // Npgsql's ADO.NET pool resets session state (role, GUCs) when a connection is
    // returned via Close()/Dispose() by default ("No Reset On Close" defaults to
    // false) — so relying on `MaxPoolSize=1` + closing/reopening DbContexts would
    // give a false pass even for a BROKEN implementation that uses session-level
    // `SET ROLE` / `set_config(..., false)`, because Npgsql's own reset would erase
    // the leak before the next borrower ever saw it. A real transaction-mode pooler
    // (Supavisor/pgbouncer) does NOT reset the backend session between transactions
    // it hands out on the same physical connection — so the only thing standing
    // between org A and org B is whether the SQL we issued was transaction-scoped
    // (`SET LOCAL`) or session-scoped (`SET`). This test proves it is the former.
    [Fact]
    public async Task TenantScope_PooledConnectionReusedAcrossOrgs_DoesNotLeak()
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();

        var options = new DbContextOptionsBuilder<TenantWidgetDbContext>()
            .UseNpgsql(connection)
            .Options;

        // Borrow #1: org A's transaction runs on the connection.
        await using (var dbA = new TenantWidgetDbContext(options))
        {
            await using var scopeA = await TenantScope.BeginAsync(dbA, RlsFixture.OrgA);
            var rowsA = await dbA.Widgets.AsNoTracking().ToListAsync();
            await scopeA.CommitAsync();

            Assert.Equal(2, rowsA.Count);
            Assert.All(rowsA, w => Assert.Equal(RlsFixture.OrgA, w.OrganizationId));
        }
        // dbA is disposed here, but EF Core does NOT close/reset an externally
        // supplied DbConnection instance — `connection` stays open, exactly as a
        // transaction-pooler hands the same physical backend session to the next
        // logical request without resetting it.
        Assert.Equal(System.Data.ConnectionState.Open, connection.State);

        // Between borrows, on the very same connection: the GUC set via SET LOCAL
        // for org A must already be gone (released at COMMIT), not lingering for
        // whoever queries next.
        await using (var probeCmd = connection.CreateCommand())
        {
            probeCmd.CommandText = "SELECT current_setting('app.current_org_id', true)";
            var value = (string?)await probeCmd.ExecuteScalarAsync();
            Assert.True(string.IsNullOrEmpty(value), $"Expected GUC to be reset between borrows, got '{value}'.");
        }

        // ...AND the ROLE must have reverted too. Without this second probe the test has a
        // blind spot: a broken impl using session-level `SET ROLE app_tenant` (instead of
        // `SET LOCAL ROLE`) would still pass — org B re-sets its own GUC and reads only its
        // rows, so the GUC-only probe never notices the role leaking onto the next borrower.
        // Asserting current_user reverted to the login role ("postgres") on COMMIT is what
        // actually proves the role switch is transaction-scoped (SET LOCAL), not session-wide.
        await using (var roleProbe = connection.CreateCommand())
        {
            roleProbe.CommandText = "SELECT current_user";
            var role = (string?)await roleProbe.ExecuteScalarAsync();
            Assert.Equal("postgres", role);
        }

        // Borrow #2: org B's transaction runs on the exact same physical connection
        // org A just used — no close, no reset, no new pool entry.
        await using (var dbB = new TenantWidgetDbContext(options))
        {
            await using var scopeB = await TenantScope.BeginAsync(dbB, RlsFixture.OrgB);
            var rowsB = await dbB.Widgets.AsNoTracking().ToListAsync();
            await scopeB.CommitAsync();

            Assert.Equal(2, rowsB.Count);
            Assert.All(rowsB, w => Assert.Equal(RlsFixture.OrgB, w.OrganizationId));
            Assert.DoesNotContain(rowsB, w => w.Id == RlsFixture.WidgetA1 || w.Id == RlsFixture.WidgetA2);
        }
    }

    // ---- Bonus control: without the SET ROLE switch, the superuser connection
    // sees every row — proving the role switch (not the query) is what engages RLS.
    [Fact]
    public async Task WithoutTenantScope_SuperuserConnection_SeesAllRows()
    {
        await using var db = new TenantWidgetDbContext(RlsFixture.BuildOptions(fixture.ConnectionString));

        var rows = await db.Widgets.AsNoTracking().ToListAsync();

        Assert.Equal(4, rows.Count);
    }
}
