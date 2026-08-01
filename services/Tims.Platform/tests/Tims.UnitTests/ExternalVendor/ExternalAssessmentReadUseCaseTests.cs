using Tims.Application.Audit;
using Tims.Application.ExternalVendor;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Domain.ExternalVendor;

namespace Tims.UnitTests.ExternalVendor;

/// <summary>
/// Infra-free unit proofs of <see cref="ExternalAssessmentReadUseCase"/> orchestration over fakes: the
/// fail-CLOSED audit-before-return contract (INV-D), the completed-only NOT_FOUND surface (INV-A/G at the
/// use-case boundary), and the org-level scope no-op (INV-B). The real RLS/audit DB behavior is proven
/// separately in the Testcontainers integration suite.
/// </summary>
public sealed class ExternalAssessmentReadUseCaseTests
{
    private static readonly ExternalReadPrincipal Principal = new(
        OrganizationId: "11111111-1111-1111-1111-111111111111",
        ApiKeyId: "22222222-2222-2222-2222-222222222222",
        ResolvedScope: AccessScope.Organization,
        IpAddress: "203.0.113.7",
        UserAgent: "tims-tests");

    // ---- INV-D: list audits EVERY row fail-closed BEFORE mapping/returning ------------------------
    [Fact]
    public async Task ListAsync_audits_every_row_failClosed_then_maps()
    {
        var rows = new[] { Row("a1"), Row("a2"), Row("a3") };
        var repo = new FakeRepository(new ExternalResultPage(rows, "a3"));
        var auditor = new RecordingAuditor();
        var useCase = new ExternalAssessmentReadUseCase(repo, auditor);

        var result = await useCase.ListAsync(Principal, 3, cursor: null, CancellationToken.None);

        Assert.Equal(3, result.Items.Count);
        Assert.Equal("a3", result.NextCursor);
        // Every exported row audited exactly once, entity/action/actor/failClosed all correct.
        Assert.Equal(3, auditor.Events.Count);
        Assert.All(auditor.Events, e =>
        {
            Assert.Equal("assessmentResult", e.Event.Entity);
            Assert.Equal(AuditAction.Export, e.Event.Action);
            Assert.Equal(Principal.ApiKeyId, e.Event.ActorId);
            Assert.Equal(Principal.OrganizationId, e.Event.OrganizationId);
            Assert.True(e.FailClosed);
        });
        Assert.Equal(new[] { "a1", "a2", "a3" }, auditor.Events.Select(e => e.Event.RecordId));
    }

    // ---- INV-D BITE: a lost audit ABORTS the export — no unlogged data leaves ---------------------
    [Fact]
    public async Task ListAsync_audit_failure_aborts_before_returning_any_data()
    {
        var rows = new[] { Row("a1"), Row("a2"), Row("a3") };
        var repo = new FakeRepository(new ExternalResultPage(rows, "a3"));
        // Fail-closed audit throws on the FIRST row → the export must abort; rows 2/3 never audited.
        var auditor = new RecordingAuditor(throwOnCall: 1);
        var useCase = new ExternalAssessmentReadUseCase(repo, auditor);

        await Assert.ThrowsAsync<AuditWriteFailedException>(() =>
            useCase.ListAsync(Principal, 3, cursor: null, CancellationToken.None));

        // Only the first row was even attempted; the map/return statement is never reached.
        Assert.Single(auditor.Events);
    }

    // ---- INV-A/G: null row → NOT_FOUND with the Spanish parity message, no audit ------------------
    [Fact]
    public async Task GetOneAsync_missing_completed_row_throws_not_found_and_never_audits()
    {
        var repo = new FakeRepository(getOne: null);
        var auditor = new RecordingAuditor();
        var useCase = new ExternalAssessmentReadUseCase(repo, auditor);

        var ex = await Assert.ThrowsAsync<ExternalAssessmentNotFoundException>(() =>
            useCase.GetOneAsync(Principal, "a9", CancellationToken.None));

        Assert.Equal("Resultado de evaluacion no encontrado", ex.Message);
        Assert.Empty(auditor.Events); // no row → nothing exported → nothing audited
    }

    [Fact]
    public async Task GetOneAsync_audits_before_returning_the_v1()
    {
        var repo = new FakeRepository(getOne: Row("a1"));
        var auditor = new RecordingAuditor();
        var useCase = new ExternalAssessmentReadUseCase(repo, auditor);

        var v1 = await useCase.GetOneAsync(Principal, "a1", CancellationToken.None);

        Assert.Equal("v1", v1.SchemaVersion);
        Assert.Equal("a1", v1.AssignmentId);
        var audited = Assert.Single(auditor.Events);
        Assert.Equal("a1", audited.Event.RecordId);
        Assert.True(audited.FailClosed);
    }

    // ---- INV-D BITE (getOne): audit failure aborts before the v1 is returned ---------------------
    [Fact]
    public async Task GetOneAsync_audit_failure_aborts_before_returning_the_v1()
    {
        var repo = new FakeRepository(getOne: Row("a1"));
        var auditor = new RecordingAuditor(throwOnCall: 1);
        var useCase = new ExternalAssessmentReadUseCase(repo, auditor);

        await Assert.ThrowsAsync<AuditWriteFailedException>(() =>
            useCase.GetOneAsync(Principal, "a1", CancellationToken.None));
    }

