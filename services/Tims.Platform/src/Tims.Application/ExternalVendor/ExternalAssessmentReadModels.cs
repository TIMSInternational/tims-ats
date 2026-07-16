using Tims.Domain.Access;
using Tims.Domain.ExternalVendor;

namespace Tims.Application.ExternalVendor;

/// <summary>
/// The resolved external-key caller for an assessment read: the KEY is the principal (no staff User).
/// <see cref="OrganizationId"/> + <see cref="ApiKeyId"/> come from the authenticated ApiKey scheme;
/// <see cref="ApiKeyId"/> is both the audit <c>actorId</c> and the scope userId. IP / user-agent are
/// carried for the audit row.
///
/// <see cref="ResolvedScope"/> is the ACTUAL access scope the permission check resolved for this key
/// (org-level today) — NOT a hardcoded constant. It is threaded into <see cref="ScopeWhereFor"/> so a
/// narrower-than-org grant (a deferred, never-issued-today external key) fails closed instead of running
/// an unscoped query (INV-B, fail-closed).
/// </summary>
public sealed record ExternalReadPrincipal(
    string OrganizationId,
    string ApiKeyId,
    AccessScope ResolvedScope,
    string? IpAddress = null,
    string? UserAgent = null);

/// <summary>
/// A cursor page of raw result rows (repository output). <see cref="Rows"/> is already sliced to the
/// requested <c>take</c>; <see cref="NextCursor"/> is the assignmentId to resume from (null = last page).
/// </summary>
public sealed record ExternalResultPage(
    IReadOnlyList<ExternalResultRow> Rows,
    string? NextCursor);

/// <summary>The mapped, cursor-paginated v1 list the list endpoint returns.</summary>
public sealed record ExternalAssessmentListResult(
    IReadOnlyList<ExternalAssessmentResultV1> Items,
    string? NextCursor);
