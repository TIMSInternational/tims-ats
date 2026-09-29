namespace Tims.Domain.OrgStructure;

/// <summary>
/// Bounds for the tenant org-structure surface. The management read is capped (not paged): an
/// organization past these sizes is outside what the settings screen is built for, and an unbounded
/// read would be a denial-of-service lever. Rows beyond a cap are omitted in stable (name, id) order.
/// </summary>
public static class OrgStructureLimits
{
    public const int MaxNameLength = 120;
    public const int MaxCodeLength = 40;
    public const int MaxBusinessUnits = 500;
    public const int MaxTeams = 2000;
    public const int MaxTeamMembers = 5000;
    public const int MaxUnitAssignees = 5000;
    public const int MaxCompanies = 100;
}

/// <summary>Stable machine-readable error codes returned in <c>{ code, message }</c> bodies.</summary>
public static class OrgStructureErrorCodes
{
    public const string InvalidInput = "invalid_input";
    public const string CompanyRequired = "company_required";
    public const string NotFound = "not_found";
    public const string BusinessUnitHasActiveTeams = "business_unit_has_active_teams";
    public const string BusinessUnitInactive = "business_unit_inactive";
    public const string TeamInactive = "team_inactive";
    public const string UserInactive = "user_inactive";
}

/// <summary>Team membership role values accepted by <c>user_teams.role</c>.</summary>
public static class TeamMemberRoles
{
    public const string Member = "member";
    public const string Lead = "lead";

    public static bool IsValid(string? value) => value is Member or Lead;
}

public sealed record OrgPerson(Guid UserId, string FullName, string Email);

public sealed record OrgTeamMember(Guid UserId, string FullName, string Email, string Role);

public sealed record OrgTeamView(
    Guid Id,
    string Name,
    Guid BusinessUnitId,
    bool IsActive,
    OrgPerson? Leader,
    IReadOnlyList<OrgTeamMember> Members);

public sealed record OrgBusinessUnitView(
    Guid Id,
    string Name,
    string? Code,
    Guid CompanyId,
    bool IsActive,
    int TeamCount,
    IReadOnlyList<OrgPerson> UnitAssignees,
    IReadOnlyList<OrgTeamView> Teams);

public sealed record OrgCompany(Guid Id, string Name);

public sealed record OrgStructureView(
    IReadOnlyList<OrgBusinessUnitView> BusinessUnits,
    IReadOnlyList<OrgCompany> Companies);

public sealed record OrgTeamOption(Guid Id, string Name, bool HasLeader);

public sealed record OrgBusinessUnitOption(Guid Id, string Name, IReadOnlyList<OrgTeamOption> Teams);

public sealed record OrgStructureOptions(IReadOnlyList<OrgBusinessUnitOption> BusinessUnits);

public sealed record BusinessUnitRow(Guid Id, string Name, string? Code, Guid CompanyId, bool IsActive);

public sealed record TeamRow(Guid Id, string Name, Guid BusinessUnitId, bool IsActive, Guid? LeaderUserId);

public sealed record TeamMembershipRow(Guid TeamId, Guid UserId, string Role);

public sealed record UnitAssignmentRow(Guid BusinessUnitId, Guid UserId);

public sealed record UserBusinessUnitRow(Guid UserId, Guid? BusinessUnitId);

/// <summary>
/// A field that may be absent, explicitly null, or set. PATCH bodies need all three states: absent
/// leaves the column alone, explicit null clears it (code, leaderUserId).
/// </summary>
public readonly record struct Optional<T>(bool IsSet, T Value)
{
    public static Optional<T> Absent => default;

    public static Optional<T> Of(T value) => new(true, value);
}

public sealed record CreateBusinessUnitInput(string Name, string? Code, Guid? CompanyId);

public sealed record UpdateBusinessUnitInput(Optional<string> Name, Optional<string?> Code, Optional<bool> IsActive)
{
    public bool IsEmpty => !Name.IsSet && !Code.IsSet && !IsActive.IsSet;
}

public sealed record CreateTeamInput(Guid BusinessUnitId, string Name, Guid? LeaderUserId);

public sealed record UpdateTeamInput(Optional<string> Name, Optional<bool> IsActive, Optional<Guid?> LeaderUserId)
{
    public bool IsEmpty => !Name.IsSet && !IsActive.IsSet && !LeaderUserId.IsSet;
}

/// <summary>Outcome of a write: <see cref="Row"/> on success, else a <see cref="Code"/> and HTTP class.</summary>
public enum OrgWriteStatus
{
    Ok,
    Created,
    NoContent,
    BadRequest,
    NotFound,
    Conflict,
}

public sealed record OrgWriteResult<T>(OrgWriteStatus Status, T? Row, string? Code)
{
    public static OrgWriteResult<T> Success(T row, OrgWriteStatus status = OrgWriteStatus.Ok) => new(status, row, null);

    public static OrgWriteResult<T> Fail(OrgWriteStatus status, string code) => new(status, default, code);
}
