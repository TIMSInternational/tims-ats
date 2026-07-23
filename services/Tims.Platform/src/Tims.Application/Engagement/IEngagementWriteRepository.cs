using Tims.Domain.Engagement;

namespace Tims.Application.Engagement;

/// <summary>
/// Write port for the Phase-5 Slice-16 engagement WRITE surface — a faithful port of the data steps of the 5 TS
/// <c>engagement</c> mutations (createSurvey / activateSurvey / submitSurveyResponse / createActionPlan /
/// updateActionPlan). Every method runs UNDER <c>TenantScope</c> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an
/// EXPLICIT <c>organizationId</c> filter/value (defense-in-depth). This is an <c>efcoreStranglerWrite</c> coexistence
/// writer on <c>surveys</c> + <c>survey_responses</c> + <c>action_plans</c> — Prisma keeps the DDL and TS stays the
/// sole ACTIVE writer (and still reads these tables via monitoring.ts/dei.ts/the alert cron) until the deploy-gated
/// cutover.
/// </summary>
public interface IEngagementWriteRepository
{
    /// <summary>createSurvey: INSERT a surveys row (organizationId = caller, createdById = caller, status = 'draft',
    /// responseCount = 0); returns the FULL created row (Prisma default select echoes every scalar).</summary>
    Task<SurveyRow> CreateSurveyAsync(
        string organizationId, Guid callerId, CreateSurveyInput input, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>activateSurvey: load surveys {id, organizationId} (id + startsAt) — null ⇒ null (→ 404). Else UPDATE
    /// status = 'active', startsAt = existing.startsAt ?? now (preserve a prior startsAt, else stamp now); returns the
    /// narrowed { id, status }.</summary>
    Task<ActivateSurveyResult?> ActivateSurveyAsync(
        string organizationId, Guid surveyId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// submitSurveyResponse: existence/active gate (surveys {id, organizationId, status = 'active'}) → not found ⇒
    /// <see cref="SubmitSurveyResponseOutcome.SurveyNotActive"/> (→ 404). Else INSERT a survey_responses row
    /// (userId = caller ALWAYS, never an input); the <c>@@unique([surveyId, userId])</c> violation (23505) →
    /// <see cref="SubmitSurveyResponseOutcome.Conflict"/> (→ 409, atomic — no duplicate row). On success returns
    /// { id, submittedAt }.
    /// </summary>
    Task<SubmitSurveyResponseResult> SubmitSurveyResponseAsync(
        string organizationId, Guid callerId, SubmitSurveyResponseInput input, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>createActionPlan: INSERT an action_plans row (organizationId = caller, status = 'pending'); returns
    /// the FULL created row, or <c>null</c> when the <c>responsibleId</c> is NOT a member of the caller's org (the H1
    /// backstop → 403 at the endpoint). Org membership is validated under TenantScope (an RLS-filtered <c>users</c>
    /// lookup) BEFORE the INSERT.</summary>
    Task<ActionPlanWriteRow?> CreateActionPlanAsync(
        string organizationId, CreateActionPlanInput input, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// updateActionPlan: FIRST re-check the caller's scope predicate ATOMICALLY (a <c>SELECT 1 … FOR UPDATE</c> over
    /// <paramref name="scopePredicateSql"/> / <paramref name="scopeParameters"/> — the caller's materialized subject
    /// set built by the endpoint from the SAME scope + anchors as the assertScoped probe; org/company → <c>TRUE</c>).
    /// This closes the probe-then-update reassignment race (Codex HIGH): a concurrent reassignment out of the caller's
    /// scope ⇒ 0 rows ⇒ <see cref="UpdateActionPlanOutcome.NotFound"/> (404), else the row is LOCKED for the update.
    /// Then, when a <c>responsibleId</c> reassignment is present, validate it is in the caller's org under TenantScope
    /// BEFORE the UPDATE (the H1 backstop → <see cref="UpdateActionPlanOutcome.ResponsibleNotInOrg"/>, 403). Load
    /// action_plans {id, organizationId} — null ⇒ NotFound (TOCTOU → 404). Else apply the provided fields (absent
    /// optional keys are skipped; dueDate is tri-state) + updatedAt; returns the full updated row.
    /// </summary>
    Task<UpdateActionPlanResult> UpdateActionPlanAsync(
        string organizationId, Guid actionPlanId, UpdateActionPlanInput input,
        string scopePredicateSql, IReadOnlyList<object> scopeParameters, DateTimeOffset now,
        CancellationToken cancellationToken);
}
