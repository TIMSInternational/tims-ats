using Tims.Domain.Access;
using Tims.Domain.Engagement;

namespace Tims.Application.Engagement;

/// <summary>
/// The engagement READ use case — infra-free orchestration, a faithful port of the 14 read bodies of the TS
/// <c>engagement</c> router. The aggregate reads run the pure <see cref="EngagementKernels"/> (golden-parity with
/// @tims/shared): #2 summarizeSurveyResults, #5 computeEnps, #6 buildClimateHeatmap, #7 buildResultsByArea, #13
/// buildEngagementKpis; listSurveys applies the per-item min-5 <see cref="KAnonymity"/> floor on the raw
/// responseCount. No clock and no scope logic here (the endpoint owns the clock/window + the anchor loader +
/// scopeWhereFor); the use case only threads the resolved <see cref="ScopePredicate"/> to the repo.
/// </summary>
public sealed class EngagementReadUseCase(IEngagementReadRepository repository)
{
    private readonly IEngagementReadRepository _repository = repository;

    // #1 listSurveys: raw rows → per-item min-5 responseCount floor (null + flag when 1..4).
    public async Task<SurveyListView> ListSurveysAsync(
        string organizationId, string? status, int page, int limit, CancellationToken cancellationToken)
    {
        var pageData = await _repository
            .ListSurveysAsync(organizationId, status, page, limit, cancellationToken)
            .ConfigureAwait(false);

        var items = pageData.Rows.Select(r =>
        {
            var floor = KAnonymity.SuppressBelowMin5(r.ResponseCount);
            return new SurveyListItem(
                r.Id, r.Title, r.Type, r.Status, r.StartsAt, r.EndsAt, r.CreatedAt, r.UpdatedAt,
                floor.Count, floor.Suppressed);
        }).ToList();

        return new SurveyListView(items, pageData.Total, page, limit);
    }

    // #2 getSurveyResults: survey scalars + answers → summarizeSurveyResults kernel + surveyId/title wrap.
    // null → the endpoint mirrors the TS `throw new Error('Encuesta no encontrada')` (plain Error → 500).
    public async Task<SurveyResultsView?> GetSurveyResultsAsync(
        string organizationId, Guid surveyId, CancellationToken cancellationToken)
    {
        var data = await _repository
            .GetSurveyResultsDataAsync(organizationId, surveyId, cancellationToken)
            .ConfigureAwait(false);
        if (data is null)
        {
            return null;
        }

        var summary = EngagementKernels.SummarizeSurveyResults(data.Questions, data.ResponseAnswers);
        return new SurveyResultsView(data.Id, data.Title, summary.TotalResponses, summary.Suppressed, summary.QuestionSummaries);
    }

