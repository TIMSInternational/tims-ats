using Microsoft.EntityFrameworkCore;
using Tims.Application.Audit;
using Tims.Domain.Audit;
using Tims.Domain.Identity;
using Tims.Infrastructure;
using Tims.Infrastructure.Audit;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.7 Testcontainers proof of the single data_access_log writer (<see cref="DataAccessAuditWriter"/>):
/// the happy-path append lands under tenant RLS, and the REQUIRED historical-fix regression tests each
/// BITE — fail-closed vs fail-soft by data class, the throw-before-return ordering, and impersonation
/// attribution to the real owner. Every write runs UNDER <see cref="TenantScope"/> (app_tenant + org GUC).
/// </summary>
[Collection("AuditWriter")]
public sealed class DataAccessAuditWriterTests(AuditWriterFixture fixture)
{
    private static DataAccessEvent RestrictedEvent(Guid org, Guid actor, Guid recordId, string entity = "employeeCompensation") =>
        new(org.ToString(), actor.ToString(), entity, recordId.ToString(), AuditAction.Read);

    // ---- Success: a row lands with the correct org/actor/dataType/action --------------------------
    [Fact]
    public async Task LogAsync_writes_the_row_under_tenant_rls()
    {
        var actor = Guid.NewGuid();
        var recordId = Guid.NewGuid();
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var writer = new DataAccessAuditWriter(db);

        await writer.LogAsync(new DataAccessEvent(
            AuditWriterFixture.OrgA.ToString(),
            actor.ToString(),
            "employeeCompensation",
            recordId.ToString(),
            AuditAction.Export,
            IpAddress: "203.0.113.7",
            UserAgent: "tims-tests"));

        var row = await fixture.ReadRowAsync(recordId);
        Assert.NotNull(row);
        Assert.Equal(AuditWriterFixture.OrgA, row!.OrganizationId);
        Assert.Equal(actor, row.ActorId);
        Assert.Equal("employeeCompensation", row.DataType);
        Assert.Equal("export", row.Action); // enum → lowercase wire string
    }

    // ---- REGRESSION: audit-fail-closed-restricted -------------------------------------------------
    // A restricted-entity write failure THROWS (fail-closed); a confidential-entity failure (and an
    // explicit failClosed:false on a restricted entity) does NOT throw (fail-soft). Both branches proven.
    [Fact]
    public async Task AuditFailClosedRestricted_restricted_write_failure_throws()
    {
        await using var db = fixture.NewContext(fixture.MissingTableConnectionString); // no table → INSERT fails
        var writer = new DataAccessAuditWriter(db);

        var ex = await Assert.ThrowsAsync<AuditWriteFailedException>(() =>
            writer.LogAsync(RestrictedEvent(AuditWriterFixture.OrgA, Guid.NewGuid(), Guid.NewGuid())));

        Assert.Equal(AuditWriteFailedException.RestrictedMessage, ex.Message);
        Assert.NotNull(ex.InnerException); // the underlying write failure is preserved as the TS `cause`
    }

    [Fact]
    public async Task AuditFailClosedRestricted_confidential_write_failure_does_not_throw()
    {
        await using var db = fixture.NewContext(fixture.MissingTableConnectionString);
        var writer = new DataAccessAuditWriter(db);

        // employeeDemographics is confidential → fail-SOFT: the write fails but LogAsync completes.
        await writer.LogAsync(new DataAccessEvent(
            AuditWriterFixture.OrgA.ToString(),
            Guid.NewGuid().ToString(),
            "employeeDemographics",
            Guid.NewGuid().ToString(),
            AuditAction.Read));
    }

    [Fact]
    public async Task AuditFailClosedRestricted_explicit_failClosed_false_overrides_restricted_to_soft()
    {
        await using var db = fixture.NewContext(fixture.MissingTableConnectionString);
        var writer = new DataAccessAuditWriter(db);

        // Restricted HEADLINE entity, but the caller received only confidential fields → failClosed:false
        // forces fail-SOFT even though the write fails (the assessmentResult bulk-read case).
        await writer.LogAsync(
            RestrictedEvent(AuditWriterFixture.OrgA, Guid.NewGuid(), Guid.NewGuid(), "assessmentResult"),
            failClosed: false);
    }

