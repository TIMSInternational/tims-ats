using Tims.Domain.OrgStructure;

namespace Tims.Application.OrgStructure;

/// <summary>Who is writing, for the tenant predicate and the audit row. Org always comes from the session.</summary>
public sealed record OrgActor(Guid OrganizationId, Guid ActorId, string? IpAddress, string? UserAgent);

/// <summary>
/// Tenant org-structure persistence. Every method runs under <c>TenantScope</c> for
/// <see cref="OrgActor.OrganizationId"/> AND carries explicit organization predicates; ids outside the
/// organization are indistinguishable from unknown ids (<see cref="OrgWriteStatus.NotFound"/>). Every
/// successful write inserts its audit_logs row in the same transaction (fail-closed).
/// </summary>
public interface IOrgStructureRepository
{
    Task<OrgStructureView> ReadStructureAsync(Guid organizationId, CancellationToken ct);

    Task<OrgStructureOptions> ReadOptionsAsync(Guid organizationId, CancellationToken ct);

    Task<OrgWriteResult<BusinessUnitRow>> CreateBusinessUnitAsync(
        OrgActor actor, CreateBusinessUnitInput input, DateTime now, CancellationToken ct);

    Task<OrgWriteResult<BusinessUnitRow>> UpdateBusinessUnitAsync(
        OrgActor actor, Guid businessUnitId, UpdateBusinessUnitInput input, DateTime now, CancellationToken ct);

    Task<OrgWriteResult<TeamRow>> CreateTeamAsync(OrgActor actor, CreateTeamInput input, DateTime now, CancellationToken ct);

    Task<OrgWriteResult<TeamRow>> UpdateTeamAsync(
        OrgActor actor, Guid teamId, UpdateTeamInput input, DateTime now, CancellationToken ct);

    Task<OrgWriteResult<TeamMembershipRow>> PutTeamMemberAsync(
        OrgActor actor, Guid teamId, Guid userId, string role, CancellationToken ct);

    Task<OrgWriteResult<TeamMembershipRow>> DeleteTeamMemberAsync(
        OrgActor actor, Guid teamId, Guid userId, CancellationToken ct);

    Task<OrgWriteResult<UnitAssignmentRow>> PutUnitAssigneeAsync(
        OrgActor actor, Guid businessUnitId, Guid userId, DateTime now, CancellationToken ct);

    Task<OrgWriteResult<UnitAssignmentRow>> DeleteUnitAssigneeAsync(
        OrgActor actor, Guid businessUnitId, Guid userId, CancellationToken ct);

    Task<OrgWriteResult<UserBusinessUnitRow>> SetUserBusinessUnitAsync(
        OrgActor actor, Guid userId, Guid? businessUnitId, DateTime now, CancellationToken ct);
}