    // #3 myPendingSurveys (OWN self-service).
    public Task<IReadOnlyList<PendingSurveyRow>> MyPendingSurveysAsync(
        string organizationId, Guid userId, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.GetPendingSurveysAsync(organizationId, userId, now, cancellationToken);

    // #4 getSurveyForResponse (OWN self-service): null → the endpoint 404s (TRPCError NOT_FOUND parity).
    public Task<SurveyForResponseView?> GetSurveyForResponseAsync(
        string organizationId, Guid surveyId, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.GetSurveyForResponseAsync(organizationId, surveyId, now, cancellationToken);

    // #5 getEnps: enps-response answers since the window → computeEnps kernel.
    public async Task<EnpsResult> GetEnpsAsync(
        string organizationId, DateTimeOffset since, string period, CancellationToken cancellationToken)
    {
        var answers = await _repository
            .GetEnpsAnswersAsync(organizationId, since, cancellationToken)
            .ConfigureAwait(false);
        return EngagementKernels.ComputeEnps(answers, period);
    }

    // #6 getClimateHeatmap: no climate survey → {surveyId:null, title:'', suppressed:false, data:[]}; else the
    // buildClimateHeatmap kernel + surveyId/title wrap.
    public async Task<ClimateHeatmapView> GetClimateHeatmapAsync(
        string organizationId, Guid? surveyId, CancellationToken cancellationToken)
    {
        var data = await _repository
            .GetClimateHeatmapDataAsync(organizationId, surveyId, cancellationToken)
            .ConfigureAwait(false);
        if (data is null)
        {
            return new ClimateHeatmapView(null, string.Empty, false, Array.Empty<HeatCell>());
        }

        var heatmap = EngagementKernels.BuildClimateHeatmap(data.Questions, data.ResponseAnswers);
        return new ClimateHeatmapView(data.Id, data.Title, heatmap.Suppressed, heatmap.Data);
    }

    // #7 getResultsByArea: null → the endpoint mirrors `throw new Error('Encuesta no encontrada')` (→ 500). Else
    // resolve each response's area key (company|businessUnit per groupBy; a falsy/absent key → the implicit
    // unassigned bucket) and run buildResultsByArea.
    public async Task<ResultsByAreaView?> GetResultsByAreaAsync(
        string organizationId, Guid surveyId, string groupBy, CancellationToken cancellationToken)
    {
        var data = await _repository
            .GetResultsByAreaDataAsync(organizationId, surveyId, cancellationToken)
            .ConfigureAwait(false);
        if (data is null)
        {
            return null;
        }

        var rows = data.Responses.Select(r =>
        {
            var key = string.Equals(groupBy, "company", StringComparison.Ordinal) ? r.CompanyId : r.BusinessUnitId;
            return new AreaResultRow(string.IsNullOrEmpty(key) ? null : key, r.Answers);
        }).ToList();

        var byArea = EngagementKernels.BuildResultsByArea(rows);
        return new ResultsByAreaView(data.Id, groupBy, byArea.Results, byArea.Suppressed);
    }

    // #10 getLowClimateAlerts.
    public Task<IReadOnlyList<AlertRow>> GetLowClimateAlertsAsync(
        string organizationId, CancellationToken cancellationToken) =>
        _repository.GetLowClimateAlertsAsync(organizationId, cancellationToken);

    // #11 listActionPlans (scopeWhereFor('actionPlan') row filter).
    public Task<IReadOnlyList<ActionPlanRow>> ListActionPlansAsync(
        string organizationId, string? status, ScopePredicate scope, CancellationToken cancellationToken) =>
        _repository.ListActionPlansAsync(organizationId, status, scope, cancellationToken);

    // #12 listLeaderCommitments (scopeWhereFor('leaderCommitment') row filter).
    public Task<IReadOnlyList<LeaderCommitmentRow>> ListLeaderCommitmentsAsync(
        string organizationId, Guid? leaderId, string? status, ScopePredicate scope, CancellationToken cancellationToken) =>
        _repository.ListLeaderCommitmentsAsync(organizationId, leaderId, status, scope, cancellationToken);

    // #13 getDashboardKpis: counts + per-survey counts → buildEngagementKpis (org-total floor + differencing guard).
    public async Task<EngagementKpis> GetDashboardKpisAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository
            .GetDashboardKpiDataAsync(organizationId, cancellationToken)
            .ConfigureAwait(false);
        return EngagementKernels.BuildEngagementKpis(
            data.ActiveSurveys, data.TotalResponses, data.PerSurveyCounts, data.ActionPlansOpen);
    }

    // #14 getRotationRisk (mostly stub): the active user head-count wrapped in the fixed summary shape.
    public async Task<RotationRiskView> GetRotationRiskAsync(
        string organizationId, Guid? companyId, Guid? businessUnitId, CancellationToken cancellationToken)
    {
        var total = await _repository
            .GetActiveUserCountAsync(organizationId, companyId, businessUnitId, cancellationToken)
            .ConfigureAwait(false);
        return new RotationRiskView(new RotationRiskSummary(0, 0, 0, total), Array.Empty<System.Text.Json.Nodes.JsonNode>());
    }
}
