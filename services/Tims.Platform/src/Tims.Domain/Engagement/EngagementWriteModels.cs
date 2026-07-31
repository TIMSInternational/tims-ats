using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Engagement;

/// <summary>
/// Write-side models for the Phase-5 Slice 16 engagement WRITE surface — faithful ports of the inputs/outputs of the
/// 5 mutation bodies of the TS <c>engagement</c> router (createSurvey / activateSurvey / submitSurveyResponse /
/// createActionPlan / updateActionPlan). <c>type</c>/<c>status</c> are PLAIN STRINGS in the DB (no native enums) — the
/// Zod <c>.enum()</c> is app-layer validation only, enforced at the endpoint (→ 400 after auth). The stored value is
/// the raw validated string (never normalized). <c>questions</c>/<c>targetGroups</c>/<c>answers</c> are opaque jsonb —
/// stored as-is (targetGroups carries NO in-org validation: a documented LOW, spec §2.2 — never read back by any
/// access decision). createdAt/updatedAt/startsAt/endsAt/dueDate/submittedAt serialize via
/// <see cref="NodeIsoDateTimeOffsetConverter"/> so the wire is Node <c>Date.toISOString()</c> (<c>…fffZ</c>, NOT STJ
/// <c>+00:00</c>).
/// </summary>

/// <summary>The accepted survey <c>type</c> values (Zod enum pulse/enps/climate/custom). Stored verbatim.</summary>
public static class SurveyTypeValues
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "pulse", "enps", "climate", "custom",
    };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}

/// <summary>The accepted survey question <c>type</c> values (Zod enum scale/text/multiple_choice/yes_no).</summary>
public static class SurveyQuestionTypeValues
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "scale", "text", "multiple_choice", "yes_no",
    };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}

/// <summary>The accepted <c>updateActionPlan.status</c> values (Zod enum pending/in_progress/completed).</summary>
public static class ActionPlanStatusValues
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "pending", "in_progress", "completed",
    };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}

/// <summary>
/// The validated createSurvey input (Zod-parity with the deleted TS createSurvey mutation's input schema — title,
/// type, questions array, optional targetGroups/startsAt/endsAt). <see cref="Questions"/> is the validated
/// non-empty questions array (each item text/type/options/required/category checked at the endpoint); it is stored as
/// opaque jsonb. <see cref="TargetGroups"/> is the whole optional object (or <c>null</c> when absent) — stored
/// opaque, NEVER validated in-org (spec §2.2 LOW). startsAt/endsAt are <c>null</c> when absent (Prisma leaves the
/// column NULL). status is hard-coded 'draft'; createdById = caller; organizationId = caller.
/// </summary>
public sealed record CreateSurveyInput(
    string Title,
    string Type,
    JsonArray Questions,
    JsonObject? TargetGroups,
    DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt);

/// <summary>The validated activateSurvey input (Zod-parity with the deleted TS activateSurvey mutation's input
/// schema). Just the route-param id.</summary>
public sealed record ActivateSurveyInput(Guid Id);

/// <summary>
/// The validated submitSurveyResponse input (Zod-parity with the deleted TS submitSurveyResponse mutation's input
/// schema). <see cref="SurveyId"/> is the route
/// param; <see cref="Answers"/> is the opaque jsonb answers object (record, ≤100 keys, string≤5000 | number values).
/// The userId is NEVER an input — it is the resolved caller, stamped server-side (identity anchor).
/// </summary>
public sealed record SubmitSurveyResponseInput(Guid SurveyId, JsonObject Answers);

/// <summary>The validated createActionPlan input (Zod-parity with the TS createActionPlan mutation's input schema).
/// <see cref="Area"/>/
/// <see cref="Notes"/>/<see cref="DueDate"/> are <c>null</c> when absent (Prisma leaves the column NULL). status is
/// hard-coded 'pending'; organizationId = caller.</summary>
public sealed record CreateActionPlanInput(
    string Title,
    Guid ResponsibleId,
    string? Area,
    string? Notes,
    DateTimeOffset? DueDate);

/// <summary>
/// The validated updateActionPlan input (Zod-parity with the TS updateActionPlan mutation's input schema). Every
/// field is optional; the <c>Has*</c> flags carry the Prisma "absent optional key is skipped (never nulled)"
/// spread. <see cref="DueDate"/> is a tri-state (matching the TS mutation's dueDate spread):
/// <see cref="HasDueDate"/> false ⇒ unchanged; true + <see cref="DueDate"/> null
/// ⇒ CLEAR the column; true + a value ⇒ set it. <see cref="ResponsibleId"/> present ⇒ a reassignment (the H1 in-org
/// backstop + assertSubjectInScope both run).
/// </summary>
public sealed record UpdateActionPlanInput(
    string? Title,
    bool HasTitle,
    string? Notes,
    bool HasNotes,
    string? Status,
    bool HasStatus,
    Guid? ResponsibleId,
    DateTimeOffset? DueDate,
    bool HasDueDate);

