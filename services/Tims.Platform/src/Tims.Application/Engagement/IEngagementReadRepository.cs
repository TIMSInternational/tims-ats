using Tims.Domain.Access;
using Tims.Domain.Engagement;

namespace Tims.Application.Engagement;

/// <summary>
/// Read port for the engagement surface — a faithful port of the READ bodies of
/// <c>packages/api/src/routers/engagement.ts</c> (the 14 reads; the 5 writes are NOT ported). Every method, in
/// the infrastructure implementation, runs <c>AsNoTracking</c> UNDER <c>TenantScope</c> (SET LOCAL ROLE
/// app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth). Aggregate reads
/// pull minimal answers-only projections and let the pure kernels shape/suppress; the two row-scoped list reads
/// (listActionPlans / listLeaderCommitments) take the caller's <see cref="ScopePredicate"/> (from
/// <c>scopeWhereFor('actionPlan'|'leaderCommitment')</c>), TRANSLATED to parameterized SQL
/// (<see cref="ScopePredicateSqlTranslator"/>, reused) and applied as an <c>id = ANY(…)</c> filter so
/// out-of-scope rows silently drop — the C# analog of the Prisma <c>AND [{…}, scopeWhere]</c>.
/// </summary>
public interface IEngagementReadRepository
{
    /// <summary>listSurveys: org + optional status, createdAt desc, page/limit — the raw rows + org total.</summary>
    Task<SurveyListPage> ListSurveysAsync(
        string organizationId, string? status, int page, int limit, CancellationToken cancellationToken);

    /// <summary>getSurveyResults: org + surveyId → survey scalars + each response's answers (or null if absent).</summary>
    Task<SurveyResultsData?> GetSurveyResultsDataAsync(
        string organizationId, Guid surveyId, CancellationToken cancellationToken);

    /// <summary>myPendingSurveys: OWN self-service — active-window surveys the caller has NOT answered (anti-join).</summary>
    Task<IReadOnlyList<PendingSurveyRow>> GetPendingSurveysAsync(
        string organizationId, Guid userId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>getSurveyForResponse: OWN self-service — the renderable active-window survey (or null → 404).</summary>
    Task<SurveyForResponseView?> GetSurveyForResponseAsync(
        string organizationId, Guid surveyId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>getEnps: org + surveys of type 'enps' + submittedAt ≥ since → each response's answers.</summary>
    Task<IReadOnlyList<System.Text.Json.Nodes.JsonObject>> GetEnpsAnswersAsync(
        string organizationId, DateTimeOffset since, CancellationToken cancellationToken);

    /// <summary>getClimateHeatmap: org + type 'climate' (+ optional id), createdAt desc, take 1 → survey + answers,
    /// or null when the org has no climate survey.</summary>
    Task<ClimateSurveyData?> GetClimateHeatmapDataAsync(
        string organizationId, Guid? surveyId, CancellationToken cancellationToken);

    /// <summary>getResultsByArea: org + surveyId → the responses' answers + user area anchors (or null → not found).</summary>
    Task<AreaSurveyData?> GetResultsByAreaDataAsync(
        string organizationId, Guid surveyId, CancellationToken cancellationToken);

    /// <summary>getLowClimateAlerts: org + module='engagement' + status='active', createdAt desc.</summary>
    Task<IReadOnlyList<AlertRow>> GetLowClimateAlertsAsync(
        string organizationId, CancellationToken cancellationToken);

    /// <summary>listActionPlans: org + optional status + <c>scopeWhereFor('actionPlan')</c> row filter, createdAt
    /// desc, + the responsible user.</summary>
    Task<IReadOnlyList<ActionPlanRow>> ListActionPlansAsync(
        string organizationId, string? status, ScopePredicate scope, CancellationToken cancellationToken);

    /// <summary>listLeaderCommitments: org + optional leaderId/status + <c>scopeWhereFor('leaderCommitment')</c>
    /// row filter, dueDate asc, + the leader user.</summary>
    Task<IReadOnlyList<LeaderCommitmentRow>> ListLeaderCommitmentsAsync(
        string organizationId, Guid? leaderId, string? status, ScopePredicate scope, CancellationToken cancellationToken);

    /// <summary>getDashboardKpis: active surveys + total responses + per-survey response counts + open action plans.</summary>
    Task<EngagementKpiData> GetDashboardKpiDataAsync(
        string organizationId, CancellationToken cancellationToken);

    /// <summary>getRotationRisk: the active user head-count (+ optional company/business-unit filter).</summary>
    Task<int> GetActiveUserCountAsync(
        string organizationId, Guid? companyId, Guid? businessUnitId, CancellationToken cancellationToken);
}
