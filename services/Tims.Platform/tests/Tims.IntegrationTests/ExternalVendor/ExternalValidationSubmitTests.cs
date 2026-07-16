using System.Text.Json.Nodes;
using Npgsql;
using Tims.Application.ExternalVendor;
using Tims.Domain.ExternalVendor;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.ExternalVendor;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// Phase-5 Slice 2 Testcontainers proof (real RLS + the REAL CHECK, NEVER mocked) of the external-vendor
/// validation WRITE: (INV-4) the atomic pending-only guard flips only a pending row and CONFLICTs on any
/// other; (INV-5) vendor provenance (completed_by_api_key_id set, completed_by_id null) satisfying the
/// DB CHECK; (INV-3/7) cross-org id → NOT_FOUND; the CHECK itself bites a both-completers write; (INV-6)
/// the fail-SOFT audit lands exactly one row AND a forced audit failure does NOT roll back the committed
/// write. Every read/write runs UNDER TenantScope (app_tenant + org GUC).
/// </summary>
[Collection("ExternalValidation")]
public sealed class ExternalValidationSubmitTests(ExternalValidationFixture fixture)
{
    private ExternalValidationSubmitPrincipal PrincipalA(string apiKeyId) =>
        new(ExternalValidationFixture.OrgA.ToString(), apiKeyId, "203.0.113.7", "tims-tests");

    private static ExternalValidationSubmitCommand Command(string status = "passed", string? notes = null) =>
        ExternalValidationSubmitCommand.Create(status, new JsonObject { ["cleared"] = true }, notes);

    // Real repo + real audit writer, wired exactly as Program.cs does. auditToMissingDb points the auditor
    // at a DB WITHOUT data_access_logs so its INSERT fails (the fail-soft no-rollback proof). An optional
    // TimeProvider drives the FIX-3 ms-truncation proof with a deterministic sub-ms instant.
    private ExternalValidationSubmitUseCase UseCase(bool auditToMissingDb = false, TimeProvider? timeProvider = null)
    {
        var repo = new ExternalValidationRepository(fixture.NewValidationContext());
        var auditor = new DataAccessAuditWriter(fixture.NewAuditContext(
            auditToMissingDb ? fixture.MissingAuditConnectionString : null));
        return new ExternalValidationSubmitUseCase(repo, auditor, timeProvider);
    }

    /// <summary>A fixed clock carrying sub-millisecond ticks, for the FIX-3 ms-truncation proof.</summary>
    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    // ---- happy path: pending → 200 v1; status flips; provenance set; CHECK satisfied --------------
    [Fact]
    public async Task Submit_pending_flips_status_and_sets_vendor_provenance()
    {
        var actor = ExternalValidationFixture.ValidScopedKeyId;

        var v1 = await UseCase().SubmitAsync(
            PrincipalA(actor.ToString()), ExternalValidationFixture.ValidationProvenance.ToString(),
            Command("passed", notes: "cleared by vendor"), CancellationToken.None);

        Assert.Equal("v1", v1.SchemaVersion);
        Assert.Equal(ExternalValidationFixture.ValidationProvenance.ToString(), v1.Id);
        Assert.Equal("passed", v1.Status);

        var row = await fixture.GetValidationAsync(ExternalValidationFixture.ValidationProvenance);
        Assert.NotNull(row);
        Assert.Equal("passed", row!.Status);
        Assert.Equal(actor, row.CompletedByApiKeyId); // vendor provenance set
        Assert.Null(row.CompletedById); // never a staff completer → the CHECK is satisfied
        Assert.NotNull(row.CompletedAt);
        Assert.NotNull(row.Result); // the jsonb result was written
        Assert.Equal("cleared by vendor", row.Notes);

        // FIX 4: the result is stored as a QUERYABLE jsonb OBJECT — `result->>'cleared'` yields the field.
        // A double-encoded JSON string (or a text column) would make this null → this bites such a regression.
        Assert.Equal("true", await fixture.GetValidationResultFieldAsync(ExternalValidationFixture.ValidationProvenance, "cleared"));
    }

    // ---- FIX 3: the persisted completed_at (timestamp(3)) EQUALS the returned v1 completedAt (ms) --------
    // Feed a clock with sub-millisecond ticks: the use case truncates to whole ms ONCE at the source, so the
    // DB write (which timestamp(3) would otherwise ROUND) and the returned v1 agree to the millisecond — the
    // JS `new Date()` precision. Without the truncation the returned value keeps sub-ms ticks while the
    // column rounds, so the two diverge (the bite).
    [Fact]
    public async Task Persisted_completedAt_equals_returned_completedAt_at_millisecond_precision()
    {
        // 12:34:56.789 + 4567 ticks (0.4567 ms) — a deterministic sub-millisecond instant.
        var subMs = new DateTimeOffset(2026, 7, 16, 12, 34, 56, 789, TimeSpan.Zero).AddTicks(4567);
        Assert.NotEqual(0, subMs.Ticks % TimeSpan.TicksPerMillisecond); // guard: the instant really has sub-ms ticks

        var v1 = await UseCase(timeProvider: new FixedTimeProvider(subMs)).SubmitAsync(
            PrincipalA(ExternalValidationFixture.ValidScopedKeyId.ToString()),
            ExternalValidationFixture.ValidationClock.ToString(), Command("passed"), CancellationToken.None);

        var row = await fixture.GetValidationAsync(ExternalValidationFixture.ValidationClock);

        // DateTime.Equals compares ticks (ignores Kind): persisted (Unspecified, whole ms) == returned (Utc).
        Assert.Equal(v1.CompletedAt.UtcDateTime, row!.CompletedAt);
        Assert.Equal(0, v1.CompletedAt.Ticks % TimeSpan.TicksPerMillisecond); // returned is whole-ms too
    }

