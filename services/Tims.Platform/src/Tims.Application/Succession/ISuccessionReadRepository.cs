using Tims.Domain.Access;
using Tims.Domain.Succession;

namespace Tims.Application.Succession;

/// <summary>
/// Read port for the succession surface — a faithful port of the READ bodies of
/// <c>packages/api/src/routers/succession.ts</c> (the nine reads; the five writes are NOT ported). Every
/// method, in the infrastructure implementation, runs <c>AsNoTracking</c> UNDER <c>TenantScope</c> (SET LOCAL
/// ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth).
///
/// The row-scoped reads take the caller's <see cref="ScopePredicate"/> (from <c>scopeWhereFor</c>): it is
/// TRANSLATED to parameterized SQL (<see cref="ScopePredicateSqlTranslator"/>, reused not re-ported) and
/// applied as an <c>id IN (…)</c> filter so out-of-scope critical_roles / successors / nine_box_evaluations
/// rows silently drop — the C# analog of the Prisma <c>AND [{…}, scopeWhere]</c>. The by-id reads
/// (getCriticalRole / getSuggestedSuccessors / simulateExit) are gated UPSTREAM by the
/// <c>assertScoped('criticalRole')</c> IDOR probe in the endpoint.
/// </summary>
public interface ISuccessionReadRepository
{
    /// <summary>listCriticalRoles: org + filter + <c>scopeWhereFor('criticalRole')</c> roles, each with its
    /// <c>scopeWhereFor('successor')</c>-filtered successors (roles title asc, successors createdAt asc).</summary>
    Task<IReadOnlyList<ListCriticalRoleRow>> ListCriticalRolesAsync(
        string organizationId,
        CriticalRoleFilters filters,
        ScopePredicate roleScope,
        ScopePredicate successorScope,
        CancellationToken cancellationToken);

    /// <summary>getCriticalRole: one in-org role (probed upstream) + holder (with email) + its
    /// <c>scopeWhereFor('successor')</c>-filtered successors (+ addedByUser). Null if it vanished post-probe.</summary>
    Task<CriticalRoleDetailRow?> GetCriticalRoleAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate successorScope,
        CancellationToken cancellationToken);

    /// <summary>getFlightRisk: org roles with flightRisk ≥ threshold + holder + <c>_count.successors</c>
    /// (flightRisk desc). Org-rollup — gated by the org-scope gate upstream.</summary>
    Task<IReadOnlyList<FlightRiskRow>> GetFlightRiskAsync(
        string organizationId,
        double threshold,
        CancellationToken cancellationToken);

    /// <summary>getCompetencyCoverage input: every org role + its successors' readiness (org-rollup).</summary>
    Task<IReadOnlyList<CoverageRoleInput>> GetCoverageRolesAsync(
        string organizationId,
        CancellationToken cancellationToken);

    /// <summary>getRolesWithoutSuccessor: org roles with NO successor + holder (criticality asc).</summary>
    Task<IReadOnlyList<RoleWithoutSuccessorRow>> GetRolesWithoutSuccessorAsync(
        string organizationId,
        CancellationToken cancellationToken);

    /// <summary>getDashboardKpis input: the six org counts feeding the KPI rollup.</summary>
    Task<SuccessionKpiCounts> GetDashboardCountsAsync(
        string organizationId,
        CancellationToken cancellationToken);

    /// <summary>getCompGapAlerts input: candidate roles (targetBandLevel set + ≥1 ready_now successor),
    /// their matched salary bands, and the ready_now successors' compensations. <paramref name="includeCurrentSalary"/>
    /// / <paramref name="includeCurrency"/> come from <c>selectFor(roles,'employeeCompensation')</c> — when false
    /// the restricted field is NOT selected (never null-ed), so the kernel skips that successor.
    /// <paramref name="compScope"/> is <c>scopeWhereFor('employeeCompensation')</c> — applied as an extra AND
    /// ROW filter so a narrow compensation:read caller never reads org-wide comp rows (MatchAll → TRUE no-op).</summary>
    Task<CompGapData> GetCompGapDataAsync(
        string organizationId,
        bool includeCurrentSalary,
        bool includeCurrency,
        ScopePredicate compScope,
        CancellationToken cancellationToken);

    /// <summary>getSuggestedSuccessors input: the caller's <c>scopeWhereFor('nineBoxEvaluation')</c>-filtered
    /// evaluations (evaluatedAt desc, createdAt desc) + the userIds already a successor for the role.</summary>
    Task<SuggestedData> GetSuggestedDataAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate evaluationScope,
        CancellationToken cancellationToken);

    /// <summary>simulateExit input: the in-org role (probed upstream) + holder + its
    /// <c>scopeWhereFor('successor')</c>-filtered successors (readiness asc). Null if it vanished post-probe.</summary>
    Task<ExitData?> GetSimulateExitDataAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate successorScope,
        CancellationToken cancellationToken);
}
