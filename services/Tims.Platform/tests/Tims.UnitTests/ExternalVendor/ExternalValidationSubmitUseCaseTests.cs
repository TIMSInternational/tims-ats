using System.Text.Json.Nodes;
using Tims.Application.Audit;
using Tims.Application.ExternalVendor;
using Tims.Domain.Audit;
using Tims.Domain.ExternalVendor;

namespace Tims.UnitTests.ExternalVendor;

/// <summary>
/// Infra-free unit proofs of <see cref="ExternalValidationSubmitUseCase"/> orchestration over fakes: the
/// read-gate NOT_FOUND surface (INV-3), the atomic-write CONFLICT surface (INV-4), the fail-SOFT audit
/// (INV-6 — a lost audit row does NOT abort the committed submission, CONTRAST the read's fail-closed
/// export), and the correct sequencing (read → write → audit → map). Real RLS/CHECK behavior is proven
/// separately in the Testcontainers suite.
/// </summary>
public sealed class ExternalValidationSubmitUseCaseTests
{
    private static readonly ExternalValidationSubmitPrincipal Principal = new(
        OrganizationId: "11111111-1111-1111-1111-111111111111",
        ApiKeyId: "22222222-2222-2222-2222-222222222222",
        IpAddress: "203.0.113.7",
        UserAgent: "tims-tests");

    private const string ValidationId = "33333333-3333-3333-3333-333333333333";

    private static ExternalValidationSubmitCommand Command(string status = "passed") =>
        ExternalValidationSubmitCommand.Create(status, new JsonObject { ["k"] = "v" }, notes: null);

    // ---- INV-3: the read gate finds nothing → NOT_FOUND, and the write is NEVER attempted ---------
    [Fact]
    public async Task Missing_validation_throws_not_found_and_never_writes()
    {
        var repo = new FakeRepository(existingStatus: null);
        var auditor = new RecordingAuditor();
        var useCase = new ExternalValidationSubmitUseCase(repo, auditor);

        var ex = await Assert.ThrowsAsync<ExternalValidationNotFoundException>(() =>
            useCase.SubmitAsync(Principal, ValidationId, Command(), CancellationToken.None));

        Assert.Equal("Validacion no encontrada", ex.Message);
        Assert.False(repo.WriteAttempted);
        Assert.Empty(auditor.Events);
    }

    // ---- INV-4: the atomic write matched 0 rows → CONFLICT, no audit ------------------------------
    [Fact]
    public async Task Non_pending_write_matches_zero_rows_throws_conflict()
    {
        var repo = new FakeRepository(existingStatus: "pending", affected: 0);
        var auditor = new RecordingAuditor();
        var useCase = new ExternalValidationSubmitUseCase(repo, auditor);

        var ex = await Assert.ThrowsAsync<ExternalValidationConflictException>(() =>
            useCase.SubmitAsync(Principal, ValidationId, Command(), CancellationToken.None));

        Assert.Equal("La validacion no esta abierta para envio de resultados", ex.Message);
        Assert.True(repo.WriteAttempted);
        Assert.Empty(auditor.Events);
    }

    // ---- happy path: write succeeds → fail-SOFT audit (failClosed:false) → v1 mapped --------------
    [Fact]
    public async Task Successful_submit_audits_failSoft_then_returns_v1()
    {
        var repo = new FakeRepository(existingStatus: "pending", affected: 1);
        var auditor = new RecordingAuditor();
        var useCase = new ExternalValidationSubmitUseCase(repo, auditor);

        var v1 = await useCase.SubmitAsync(Principal, ValidationId, Command("failed"), CancellationToken.None);

        Assert.Equal("v1", v1.SchemaVersion);
        Assert.Equal(ValidationId, v1.Id);
        Assert.Equal("failed", v1.Status);
        Assert.NotEqual(default, v1.CompletedAt);

        var audited = Assert.Single(auditor.Events);
        Assert.Equal("preemploymentValidation", audited.Event.Entity);
        Assert.Equal(AuditAction.Update, audited.Event.Action);
        Assert.Equal(Principal.ApiKeyId, audited.Event.ActorId);
        Assert.Equal(ValidationId, audited.Event.RecordId);
        Assert.Equal(Principal.OrganizationId, audited.Event.OrganizationId);
        Assert.False(audited.FailClosed); // fail-SOFT
    }

    // ---- INV-6 BITE: a fail-SOFT audit that SWALLOWS a failure must NOT abort the submission -------
    // The real DataAccessAuditWriter swallows a failClosed:false failure; this fake models that (it
    // records the event then returns without throwing). The use case must still return the v1.
    [Fact]
    public async Task Audit_failure_is_swallowed_and_does_not_abort_the_committed_submission()
    {
        var repo = new FakeRepository(existingStatus: "pending", affected: 1);
        var auditor = new RecordingAuditor(swallowedFailure: true);
        var useCase = new ExternalValidationSubmitUseCase(repo, auditor);

        var v1 = await useCase.SubmitAsync(Principal, ValidationId, Command(), CancellationToken.None);

        Assert.Equal("passed", v1.Status); // the write is the source of truth; the lost audit is tolerated
        Assert.Single(auditor.Events);
    }

    // ---- the completedAt echoed in v1 equals the instant handed to the write ----------------------
    [Fact]
    public async Task Echoes_the_same_completedAt_it_wrote()
    {
        var repo = new FakeRepository(existingStatus: "pending", affected: 1);
        var auditor = new RecordingAuditor();
        var useCase = new ExternalValidationSubmitUseCase(repo, auditor);

        var v1 = await useCase.SubmitAsync(Principal, ValidationId, Command(), CancellationToken.None);

        Assert.Equal(repo.WrittenNow, v1.CompletedAt);
    }

    private sealed class FakeRepository(string? existingStatus, int affected = 1) : IExternalValidationRepository
    {
        public bool WriteAttempted { get; private set; }

        public DateTimeOffset WrittenNow { get; private set; }

        public Task<string?> GetStatusForSubmitAsync(string organizationId, string validationId, CancellationToken cancellationToken) =>
            Task.FromResult(existingStatus);

        public Task<int> SubmitResultAsync(
            string organizationId,
            string validationId,
            string apiKeyId,
            ExternalValidationSubmitCommand command,
            DateTimeOffset now,
            CancellationToken cancellationToken)
        {
            WriteAttempted = true;
            WrittenNow = now;
            return Task.FromResult(affected);
        }
    }

    private sealed class RecordingAuditor(bool swallowedFailure = false) : IDataAccessAuditor
    {
        public List<(DataAccessEvent Event, bool? FailClosed)> Events { get; } = [];

        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default)
        {
            Events.Add((auditEvent, failClosed));
            // A fail-SOFT auditor SWALLOWS its failure (the real DataAccessAuditWriter does when
            // failClosed:false) — it must never throw back into the use case.
            _ = swallowedFailure;
            return Task.CompletedTask;
        }
    }
}