    // ---- FIX 1 (INV-B) BITE: a NARROW resolved scope fails closed BEFORE any query runs -----------
    // The resolved scope is threaded from the permission decision onto the principal (no longer a
    // hardcoded Organization). A narrow scope (own/team/unit) has no anchor loader here, so
    // ScopeWhereFor fails closed and the use case throws — the repository is NEVER reached, so no
    // unscoped psychometric query can run. Reverting EnsureOrgLevelScopeAsync to a hardcoded
    // AccessScope.Organization makes this test go GREEN (guard dead) — proving it bites.
    [Theory]
    [InlineData(AccessScope.Own)]
    [InlineData(AccessScope.Team)]
    [InlineData(AccessScope.Unit)]
    public async Task ListAsync_narrow_resolved_scope_fails_closed_without_querying(AccessScope narrow)
    {
        var repo = new ThrowingRepository();
        var auditor = new RecordingAuditor();
        var useCase = new ExternalAssessmentReadUseCase(repo, auditor);

        await Assert.ThrowsAnyAsync<Exception>(() =>
            useCase.ListAsync(NarrowPrincipal(narrow), 25, cursor: null, CancellationToken.None));

        Assert.False(repo.WasQueried); // fail-closed BEFORE the query — nothing exported, nothing audited
        Assert.Empty(auditor.Events);
    }

    // ---- FIX 1 (INV-B): an ORGANIZATION resolved scope is the no-op {} → the read proceeds ---------
    [Fact]
    public async Task ListAsync_organization_resolved_scope_proceeds()
    {
        var repo = new FakeRepository(new ExternalResultPage(new[] { Row("a1") }, null));
        var auditor = new RecordingAuditor();
        var useCase = new ExternalAssessmentReadUseCase(repo, auditor);

        var result = await useCase.ListAsync(Principal, 25, cursor: null, CancellationToken.None);

        Assert.Single(result.Items);
        Assert.Single(auditor.Events);
    }

    private static ExternalReadPrincipal NarrowPrincipal(AccessScope scope) => new(
        OrganizationId: "11111111-1111-1111-1111-111111111111",
        ApiKeyId: "22222222-2222-2222-2222-222222222222",
        ResolvedScope: scope,
        IpAddress: null,
        UserAgent: null);

    private static ExternalResultRow Row(string assignmentId) => new(
        Id: assignmentId,
        AssignmentId: assignmentId,
        RawScore: 1,
        NormalizedScore: 2,
        Percentile: 3,
        Band: null,
        NormSampleSize: null,
        Interpretation: null,
        Breakdown: null,
        ModelVersion: "m",
        ScoredAt: DateTimeOffset.UnixEpoch,
        Assignment: new ExternalAssignmentContext(
            CandidateId: "c",
            VacancyId: "v",
            Status: "completed",
            AssignedAt: DateTimeOffset.UnixEpoch,
            StartedAt: null,
            CompletedAt: null,
            ExpiresAt: null,
            AssessmentTypeName: "t"));

    private sealed class FakeRepository(
        ExternalResultPage? list = null,
        ExternalResultRow? getOne = null) : IExternalAssessmentRepository
    {
        private readonly ExternalResultPage _list = list ?? new ExternalResultPage([], null);
        private readonly ExternalResultRow? _getOne = getOne;

        public Task<ExternalResultPage> ListAsync(string organizationId, int take, string? cursor, CancellationToken cancellationToken) =>
            Task.FromResult(_list);

        public Task<ExternalResultRow?> GetOneAsync(string organizationId, string assignmentId, CancellationToken cancellationToken) =>
            Task.FromResult(_getOne);
    }

    // A repository that must never be reached: any call means the scope guard did NOT fail closed.
    private sealed class ThrowingRepository : IExternalAssessmentRepository
    {
        public bool WasQueried { get; private set; }

        public Task<ExternalResultPage> ListAsync(string organizationId, int take, string? cursor, CancellationToken cancellationToken)
        {
            WasQueried = true;
            throw new InvalidOperationException("the repository must never be queried under a narrow scope");
        }

        public Task<ExternalResultRow?> GetOneAsync(string organizationId, string assignmentId, CancellationToken cancellationToken)
        {
            WasQueried = true;
            throw new InvalidOperationException("the repository must never be queried under a narrow scope");
        }
    }

    private sealed class RecordingAuditor(int? throwOnCall = null) : IDataAccessAuditor
    {
        public List<(DataAccessEvent Event, bool? FailClosed)> Events { get; } = [];

        private int _calls;

        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default)
        {
            _calls++;
            Events.Add((auditEvent, failClosed));
            if (throwOnCall is { } n && _calls == n)
            {
                throw new AuditWriteFailedException(new InvalidOperationException("injected audit failure"));
            }

            return Task.CompletedTask;
        }
    }
}
