using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Succession;

/// <summary>
/// Write-side models for the Phase-5 Slice 14 succession WRITE surface — faithful ports of the inputs/outputs of the
/// 5 mutation bodies of the TS <c>succession</c> router (addCriticalRole / addSuccessor / removeSuccessor /
/// updateSuccessorReadiness / updateCriticalRoleBand). <c>criticality</c>/<c>readiness</c>/<c>type</c> are PLAIN
/// STRINGS in the DB (no native enums) — the Zod <c>.enum()</c> is app-layer validation only, enforced at the
/// endpoint (→ 400 after auth). The stored value is the raw validated string (never normalized). createdAt/updatedAt
/// serialize via <see cref="NodeIsoDateTimeOffsetConverter"/> so the wire is Node <c>Date.toISOString()</c>
/// (<c>…fffZ</c>, NOT STJ <c>+00:00</c>).
/// </summary>

/// <summary>The accepted <c>criticality</c> values (Zod enum critical/high/medium/low). Stored verbatim.</summary>
public static class SuccessionCriticalityValues
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "critical", "high", "medium", "low",
    };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}

/// <summary>The accepted <c>readiness</c> values (Zod enum ready_now/ready_1_year/ready_2_years/developing). Verbatim.</summary>
public static class SuccessionReadinessValues
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "ready_now", "ready_1_year", "ready_2_years", "developing",
    };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}

/// <summary>The accepted successor <c>type</c> values (Zod enum internal/external). Stored verbatim.</summary>
public static class SuccessionSuccessorTypeValues
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "internal", "external",
    };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}

/// <summary>
/// The validated addCriticalRole input (Zod-parity, succession.ts:118-127). The optional FK/scalar fields are
/// <c>null</c> when absent (Prisma leaves the column NULL). <see cref="Criticality"/> is a validated enum-set value.
/// </summary>
public sealed record AddCriticalRoleInput(
    string Title,
    string? PositionId,
    Guid? CurrentHolderId,
    Guid? CompanyId,
    Guid? UnitId,
    string Criticality,
    double? FlightRisk);

/// <summary>
/// The validated addSuccessor input (Zod-parity, succession.ts:144-151). <see cref="CriticalRoleId"/> is the route
/// param (authoritative); <see cref="Readiness"/>/<see cref="Type"/> are validated enum-set values.
/// <see cref="DevelopmentPlan"/> is <c>null</c> when absent (INSERT stores NULL).
/// </summary>
public sealed record AddSuccessorInput(
    Guid CriticalRoleId,
    Guid UserId,
    string Readiness,
    string Type,
    string? DevelopmentPlan);

/// <summary>
/// The validated updateSuccessorReadiness input (Zod-parity, succession.ts:193-199). <see cref="Readiness"/> is
/// always set; <see cref="DevelopmentPlan"/> is applied ONLY when <see cref="HasDevelopmentPlan"/> is true — a
/// faithful port of the Prisma <c>data: { readiness, developmentPlan }</c> spread where an ABSENT optional key is
/// skipped (never nulled).
/// </summary>
public sealed record UpdateSuccessorReadinessInput(
    string Readiness,
    string? DevelopmentPlan,
    bool HasDevelopmentPlan);

/// <summary>The validated updateCriticalRoleBand input (Zod-parity, succession.ts:215-219). <see cref="TargetBandLevel"/>
/// is REQUIRED-but-nullable (Zod <c>.nullable()</c>, not <c>.optional()</c>) — a null clears the band.</summary>
public sealed record UpdateCriticalRoleBandInput(string? TargetBandLevel);

/// <summary>
/// The full created critical_roles row (addCriticalRole returns the row with NO Prisma <c>select</c>).
/// <see cref="TargetBandLevel"/> is always null on create (Prisma default). createdAt/updatedAt are Node-ISO.
/// </summary>
public sealed record CriticalRoleRow(
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
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt);

/// <summary>The nested successor <c>user</c> projection (addSuccessor TS <c>include: { user: { select:
/// { id, firstName, lastName, avatar } } }</c>).</summary>
public sealed record SuccessorUserRow(string Id, string FirstName, string LastName, string? Avatar);

/// <summary>
/// The full created successors row + the nested <c>user</c> (addSuccessor). All scalar fields plus the projected
/// user (never a full HR row). createdAt/updatedAt are Node-ISO.
/// </summary>
public sealed record SuccessorRow(
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
    SuccessorUserRow User);

/// <summary>
/// The full successor scalar row (NO nested user) — the shape of the TS <c>delete</c> return (removeSuccessor) AND
/// the <c>update</c> return (updateSuccessorReadiness), which are byte-identical (both the full row with no
/// <c>include</c>/<c>select</c>). This is the spec's <c>RemovedSuccessorResult</c>, reused by updateSuccessorReadiness.
/// </summary>
public sealed record SuccessorScalarRow(
    string Id,
    string OrganizationId,
    string CriticalRoleId,
    string UserId,
    string Readiness,
    string Type,
    string? DevelopmentPlan,
    string? AddedById,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt);

/// <summary>The updateCriticalRoleBand return — the ONLY write with a narrowed Prisma
/// <c>select { id, targetBandLevel }</c>. Match it exactly (no other field is echoed).</summary>
public sealed record CriticalRoleBandResult(string Id, string? TargetBandLevel);

/// <summary>The outcome of an addSuccessor attempt (the deliberate P2002 → CONFLICT improvement).</summary>
public enum AddSuccessorOutcome
{
    /// <summary>The INSERT succeeded → 200, the full row + nested user.</summary>
    Created,

    /// <summary>The <c>@@unique([criticalRoleId, userId])</c> was violated (23505) → 409 CONFLICT (documented
    /// port improvement over the TS 500). No duplicate row is created (atomic rollback).</summary>
    Conflict,

    /// <summary>
    /// The target <c>userId</c> is NOT a member of the caller's org → 403 (Codex H1). <c>assertSubjectInScope</c>
    /// no-ops for organization/company scope (it validates SCOPE, not org membership), so an org-scoped caller could
    /// otherwise persist a cross-tenant <c>userId</c>. The repository proves org membership authoritatively under
    /// TenantScope (a <c>users</c> lookup is RLS-filtered to the caller's org) BEFORE the INSERT — 0 rows ⇒ this.
    /// </summary>
    SubjectNotInOrg,
}

/// <summary>Result of an addSuccessor attempt: the outcome + (when Created) the full row.</summary>
public sealed record AddSuccessorResult(AddSuccessorOutcome Outcome, SuccessorRow? Row);