/// <summary>
/// The full created surveys row (createSurvey returns the row with NO Prisma <c>select</c> → the Prisma default
/// select echoes every scalar). <see cref="Questions"/>/<see cref="TargetGroups"/> serialize INLINE as JSON (the
/// stored jsonb). <see cref="ResponseCount"/> is 0 on create (Prisma default) so no k-anon concern. status = 'draft'.
/// createdAt/updatedAt/startsAt/endsAt are Node-ISO.
/// </summary>
public sealed record SurveyRow(
    string Id,
    string OrganizationId,
    string Title,
    string Type,
    string Status,
    JsonNode Questions,
    JsonNode? TargetGroups,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? StartsAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? EndsAt,
    int ResponseCount,
    string CreatedById,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt);

/// <summary>The activateSurvey return — the narrowed Prisma <c>select { id, status }</c> of the deleted TS
/// activateSurvey mutation.</summary>
public sealed record ActivateSurveyResult(string Id, string Status);

/// <summary>The submitSurveyResponse success return — the narrowed Prisma <c>select { id, submittedAt }</c> of the
/// deleted TS submitSurveyResponse mutation. The confidential <c>answers</c> is NEVER echoed. submittedAt is
/// Node-ISO.</summary>
public sealed record SubmitSurveyResponseRow(
    string Id,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset SubmittedAt);

/// <summary>The outcome of a submitSurveyResponse attempt.</summary>
public enum SubmitSurveyResponseOutcome
{
    /// <summary>The INSERT succeeded → 200, { id, submittedAt }.</summary>
    Created,

    /// <summary>The survey does not exist / is not active for the caller's org → 404 (the DOCUMENTED port
    /// improvement over the TS plain-Error 500: a clean, leak-free NOT_FOUND). "Encuesta no encontrada o no activa".</summary>
    SurveyNotActive,

    /// <summary>The <c>@@unique([surveyId, userId])</c> was violated (23505) → 409 CONFLICT "Ya respondiste esta
    /// encuesta". No duplicate row is created (atomic rollback). Matches the TS P2002 → CONFLICT.</summary>
    Conflict,
}

/// <summary>Result of a submitSurveyResponse attempt: the outcome + (when Created) the { id, submittedAt } row.</summary>
public sealed record SubmitSurveyResponseResult(SubmitSurveyResponseOutcome Outcome, SubmitSurveyResponseRow? Row);

/// <summary>
/// The full created/updated action_plans row (create/updateActionPlan return the row with NO Prisma <c>select</c> →
/// the default select echoes every scalar). <see cref="Actions"/> serializes INLINE as JSON (the stored jsonb; null
/// on create). createdAt/updatedAt/dueDate are Node-ISO.
/// </summary>
public sealed record ActionPlanWriteRow(
    string Id,
    string OrganizationId,
    string Title,
    string ResponsibleId,
    string? Area,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? DueDate,
    JsonNode? Actions,
    string? Notes,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt);

/// <summary>The outcome of an updateActionPlan attempt (the by-id probe already passed at the endpoint).</summary>
public enum UpdateActionPlanOutcome
{
    /// <summary>The UPDATE succeeded → 200, the full row.</summary>
    Updated,

    /// <summary>
    /// A PROVIDED <c>responsibleId</c> reassignment targets a user NOT in the caller's org → 403 (the H1 both-stacks
    /// hardening). assertSubjectInScope no-ops for organization/company scope, so an org-scoped caller could otherwise
    /// persist a cross-tenant responsibleId; the repository proves org membership authoritatively under TenantScope (a
    /// <c>users</c> lookup is RLS-filtered to the org) BEFORE the UPDATE — not-in-org ⇒ this. NO reassignment persisted.
    /// </summary>
    ResponsibleNotInOrg,

    /// <summary>The row vanished between the assertScoped probe and the update (TOCTOU) → 404 at the caller.</summary>
    NotFound,
}

/// <summary>Result of an updateActionPlan attempt: the outcome + (when Updated) the full row.</summary>
public sealed record UpdateActionPlanResult(UpdateActionPlanOutcome Outcome, ActionPlanWriteRow? Row);
