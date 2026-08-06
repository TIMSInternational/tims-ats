using Tims.Domain.Access;

namespace Tims.Application.Monitoring;

/// <summary>
/// Read port for the monitoring surface — the C# port of the six READ procedures on
/// <c>packages/api/src/routers/monitoring.ts</c> (Phase-5 Q0b slice 1, issue #100).
///
/// Every method, in the infrastructure implementation, runs <c>AsNoTracking</c> UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → Postgres RLS) AND carries an
/// EXPLICIT <c>organization_id</c> filter (defense-in-depth), exactly as the TS reader filters on
/// <c>ctx.user.organizationId</c> under <c>tenantDb</c>.
///
/// The two writes on that router (<c>dismissAlert</c>, <c>configureAlertRules</c>) are deliberately
/// NOT here — see <c>MonitoringReadEndpoints</c> for why they are a separate write slice.
///
/// All boundary <c>DateTime</c>s are Unspecified-kind wall-clock UTC, matching the Prisma
/// <c>timestamp(3) without time zone</c> columns these queries compare against.
/// </summary>
public interface IMonitoringReadRepository
{
    /// <summary>getExecutiveKpis: the five raw counts, pre-suppression (the floor is applied in the use case).</summary>
    Task<ExecutiveKpiCounts> GetExecutiveKpiCountsAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getModuleHealth: ACTIVE alert counts grouped by module (sparse — modules with no alert are absent).</summary>
    Task<IReadOnlyDictionary<string, int>> GetActiveAlertCountsByModuleAsync(
        string organizationId, CancellationToken cancellationToken);

    /// <summary>getActiveAlerts: one page of ACTIVE alerts (severity desc, createdAt desc) plus the total.</summary>
    Task<ActiveAlertsPage> GetActiveAlertsAsync(
        string organizationId, string? module, string? severity, int page, int limit, CancellationToken cancellationToken);

    /// <summary>
    /// getActionPlanAlerts: non-completed action plans due on or before <paramref name="horizon"/>, filtered to
    /// the caller's row scope by the translated <paramref name="scopeWhere"/> fragment, ordered by dueDate asc.
    /// </summary>
    Task<IReadOnlyList<ActionPlanAlertView>> GetActionPlanAlertsAsync(
        string organizationId, ScopePredicate scopeWhere, DateTime horizon, CancellationToken cancellationToken);

    /// <summary>getCrossModuleTrend, engagement branch: per-month <c>survey_responses</c> counts (window order).</summary>
    Task<IReadOnlyList<int>> GetSurveyResponseCountsAsync(
        string organizationId, IReadOnlyList<(DateTime Start, DateTime End)> window, CancellationToken cancellationToken);

    /// <summary>getCrossModuleTrend, headcount branch: ACTIVE users created on or before each month's END bound
    /// (a cumulative count — NOT a per-month bucket; matches the TS <c>createdAt: { lte: monthEnd }</c>).</summary>
    Task<IReadOnlyList<int>> GetHeadcountCountsAsync(
        string organizationId, IReadOnlyList<(DateTime Start, DateTime End)> window, CancellationToken cancellationToken);

    /// <summary>getCrossModuleTrend, alerts branch: alerts CREATED within each month bucket (all statuses).</summary>
    Task<IReadOnlyList<int>> GetAlertCountsAsync(
        string organizationId, IReadOnlyList<(DateTime Start, DateTime End)> window, CancellationToken cancellationToken);

    /// <summary>getAlertRules: every alert rule in the org, ordered by module asc.</summary>
    Task<IReadOnlyList<AlertRuleView>> GetAlertRulesAsync(string organizationId, CancellationToken cancellationToken);
}
