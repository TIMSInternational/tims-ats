using Tims.Domain.ExternalVendor;

namespace Tims.Application.ExternalVendor;

/// <summary>
/// Read port for the external-vendor assessment surface. Both methods enforce, in the infrastructure
/// implementation, the completed-only lifecycle gate (INV-A), explicit <c>organizationId</c> on BOTH the
/// result AND the joined assignment plus RLS (INV-E), and project ONLY the external classification
/// ceiling — never a non-ceiling sensitive column.
/// </summary>
public interface IExternalAssessmentRepository
{
    /// <summary>
    /// A cursor page ordered <c>scoredAt desc, assignmentId asc</c> (INV-F): reads <c>take + 1</c> to
    /// compute <c>hasMore</c>, slices to <paramref name="take"/>, and returns the next cursor
    /// (assignmentId of the last returned row) when more remain.
    /// </summary>
    Task<ExternalResultPage> ListAsync(string organizationId, int take, string? cursor, CancellationToken cancellationToken);

    /// <summary>
    /// A single completed result by assignment id, or <c>null</c> (→ NOT_FOUND at the caller). A scored
    /// result on a NON-completed assignment returns null (INV-A leak-fix), as does a cross-org id (INV-E/G).
    /// </summary>
    Task<ExternalResultRow?> GetOneAsync(string organizationId, string assignmentId, CancellationToken cancellationToken);
}
