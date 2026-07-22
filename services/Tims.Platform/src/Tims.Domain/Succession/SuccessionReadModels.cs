using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Succession;

/// <summary>
/// Wire shapes for the Phase-5 Slice 8 succession READ surface — faithful ports of what the live TS
/// <c>succession</c> router returns (packages/api/src/routers/succession.ts). INTERNAL staff reads = the RAW
/// Prisma model / include shape, NO <c>schemaVersion</c>. Every date serializes through the shared Node-ISO
/// converter (<c>…fffZ</c>, matching Node's <c>Date.toISOString()</c>), exactly as the other Phase-5 reads.
///
/// Reads 4/6/7/8/9 return the pure <see cref="SuccessionKernels"/> outputs (golden-parity both stacks); the
/// models here back the four RAW-model reads:
///   1 listCriticalRoles → <see cref="ListCriticalRoleRow"/> (roles + row-scoped successors),
///   2 getCriticalRole → <see cref="CriticalRoleDetailRow"/> (one role + holder email + successors + addedBy),
///   3 getFlightRisk → <see cref="FlightRiskRow"/> (roles ≥ threshold + <c>_count.successors</c>),
///   5 getRolesWithoutSuccessor → <see cref="RoleWithoutSuccessorRow"/> (roles with no successor).
/// </summary>

// ── Holder / user / addedBy sub-shapes (each read's exact select) ─────────────

/// <summary>currentHolder select for listCriticalRoles / getRolesWithoutSuccessor (no email).</summary>
public sealed record HolderBasic(string Id, string FirstName, string LastName, string? Avatar, string? JobTitle);

/// <summary>currentHolder select for getCriticalRole (adds email).</summary>
public sealed record HolderWithEmail(
    string Id, string FirstName, string LastName, string? Avatar, string? JobTitle, string Email);

/// <summary>currentHolder select for getFlightRisk (no jobTitle/email).</summary>
public sealed record FlightRiskHolder(string Id, string FirstName, string LastName, string? Avatar);

/// <summary>successor.user select for listCriticalRoles / getCriticalRole.</summary>
public sealed record SuccessorUser(string Id, string FirstName, string LastName, string? Avatar, string? JobTitle);

/// <summary>successor.addedByUser select for getCriticalRole.</summary>
public sealed record SuccessorAddedBy(string Id, string FirstName, string LastName);

// ── Successor rows ────────────────────────────────────────────────────────────

/// <summary>A successor row for listCriticalRoles (full Successor scalars + user).</summary>
public sealed record ListSuccessorRow(
    string Id,
    string OrganizationId,
    string CriticalRoleId,
    string UserId,
    string Readiness,
    string Type,
    string? DevelopmentPlan,
    string? AddedById,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    SuccessorUser User);

/// <summary>A successor row for getCriticalRole (full scalars + user + addedByUser).</summary>
public sealed record DetailSuccessorRow(
    string Id,
    string OrganizationId,
    string CriticalRoleId,
    string UserId,
    string Readiness,
    string Type,
    string? DevelopmentPlan,
    string? AddedById,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    SuccessorUser User,
    SuccessorAddedBy? AddedByUser);

// ── Critical-role rows (one per raw-model read) ────────────────────────────────

/// <summary>listCriticalRoles row: full CriticalRole scalars + currentHolder + row-scoped successors.</summary>
public sealed record ListCriticalRoleRow(
    string Id,
    string OrganizationId,
    string Title,
    string? PositionId,
    string? CurrentHolderId,
    string? CompanyId,
    string? UnitId,
    string Criticality,
    double? FlightRisk,
    string? TargetBandLevel,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    HolderBasic? CurrentHolder,
    IReadOnlyList<ListSuccessorRow> Successors);

/// <summary>getCriticalRole row: full scalars + currentHolder (email) + successors (+ addedByUser).</summary>
public sealed record CriticalRoleDetailRow(
    string Id,
    string OrganizationId,
    string Title,
    string? PositionId,
    string? CurrentHolderId,
    string? CompanyId,
    string? UnitId,
    string Criticality,
    double? FlightRisk,
    string? TargetBandLevel,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    HolderWithEmail? CurrentHolder,
    IReadOnlyList<DetailSuccessorRow> Successors);

/// <summary>The Prisma <c>_count</c> aggregate for getFlightRisk (serializes as <c>"_count":{"successors":N}</c>).</summary>
public sealed record CriticalRoleCount(int Successors);

/// <summary>getFlightRisk row: full scalars + currentHolder (no jobTitle) + <c>_count.successors</c>.</summary>
public sealed record FlightRiskRow(
    string Id,
    string OrganizationId,
    string Title,
    string? PositionId,
    string? CurrentHolderId,
    string? CompanyId,
    string? UnitId,
    string Criticality,
    double? FlightRisk,
    string? TargetBandLevel,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    FlightRiskHolder? CurrentHolder,
    [property: JsonPropertyName("_count")] CriticalRoleCount Count);

/// <summary>getRolesWithoutSuccessor row: full scalars + currentHolder (no email).</summary>
public sealed record RoleWithoutSuccessorRow(
    string Id,
    string OrganizationId,
    string Title,
    string? PositionId,
    string? CurrentHolderId,
    string? CompanyId,
    string? UnitId,
    string Criticality,
    double? FlightRisk,
    string? TargetBandLevel,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    HolderBasic? CurrentHolder);

// ── simulateExit response (kernel decision + raw role/holder/successors) ───────

/// <summary>simulateExit role sub-shape ({ id, title, criticality }).</summary>
public sealed record ExitRole(string Id, string Title, string Criticality);

/// <summary>simulateExit currentHolder sub-shape ({ id, firstName, lastName }).</summary>
public sealed record ExitHolder(string Id, string FirstName, string LastName);

/// <summary>simulateExit successor.user sub-shape ({ id, firstName, lastName, jobTitle }).</summary>
public sealed record ExitSuccessorUserView(string Id, string FirstName, string LastName, string? JobTitle);

/// <summary>simulateExit successor row (full Successor scalars + user).</summary>
public sealed record ExitSuccessorRow(
    string Id,
    string OrganizationId,
    string CriticalRoleId,
    string UserId,
    string Readiness,
    string Type,
    string? DevelopmentPlan,
    string? AddedById,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    ExitSuccessorUserView User);

/// <summary>The full simulateExit response = kernel decision + raw role/holder/successors.</summary>
public sealed record ExitSimulationView(
    ExitRole Role,
    ExitHolder? CurrentHolder,
    string RiskLevel,
    string Recommendation,
    IReadOnlyList<ExitSuccessorRow> Successors,
    int ReadyNowCount,
    int PipelineCount);
