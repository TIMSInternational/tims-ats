using Tims.Domain.OrgStructure;

namespace Tims.Application.OrgStructure;

/// <summary>
/// Tenant org-structure use cases. Inputs arrive already shaped by the endpoint; this layer re-asserts the
/// text bounds (defense in depth — a future caller cannot skip them) and normalizes before persisting.
/// </summary>
public sealed class OrgStructureUseCase(IOrgStructureRepository repository)
{
    public Task<OrgStructureView> ReadStructureAsync(Guid organizationId, CancellationToken ct) =>
        repository.ReadStructureAsync(organizationId, ct);

    public Task<OrgStructureOptions> ReadOptionsAsync(Guid organizationId, CancellationToken ct) =>
        repository.ReadOptionsAsync(organizationId, ct);

    public Task<OrgWriteResult<BusinessUnitRow>> CreateBusinessUnitAsync(
        OrgActor actor, CreateBusinessUnitInput input, DateTime now, CancellationToken ct)
    {
        if (!OrgStructureInput.TryNormalizeName(input.Name, out var name)
            || !OrgStructureInput.TryNormalizeCode(input.Code, out var code))
        {
            return Task.FromResult(Invalid<BusinessUnitRow>());
        }

        return repository.CreateBusinessUnitAsync(actor, input with { Name = name, Code = code }, now, ct);
    }

    public Task<OrgWriteResult<BusinessUnitRow>> UpdateBusinessUnitAsync(
        OrgActor actor, Guid businessUnitId, UpdateBusinessUnitInput input, DateTime now, CancellationToken ct)
    {
        if (input.IsEmpty)
        {
            return Task.FromResult(Invalid<BusinessUnitRow>());
        }

        var name = input.Name;
        if (name.IsSet)
        {
            if (!OrgStructureInput.TryNormalizeName(name.Value, out var normalized))
            {
                return Task.FromResult(Invalid<BusinessUnitRow>());
            }

            name = Optional<string>.Of(normalized);
        }

        var code = input.Code;
        if (code.IsSet)
        {
            if (!OrgStructureInput.TryNormalizeCode(code.Value, out var normalized))
            {
                return Task.FromResult(Invalid<BusinessUnitRow>());
            }

            code = Optional<string?>.Of(normalized);
        }

        return repository.UpdateBusinessUnitAsync(
            actor, businessUnitId, input with { Name = name, Code = code }, now, ct);
    }

    public Task<OrgWriteResult<TeamRow>> CreateTeamAsync(
        OrgActor actor, CreateTeamInput input, DateTime now, CancellationToken ct)
    {
        if (!OrgStructureInput.TryNormalizeName(input.Name, out var name))
        {
            return Task.FromResult(Invalid<TeamRow>());
        }

        return repository.CreateTeamAsync(actor, input with { Name = name }, now, ct);
    }

    public Task<OrgWriteResult<TeamRow>> UpdateTeamAsync(
        OrgActor actor, Guid teamId, UpdateTeamInput input, DateTime now, CancellationToken ct)
    {
        if (input.IsEmpty)
        {
            return Task.FromResult(Invalid<TeamRow>());
        }

        var name = input.Name;
        if (name.IsSet)
        {
            if (!OrgStructureInput.TryNormalizeName(name.Value, out var normalized))
            {
                return Task.FromResult(Invalid<TeamRow>());
            }

            name = Optional<string>.Of(normalized);
        }

        return repository.UpdateTeamAsync(actor, teamId, input with { Name = name }, now, ct);
    }

    public Task<OrgWriteResult<TeamMembershipRow>> PutTeamMemberAsync(
        OrgActor actor, Guid teamId, Guid userId, string? role, CancellationToken ct)
    {
        var effectiveRole = role ?? TeamMemberRoles.Member;
        return TeamMemberRoles.IsValid(effectiveRole)
            ? repository.PutTeamMemberAsync(actor, teamId, userId, effectiveRole, ct)
            : Task.FromResult(Invalid<TeamMembershipRow>());
    }

    public Task<OrgWriteResult<TeamMembershipRow>> DeleteTeamMemberAsync(
        OrgActor actor, Guid teamId, Guid userId, CancellationToken ct) =>
        repository.DeleteTeamMemberAsync(actor, teamId, userId, ct);

    public Task<OrgWriteResult<UnitAssignmentRow>> PutUnitAssigneeAsync(
        OrgActor actor, Guid businessUnitId, Guid userId, DateTime now, CancellationToken ct) =>
        repository.PutUnitAssigneeAsync(actor, businessUnitId, userId, now, ct);

    public Task<OrgWriteResult<UnitAssignmentRow>> DeleteUnitAssigneeAsync(
        OrgActor actor, Guid businessUnitId, Guid userId, CancellationToken ct) =>
        repository.DeleteUnitAssigneeAsync(actor, businessUnitId, userId, ct);

    public Task<OrgWriteResult<UserBusinessUnitRow>> SetUserBusinessUnitAsync(
        OrgActor actor, Guid userId, Guid? businessUnitId, DateTime now, CancellationToken ct) =>
        repository.SetUserBusinessUnitAsync(actor, userId, businessUnitId, now, ct);

    private static OrgWriteResult<T> Invalid<T>() =>
        OrgWriteResult<T>.Fail(OrgWriteStatus.BadRequest, OrgStructureErrorCodes.InvalidInput);
}
