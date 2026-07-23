using Tims.Domain.Engagement;

namespace Tims.Application.Engagement;

/// <summary>
/// The engagement WRITE use case (Phase-5 Slice-16) — faithful ports of the 5 TS <c>engagement</c> mutation bodies.
/// The mutations are thin (a single INSERT / UPDATE each, plus a pre-write gate), so this use case is a straight
/// pass-through to the repository: NO business logic beyond the data step (matching the inline-<c>db.*</c> TS router,
/// which has no service layer). The AUTHORIZATION mechanics that are Api concerns — createSurvey/activateSurvey's
/// grant-only, submitSurveyResponse's identity anchor, createActionPlan's <c>assertSubjectInScope(responsibleId)</c>,
/// and updateActionPlan's <c>assertScoped('actionPlan')</c> by-id probe + <c>assertSubjectInScope</c> reassignment
/// check — run in the ENDPOINT BEFORE this use case. The H1 in-org backstop on responsibleId, the survey active-gate
/// → NotActive, the dedup <c>@@unique</c> → Conflict, and the load count-0 → NotFound mapping live in the repository
/// (the atomic DB step) and surface here as the outcome/null the endpoint maps to a status code.
/// </summary>
public sealed class EngagementWriteUseCase(IEngagementWriteRepository repository)
{
    private readonly IEngagementWriteRepository _repository = repository;

    /// <summary>createSurvey: INSERT + return the full created row (createdById = caller, status = 'draft').</summary>
    public Task<SurveyRow> CreateSurveyAsync(
        string organizationId, Guid callerId, CreateSurveyInput input, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.CreateSurveyAsync(organizationId, callerId, input, now, cancellationToken);

    /// <summary>activateSurvey: load-then-update → { id, status }, or null (missing/cross-org → 404 at the endpoint).</summary>
    public Task<ActivateSurveyResult?> ActivateSurveyAsync(
        string organizationId, Guid surveyId, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.ActivateSurveyAsync(organizationId, surveyId, now, cancellationToken);

    /// <summary>submitSurveyResponse: active-gate + INSERT (userId = caller) → Created / SurveyNotActive (404) /
    /// Conflict (409).</summary>
    public Task<SubmitSurveyResponseResult> SubmitSurveyResponseAsync(
        string organizationId, Guid callerId, SubmitSurveyResponseInput input, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.SubmitSurveyResponseAsync(organizationId, callerId, input, now, cancellationToken);

    /// <summary>createActionPlan: H1 in-org check + INSERT → the full row, or null (responsibleId not in org → 403).</summary>
    public Task<ActionPlanWriteRow?> CreateActionPlanAsync(
        string organizationId, CreateActionPlanInput input, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.CreateActionPlanAsync(organizationId, input, now, cancellationToken);

    /// <summary>updateActionPlan: atomic scope-predicate FOR UPDATE re-check (closes the probe-then-update race) +
    /// (H1 reassignment check) + load + partial UPDATE → Updated / ResponsibleNotInOrg (403) / NotFound (404). The
    /// endpoint builds <paramref name="scopePredicateSql"/> / <paramref name="scopeParameters"/> from the resolved
    /// scope + anchors (the same inputs as the assertScoped probe).</summary>
    public Task<UpdateActionPlanResult> UpdateActionPlanAsync(
        string organizationId, Guid actionPlanId, UpdateActionPlanInput input,
        string scopePredicateSql, IReadOnlyList<object> scopeParameters, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.UpdateActionPlanAsync(
            organizationId, actionPlanId, input, scopePredicateSql, scopeParameters, now, cancellationToken);
}