    // ---- REGRESSION: audit-before-return ----------------------------------------------------------
    // The throw is observable BEFORE the caller returns data: model an audit-then-return caller and
    // assert it never reaches its return statement when the restricted audit write fails.
    [Fact]
    public async Task AuditBeforeReturn_throw_lands_before_the_caller_returns_data()
    {
        await using var db = fixture.NewContext(fixture.MissingTableConnectionString);
        var writer = new DataAccessAuditWriter(db);
        var reachedReturn = false;

        async Task<string> ReadRestrictedThenReturn()
        {
            // Caller contract: audit FIRST (await), only THEN serialize/return the restricted data.
            await writer.LogAsync(RestrictedEvent(AuditWriterFixture.OrgA, Guid.NewGuid(), Guid.NewGuid()));
            reachedReturn = true;
            return "restricted-salary-payload";
        }

        await Assert.ThrowsAsync<AuditWriteFailedException>(ReadRestrictedThenReturn);
        Assert.False(reachedReturn, "the restricted data must never be reached when the audit write fails");
    }

    // ---- REGRESSION: audit-impersonation-attribution ----------------------------------------------
    // An impersonated TenantContext → the written row's actor_id == ImpersonatedBy (the real owner),
    // never the impersonated target's UserId. Uses AuditActor.ActorFor to build the event, as callers do.
    [Fact]
    public async Task AuditImpersonationAttribution_row_actor_is_the_real_owner()
    {
        var impersonated = new TenantContext(
            PrincipalType.OrgUser,
            OrganizationId: AuditWriterFixture.OrgA.ToString(),
            UserId: AuditWriterFixture.Target.ToString(),
            Roles: [],
            ImpersonatedBy: AuditWriterFixture.RealOwner.ToString());

        var recordId = Guid.NewGuid();
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var writer = new DataAccessAuditWriter(db);

        await writer.LogAsync(new DataAccessEvent(
            impersonated.OrganizationId,
            AuditActor.ActorFor(impersonated), // real owner, not the target
            "employeeCompensation",
            recordId.ToString(),
            AuditAction.Read));

        var row = await fixture.ReadRowAsync(recordId);
        Assert.NotNull(row);
        Assert.Equal(AuditWriterFixture.RealOwner, row!.ActorId);
        Assert.NotEqual(AuditWriterFixture.Target, row.ActorId);
    }

    // ---- RLS: WITH CHECK passes for the caller's org; a mismatched org GUC is rejected ------------
    [Fact]
    public async Task Rls_write_under_matching_org_guc_lands()
    {
        var recordId = Guid.NewGuid();
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var writer = new DataAccessAuditWriter(db);

        // Writer derives the GUC from the event's org → OrgA GUC, OrgA row → WITH CHECK passes.
        await writer.LogAsync(RestrictedEvent(AuditWriterFixture.OrgA, Guid.NewGuid(), recordId));

        Assert.Equal(1, await fixture.CountRowsAsync(recordId));
    }

    [Fact]
    public async Task Rls_write_with_mismatched_org_guc_is_rejected()
    {
        // Begin the tenant scope for OrgB but attempt to INSERT an OrgA row: RLS WITH CHECK must reject
        // it. Exercised directly against the context + TenantScope (the writer never mismatches, since it
        // derives the GUC from the row's org — this proves the DB-level guard behind that invariant).
        var recordId = Guid.NewGuid();
        await using var db = fixture.NewContext(fixture.ConnectionString);
        await using var scope = await TenantScope.BeginAsync(db, AuditWriterFixture.OrgB);

        db.DataAccessLogs.Add(new DataAccessLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = AuditWriterFixture.OrgA, // mismatched vs the OrgB GUC
            ActorId = Guid.NewGuid(),
            DataType = "employeeCompensation",
            RecordId = recordId,
            Action = "read",
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(0, await fixture.CountRowsAsync(recordId));
    }
}
