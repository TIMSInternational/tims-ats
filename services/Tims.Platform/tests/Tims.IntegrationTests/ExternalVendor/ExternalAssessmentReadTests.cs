using Tims.Application.Audit;
using Tims.Application.ExternalVendor;
using Tims.Domain.Access;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.ExternalVendor;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// Phase-5 Slice 1 Testcontainers proof (real RLS, NEVER mocked) of the external-vendor assessment READ
/// surface: (INV-A) completed-only gate incl. the by-id non-completed → NOT_FOUND leak-fix bite; (INV-E)
/// cross-org isolation; (INV-F) cursor pagination boundary incl. the scoredAt-tie assignmentId tiebreak;
/// (INV-D) fail-closed audit lands exactly one data_access_logs row per exported result AND an injected
/// audit failure ABORTS the export. Every read runs UNDER TenantScope (app_tenant + org GUC).
/// </summary>
[Collection("ExternalAssessment")]
public sealed class ExternalAssessmentReadTests(ExternalAssessmentFixture fixture)
{
    private static readonly string ApiKeyA = "aa000000-0000-0000-0000-0000000000aa";

    private ExternalReadPrincipal PrincipalA(string? apiKeyId = null) =>
        new(ExternalAssessmentFixture.OrgA.ToString(), apiKeyId ?? ApiKeyA, AccessScope.Organization, "203.0.113.7", "tims-tests");

    // Real repo + a real (or missing-table) audit writer, wired exactly as Program.cs does.
    private ExternalAssessmentReadUseCase UseCase(bool auditToMissingDb = false)
    {
        var repo = new ExternalAssessmentRepository(fixture.NewReadContext());
        var auditor = new DataAccessAuditWriter(fixture.NewAuditContext(
            auditToMissingDb ? fixture.MissingAuditConnectionString : null));
        return new ExternalAssessmentReadUseCase(repo, auditor);
    }

    // ---- INV-A + INV-E: list exposes only COMPLETED, same-org results ----------------------------
    [Fact]
    public async Task ListAsync_returns_only_completed_same_org_results()
    {
        var result = await UseCase().ListAsync(PrincipalA(Guid.NewGuid().ToString()), 25, null, CancellationToken.None);

        var ids = result.Items.Select(i => i.AssignmentId).ToHashSet();
        Assert.Equal(4, result.Items.Count);
        Assert.Contains(ExternalAssessmentFixture.AssignmentA1.ToString(), ids);
        Assert.Contains(ExternalAssessmentFixture.AssignmentA4.ToString(), ids);
        Assert.DoesNotContain(ExternalAssessmentFixture.AssignmentAInProgress.ToString(), ids); // INV-A
        Assert.DoesNotContain(ExternalAssessmentFixture.AssignmentB1.ToString(), ids); // INV-E
        Assert.All(result.Items, i => Assert.Equal("completed", i.Status));
    }

    // ---- INV-A leak-fix BITE: a scored result on a NON-completed assignment → NOT_FOUND -----------
    [Fact]
    public async Task GetOneAsync_scored_result_on_non_completed_assignment_is_not_found()
    {
        await Assert.ThrowsAsync<ExternalAssessmentNotFoundException>(() =>
            UseCase().GetOneAsync(PrincipalA(Guid.NewGuid().ToString()),
                ExternalAssessmentFixture.AssignmentAInProgress.ToString(), CancellationToken.None));
    }

    [Fact]
    public async Task GetOneAsync_completed_same_org_row_returns_v1()
    {
        var v1 = await UseCase().GetOneAsync(PrincipalA(Guid.NewGuid().ToString()),
            ExternalAssessmentFixture.AssignmentA1.ToString(), CancellationToken.None);

        Assert.Equal("v1", v1.SchemaVersion);
        Assert.Equal(ExternalAssessmentFixture.AssignmentA1.ToString(), v1.AssignmentId);
        Assert.Equal("completed", v1.Status);
        Assert.Equal("Cognitive Aptitude", v1.AssessmentType);
        Assert.Equal(10, v1.RawScore); // the restricted raw field IS exposed to external (ceiling)
        Assert.NotNull(v1.Breakdown); // opaque jsonb carried through
    }

    // ---- INV-E: cross-org id → NOT_FOUND (IDOR-safe) ----------------------------------------------
    [Fact]
    public async Task GetOneAsync_cross_org_id_is_not_found()
    {
        await Assert.ThrowsAsync<ExternalAssessmentNotFoundException>(() =>
            UseCase().GetOneAsync(PrincipalA(Guid.NewGuid().ToString()),
                ExternalAssessmentFixture.AssignmentB1.ToString(), CancellationToken.None));
    }

    [Fact]
    public async Task ListAsync_other_org_sees_only_its_own_row()
    {
        var principalB = new ExternalReadPrincipal(
            ExternalAssessmentFixture.OrgB.ToString(), Guid.NewGuid().ToString(), AccessScope.Organization, null, null);

        var result = await UseCase().ListAsync(principalB, 25, null, CancellationToken.None);

        var item = Assert.Single(result.Items);
        Assert.Equal(ExternalAssessmentFixture.AssignmentB1.ToString(), item.AssignmentId);
    }

    // ---- INV-F: cursor pagination boundary (scoredAt desc, assignmentId asc tiebreak) -------------
    [Fact]
    public async Task ListAsync_cursor_pagination_walks_the_ordered_boundary()
    {
        var actor = Guid.NewGuid().ToString();

        var page1 = await UseCase().ListAsync(PrincipalA(actor), 2, null, CancellationToken.None);
        Assert.Equal(
            new[] { ExternalAssessmentFixture.AssignmentA3.ToString(), ExternalAssessmentFixture.AssignmentA4.ToString() },
            page1.Items.Select(i => i.AssignmentId).ToArray());
        Assert.Equal(ExternalAssessmentFixture.AssignmentA4.ToString(), page1.NextCursor);

        var page2 = await UseCase().ListAsync(PrincipalA(actor), 2, page1.NextCursor, CancellationToken.None);
        Assert.Equal(
            new[] { ExternalAssessmentFixture.AssignmentA2.ToString(), ExternalAssessmentFixture.AssignmentA1.ToString() },
            page2.Items.Select(i => i.AssignmentId).ToArray());
        Assert.Null(page2.NextCursor); // last page
    }

    // ---- INV-D: fail-closed audit lands exactly one row per exported result -----------------------
    [Fact]
    public async Task ListAsync_writes_one_export_audit_row_per_result()
    {
        var actor = Guid.NewGuid();

        var result = await UseCase().ListAsync(PrincipalA(actor.ToString()), 25, null, CancellationToken.None);
        Assert.Equal(4, result.Items.Count);

        var audited = await fixture.ExportRecordIdsForActorAsync(actor);
        Assert.Equal(
            new[]
            {
                ExternalAssessmentFixture.ResultA1,
                ExternalAssessmentFixture.ResultA2,
                ExternalAssessmentFixture.ResultA3,
                ExternalAssessmentFixture.ResultA4,
            },
            audited.ToArray());
    }

    // ---- INV-D BITE: an injected (missing-table) audit failure ABORTS the export ------------------
    [Fact]
    public async Task ListAsync_audit_write_failure_aborts_the_export()
    {
        await Assert.ThrowsAsync<AuditWriteFailedException>(() =>
            UseCase(auditToMissingDb: true).ListAsync(PrincipalA(Guid.NewGuid().ToString()), 25, null, CancellationToken.None));
    }
}
