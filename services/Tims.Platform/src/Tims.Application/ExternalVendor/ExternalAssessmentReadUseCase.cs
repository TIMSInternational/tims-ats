using Tims.Application.Audit;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Domain.ExternalVendor;

namespace Tims.Application.ExternalVendor;

/// <summary>
/// The external-vendor assessment READ use case — infra-free orchestration (drives the repository port
/// + <see cref="IDataAccessAuditor"/> only). A faithful port of <c>externalAssessmentService</c>
/// (packages/api/src/services/external-assessment.service.ts):
///
///   query → <b>fail-CLOSED audit each exported row (awaited BEFORE any data is returned)</b> → map v1.
///
/// INV-D: every exported psychometric record writes ONE <c>data_access_logs</c> row
/// (<c>entity=assessmentResult, action=export, actorId=apiKeyId</c>) <c>failClosed:true</c>. A lost audit
/// THROWS (<see cref="AuditWriteFailedException"/>) and ABORTS the export — no unlogged data leaves. The
/// list audits EVERY row first, then maps; the map/return is never reached if any audit fails.
///
/// INV-B: external keys resolve to an ORG-LEVEL access scope, so <see cref="ScopeWhereFor"/> for
/// assessmentAssignment yields the no-op <c>{}</c> (org filter + RLS do the isolation). Narrow-scoped
/// external keys are a deferred slice; the org-scope guard fails closed rather than run unscoped if one
/// ever appears.
/// </summary>
public sealed class ExternalAssessmentReadUseCase(IExternalAssessmentRepository repository, IDataAccessAuditor auditor)
{
    private const string AssessmentResultEntity = "assessmentResult";

    private readonly IExternalAssessmentRepository _repository = repository;
    private readonly IDataAccessAuditor _auditor = auditor;

    public async Task<ExternalAssessmentListResult> ListAsync(
        ExternalReadPrincipal principal, int take, string? cursor, CancellationToken cancellationToken)
    {
        await EnsureOrgLevelScopeAsync(principal, cancellationToken).ConfigureAwait(false);

        var page = await _repository
            .ListAsync(principal.OrganizationId, take, cursor, cancellationToken)
            .ConfigureAwait(false);

        // Audit EVERY record fail-closed BEFORE mapping/returning any data (INV-D).
        foreach (var row in page.Rows)
        {
            await AuditExportAsync(row, principal, cancellationToken).ConfigureAwait(false);
        }

        var items = page.Rows.Select(ExternalAssessmentResultV1Mapper.Map).ToList();
        return new ExternalAssessmentListResult(items, page.NextCursor);
    }

    public async Task<ExternalAssessmentResultV1> GetOneAsync(
        ExternalReadPrincipal principal, string assignmentId, CancellationToken cancellationToken)
    {
        await EnsureOrgLevelScopeAsync(principal, cancellationToken).ConfigureAwait(false);

        var row = await _repository
            .GetOneAsync(principal.OrganizationId, assignmentId, cancellationToken)
            .ConfigureAwait(false);
        if (row is null)
        {
            throw new ExternalAssessmentNotFoundException();
        }

        await AuditExportAsync(row, principal, cancellationToken).ConfigureAwait(false);
        return ExternalAssessmentResultV1Mapper.Map(row);
    }

    // INV-B: pin that the external key's RESOLVED access scope narrows to the no-op {} for
    // assessmentAssignment. Wire scopeWhereFor into the live path (not hand-waved): resolve it at the
    // scope the permission check actually returned — NOT a hardcoded constant — with no anchor loader,
    // and require MatchAll. A narrow resolved scope (own/team/unit) means a narrow-scoped external key
    // (deferred, never issued today): with no anchor loader ScopeWhereFor fails closed, and any other
    // non-MatchAll fragment trips the explicit throw below — either way we fail closed rather than run
    // an unscoped/partial query.
    private static async Task EnsureOrgLevelScopeAsync(ExternalReadPrincipal principal, CancellationToken cancellationToken)
    {
        var predicate = await ScopeWhereFor
            .BuildAsync(ScopedEntity.AssessmentAssignment, principal.ResolvedScope, anchors: null, principal.ApiKeyId, cancellationToken)
            .ConfigureAwait(false);
        if (predicate is not ScopePredicate.MatchAllPredicate)
        {
            throw new NotSupportedException(
                "Narrow-scoped external keys are not supported for the assessment read surface (deferred slice).");
        }
    }

    private Task AuditExportAsync(ExternalResultRow row, ExternalReadPrincipal principal, CancellationToken cancellationToken) =>
        _auditor.LogAsync(
            new DataAccessEvent(
                principal.OrganizationId,
                principal.ApiKeyId,
                AssessmentResultEntity,
                row.Id,
                AuditAction.Export,
                principal.IpAddress,
                principal.UserAgent),
            failClosed: true,
            cancellationToken);
}
