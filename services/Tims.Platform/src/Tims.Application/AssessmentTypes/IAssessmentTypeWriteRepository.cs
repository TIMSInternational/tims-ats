namespace Tims.Application.AssessmentTypes;

/// <summary>
/// Tenant-scoped writes on <c>assessment_types</c>. Every method runs UNDER TenantScope for
/// <paramref name="organizationId"/> AND filters on it explicitly, and writes its <c>audit_logs</c> row in the SAME
/// transaction (an audit failure rolls the mutation back — fail-closed).
/// </summary>
public interface IAssessmentTypeWriteRepository
{
    Task<AssessmentTypeWriteResult> CreateAsync(
        Guid organizationId, Guid actorId, AssessmentTypeCreateInput input, DateTime now, CancellationToken cancellationToken);

    Task<AssessmentTypeWriteResult> UpdateAsync(
        Guid organizationId, Guid actorId, Guid id, AssessmentTypeUpdateInput input, DateTime now,
        CancellationToken cancellationToken);

    Task<AssessmentTypeWriteResult> DeactivateAsync(
        Guid organizationId, Guid actorId, Guid id, DateTime now, CancellationToken cancellationToken);
}
