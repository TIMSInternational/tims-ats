using Tims.Application.Audit;
using Tims.Application.Compensation;
using Tims.Domain.Audit;
using Tims.Domain.Compensation;

namespace Tims.UnitTests.Compensation;

/// <summary>
/// Deterministic (no-DB) unit proofs of the <see cref="CompensationWriteUseCase"/> orchestration: the
/// createAdjustment currency fallback (INV-7 input → subject comp → USD), the §21 minimal-result shape, and the
/// approveAdjustment ordering — load (null ⇒ NotFound, no audit, no mutation), FAIL-CLOSED audit BEFORE the
/// mutation (INV-4: auditor throws ⇒ the repo write never runs), and the outcome→status mapping. The real-RLS
/// TOCTOU / atomicity / probe / subject-scope bites live in the Testcontainers integration suite.
/// </summary>
public sealed class CompensationWriteUseCaseTests
{
    private const string Org = "11111111-1111-1111-1111-111111111111";
    private static readonly Guid Caller = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    private static readonly Guid Subject = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    private static readonly Guid AdjId = Guid.Parse("5ad00000-0000-0000-0000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    private static CreateAdjustmentCommand Create(string? currency) =>
        new(Subject, "merit", 80000, 90000, currency, "reason", Now);

    // ── INV-7: currency = normalizeCurrencyCode(input, subjectComp?.currency ?? 'USD') ──

    [Fact]
    public async Task Create_uses_valid_input_currency()
    {
        var repo = new FakeRepo { SubjectCurrency = "EUR" };
        var result = await new CompensationWriteUseCase(repo, new FakeAuditor())
            .CreateAdjustmentAsync(Org, Caller, Create("gbp"), Now, CancellationToken.None);

        Assert.Equal("GBP", repo.InsertedCurrency); // normalized (upper) input wins over the subject fallback
        Assert.Equal("pending", result.Status);
    }

    [Fact]
    public async Task Create_falls_back_to_subject_currency_when_input_absent()
    {
        var repo = new FakeRepo { SubjectCurrency = "EUR" };
        await new CompensationWriteUseCase(repo, new FakeAuditor())
            .CreateAdjustmentAsync(Org, Caller, Create(currency: null), Now, CancellationToken.None);

        Assert.Equal("EUR", repo.InsertedCurrency);
    }

    [Fact]
    public async Task Create_falls_back_to_USD_when_no_input_and_no_subject_comp()
    {
        var repo = new FakeRepo { SubjectCurrency = null };
        await new CompensationWriteUseCase(repo, new FakeAuditor())
            .CreateAdjustmentAsync(Org, Caller, Create(currency: null), Now, CancellationToken.None);

        Assert.Equal("USD", repo.InsertedCurrency);
    }

    [Fact]
    public async Task Create_falls_back_to_USD_when_input_invalid_and_no_subject_comp()
    {
        var repo = new FakeRepo { SubjectCurrency = null };
        await new CompensationWriteUseCase(repo, new FakeAuditor())
            .CreateAdjustmentAsync(Org, Caller, Create("ZZZ"), Now, CancellationToken.None); // not ISO-4217

        Assert.Equal("USD", repo.InsertedCurrency);
    }

    [Fact]
    public async Task Create_returns_only_id_and_pending_status()
    {
        var repo = new FakeRepo { InsertedId = "new-id" };
        var result = await new CompensationWriteUseCase(repo, new FakeAuditor())
            .CreateAdjustmentAsync(Org, Caller, Create("USD"), Now, CancellationToken.None);

        Assert.Equal("new-id", result.Id);
        Assert.Equal("pending", result.Status);
    }

    // ── approve: load-null ⇒ NotFound, WITHOUT auditing or mutating ──
    [Fact]
    public async Task Approve_missing_pending_is_NotFound_and_does_not_audit_or_mutate()
    {
        var repo = new FakeRepo { Pending = null };
        var auditor = new FakeAuditor();
        var result = await new CompensationWriteUseCase(repo, auditor)
            .ApproveAsync(Org, AdjId, Caller, Caller.ToString(), approved: true, null, null, Now, CancellationToken.None);

        Assert.Equal(ApproveOutcome.NotFound, result.Outcome);
        Assert.Null(result.Status);
        Assert.False(auditor.WasCalled);
        Assert.False(repo.ApproveCalled);
    }

    // ── INV-4: the fail-closed audit runs BEFORE the mutation — a throwing auditor blocks the write ──
    [Fact]
    public async Task Approve_failClosed_audit_throw_prevents_the_mutation()
    {
        var repo = new FakeRepo { Pending = new PendingAdjustmentRow(Subject, 90000, "USD") };
        var auditor = new FakeAuditor { Throw = true };

        await Assert.ThrowsAsync<AuditWriteFailedException>(() =>
            new CompensationWriteUseCase(repo, auditor).ApproveAsync(
                Org, AdjId, Caller, Caller.ToString(), approved: true, null, null, Now, CancellationToken.None));

        Assert.True(auditor.WasCalled);
        Assert.False(repo.ApproveCalled); // mutation never ran
    }

    [Fact]
    public async Task Approve_audits_salaryAdjustment_update_with_the_record_id_failClosed()
    {
        var repo = new FakeRepo { Pending = new PendingAdjustmentRow(Subject, 90000, "USD"), ApproveResult = ApproveOutcome.Applied };
        var auditor = new FakeAuditor();
        await new CompensationWriteUseCase(repo, auditor)
            .ApproveAsync(Org, AdjId, Caller, "actor-1", approved: true, "1.2.3.4", "agent", Now, CancellationToken.None);

        Assert.NotNull(auditor.Event);
        Assert.Equal("salaryAdjustment", auditor.Event!.Entity);
        Assert.Equal(AdjId.ToString(), auditor.Event.RecordId);
        Assert.Equal(AuditAction.Update, auditor.Event.Action);
        Assert.Equal("actor-1", auditor.Event.ActorId);
        Assert.True(auditor.FailClosed);
    }

    // ── outcome → status mapping + the applyCompensation flag ──
    [Theory]
    [InlineData(true, "approved")]
    [InlineData(false, "rejected")]
    public async Task Approve_applied_maps_status_and_passes_applyCompensation(bool approved, string expected)
    {
        var repo = new FakeRepo { Pending = new PendingAdjustmentRow(Subject, 90000, "USD"), ApproveResult = ApproveOutcome.Applied };
        var result = await new CompensationWriteUseCase(repo, new FakeAuditor())
            .ApproveAsync(Org, AdjId, Caller, Caller.ToString(), approved, null, null, Now, CancellationToken.None);

        Assert.Equal(ApproveOutcome.Applied, result.Outcome);
        Assert.Equal(expected, result.Status);
        Assert.Equal(approved, repo.ApplyCompensation); // only an approval propagates to employee_compensations
        Assert.Equal(expected, repo.NewStatus);
    }

    [Fact]
    public async Task Approve_conflict_has_null_status()
    {
        var repo = new FakeRepo { Pending = new PendingAdjustmentRow(Subject, 90000, "USD"), ApproveResult = ApproveOutcome.Conflict };
        var result = await new CompensationWriteUseCase(repo, new FakeAuditor())
            .ApproveAsync(Org, AdjId, Caller, Caller.ToString(), approved: true, null, null, Now, CancellationToken.None);

        Assert.Equal(ApproveOutcome.Conflict, result.Outcome);
        Assert.Null(result.Status); // no status is claimed when the race was lost
    }

    private sealed class FakeRepo : ICompensationWriteRepository
    {
        public string? SubjectCurrency { get; init; }
        public string InsertedId { get; init; } = "id";
        public PendingAdjustmentRow? Pending { get; init; }
        public ApproveOutcome ApproveResult { get; init; } = ApproveOutcome.Applied;

        public string? InsertedCurrency { get; private set; }
        public bool ApproveCalled { get; private set; }
        public bool ApplyCompensation { get; private set; }
        public string? NewStatus { get; private set; }

        public Task<string?> GetSubjectCompensationCurrencyAsync(string organizationId, Guid subjectUserId, CancellationToken cancellationToken) =>
            Task.FromResult(SubjectCurrency);

        public Task<string> InsertAdjustmentAsync(
            string organizationId, Guid callerId, CreateAdjustmentCommand command, string currency, DateTimeOffset now, CancellationToken cancellationToken)
        {
            InsertedCurrency = currency;
            return Task.FromResult(InsertedId);
        }

        public Task<PendingAdjustmentRow?> LoadPendingAdjustmentAsync(string organizationId, Guid adjustmentId, CancellationToken cancellationToken) =>
            Task.FromResult(Pending);

        public Task<ApproveOutcome> ApproveAsync(
            string organizationId, Guid adjustmentId, Guid callerId, string newStatus, bool applyCompensation,
            Guid subjectUserId, double newSalary, string currency, DateTimeOffset now, CancellationToken cancellationToken)
        {
            ApproveCalled = true;
            ApplyCompensation = applyCompensation;
            NewStatus = newStatus;
            return Task.FromResult(ApproveResult);
        }
    }

    private sealed class FakeAuditor : IDataAccessAuditor
    {
        public bool Throw { get; init; }
        public bool WasCalled { get; private set; }
        public DataAccessEvent? Event { get; private set; }
        public bool? FailClosed { get; private set; }

        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default)
        {
            WasCalled = true;
            Event = auditEvent;
            FailClosed = failClosed;
            if (Throw)
            {
                throw new AuditWriteFailedException(new InvalidOperationException("audit down"));
            }

            return Task.CompletedTask;
        }
    }
}