    // ---- INV-4 BITE: a NON-pending row → count 0 → CONFLICT (the pending-only guard) ---------------
    [Fact]
    public async Task Submit_on_non_pending_row_is_conflict()
    {
        await Assert.ThrowsAsync<ExternalValidationConflictException>(() =>
            UseCase().SubmitAsync(
                PrincipalA(Guid.NewGuid().ToString()), ExternalValidationFixture.ValidationAlreadyPassed.ToString(),
                Command(), CancellationToken.None));
    }

    // ---- double-submit: first flips it, the second (now non-pending) → CONFLICT -------------------
    [Fact]
    public async Task Double_submit_second_is_conflict()
    {
        var id = ExternalValidationFixture.ValidationDouble.ToString();
        var actor = ExternalValidationFixture.ActorDoubleKeyId.ToString(); // FIX 6: real key (FK-valid provenance)

        var first = await UseCase().SubmitAsync(PrincipalA(actor), id, Command("failed"), CancellationToken.None);
        Assert.Equal("failed", first.Status);

        // The second submit conflicts before any write, so a random (unseeded) actor never reaches the FK.
        await Assert.ThrowsAsync<ExternalValidationConflictException>(() =>
            UseCase().SubmitAsync(PrincipalA(Guid.NewGuid().ToString()), id, Command("passed"), CancellationToken.None));

        // The row keeps the FIRST result — the second write matched 0 rows and changed nothing.
        var row = await fixture.GetValidationAsync(ExternalValidationFixture.ValidationDouble);
        Assert.Equal("failed", row!.Status);
    }

    // ---- INV-3/7 BITE: a cross-org id is invisible under RLS → NOT_FOUND (IDOR-safe) ---------------
    [Fact]
    public async Task Cross_org_id_is_not_found()
    {
        await Assert.ThrowsAsync<ExternalValidationNotFoundException>(() =>
            UseCase().SubmitAsync(
                PrincipalA(Guid.NewGuid().ToString()), ExternalValidationFixture.ValidationOrgB.ToString(),
                Command(), CancellationToken.None));

        // The OrgB row is untouched.
        var row = await fixture.GetValidationAsync(ExternalValidationFixture.ValidationOrgB);
        Assert.Equal("pending", row!.Status);
    }

    // ---- an unknown id → NOT_FOUND ----------------------------------------------------------------
    [Fact]
    public async Task Unknown_id_is_not_found()
    {
        await Assert.ThrowsAsync<ExternalValidationNotFoundException>(() =>
            UseCase().SubmitAsync(
                PrincipalA(Guid.NewGuid().ToString()), Guid.NewGuid().ToString(), Command(), CancellationToken.None));
    }

    // ---- the REAL CHECK bites: setting BOTH completers is rejected by the DB (INV-5) ---------------
    [Fact]
    public async Task DB_check_rejects_setting_both_completers()
    {
        await using var connection = await fixture.OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT INTO preemployment_validations (id, organization_id, offer_id, type, status, completed_by_id, completed_by_api_key_id)
            VALUES (@id, @org, @offer, 'background_check', 'passed', @staff, @apikey)
            """;
        command.Parameters.AddWithValue("id", Guid.NewGuid());
        command.Parameters.AddWithValue("org", ExternalValidationFixture.OrgA);
        command.Parameters.AddWithValue("offer", Guid.NewGuid());
        command.Parameters.AddWithValue("staff", Guid.NewGuid());
        command.Parameters.AddWithValue("apikey", Guid.NewGuid());

        var ex = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.CheckViolation, ex.SqlState);
        Assert.Contains("single_completer_chk", ex.ConstraintName ?? ex.Message);
    }

    // ---- INV-6: the fail-SOFT audit lands exactly one data_access_logs row per submission ----------
    [Fact]
    public async Task Successful_submit_writes_one_vendor_update_audit_row()
    {
        var actor = ExternalValidationFixture.ActorAuditKeyId; // FIX 6: real key; distinct actor isolates the count

        await UseCase().SubmitAsync(
            PrincipalA(actor.ToString()), ExternalValidationFixture.ValidationAudit.ToString(),
            Command(), CancellationToken.None);

        Assert.Equal(1, await fixture.CountVendorUpdateAuditRowsAsync(actor));
    }

    // ---- INV-6 BITE: a forced audit failure does NOT roll back the committed write -----------------
    // The auditor points at a DB with no data_access_logs → its INSERT fails, but fail-SOFT swallows it,
    // so the submission still returns AND the row stays flipped. (A fail-CLOSED audit would have thrown.)
    [Fact]
    public async Task Forced_audit_failure_does_not_roll_back_the_committed_write()
    {
        var actor = ExternalValidationFixture.ActorFailSoftKeyId; // FIX 6: real key (FK-valid provenance)

        var v1 = await UseCase(auditToMissingDb: true).SubmitAsync(
            PrincipalA(actor.ToString()), ExternalValidationFixture.ValidationFailSoft.ToString(),
            Command("passed"), CancellationToken.None);

        Assert.Equal("passed", v1.Status); // returned despite the audit failure

        var row = await fixture.GetValidationAsync(ExternalValidationFixture.ValidationFailSoft);
        Assert.Equal("passed", row!.Status); // the write COMMITTED — not rolled back
        Assert.NotNull(row.CompletedByApiKeyId);

        // And no audit row landed (the INSERT hit the table-less DB).
        Assert.Equal(0, await fixture.CountVendorUpdateAuditRowsAsync(actor));
    }
}
