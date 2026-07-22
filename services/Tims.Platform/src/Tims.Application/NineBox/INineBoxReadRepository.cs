using Tims.Domain.Access;
using Tims.Domain.NineBox;

namespace Tims.Application.NineBox;

/// <summary>
/// Read port for the nine-box surface — a faithful port of the READ bodies of
/// <c>packages/api/src/routers/ninebox.ts</c> (the 11 reads; the 6 writes are NOT ported). Every method, in
/// the infrastructure implementation, runs <c>AsNoTracking</c> UNDER <c>TenantScope</c> (SET LOCAL ROLE
/// app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth).
///
/// The two row-scoped reads (#1 getGrid, #4 getMovementHistory) take the caller's
/// <see cref="ScopePredicate"/> (from <c>scopeWhereFor('nineBoxEvaluation')</c>): it is TRANSLATED to
/// parameterized SQL (<see cref="ScopePredicateSqlTranslator"/>, reused not re-ported) and applied as an
/// <c>id IN (…)</c> filter so out-of-scope nine_box_evaluations rows silently drop — the C# analog of the
/// Prisma <c>AND [{…}, scopeWhere]</c>. The subject reads (#2/#3) are gated UPSTREAM by
/// <c>assertSubjectInScope</c>; the calibration reads (#6/#7/#8) carry their OWN gate (org-gate / hand-rolled
/// membership / created-by-OR-member) at the endpoint — calibrationSession is NOT a registered scope entity.
/// </summary>
public interface INineBoxReadRepository
{
    /// <summary>getGrid: org + period + the (teamId|unitId|companyId) userId intersect +
    /// <c>scopeWhereFor('nineBoxEvaluation')</c> row filter → evaluations (evaluatedAt desc) + user. The use
    /// case runs the pure gridPlacement kernel over these.</summary>
    Task<IReadOnlyList<GridEvaluation>> GetGridEvaluationsAsync(
        string organizationId,
        string period,
        GridFilter filter,
        ScopePredicate scope,
        CancellationToken cancellationToken);

    /// <summary>getEmployeeDetail point-read: org + userId + period (findFirst → may be null) + user (email).</summary>
    Task<EmployeeDetailEvaluation?> GetEmployeeEvaluationAsync(
        string organizationId,
        Guid userId,
        string period,
        CancellationToken cancellationToken);

    /// <summary>getEmployeeDetail history: all periods for the user, evaluatedAt asc, minimal select.</summary>
    Task<IReadOnlyList<EmployeeHistoryRow>> GetEmployeeHistoryAsync(
        string organizationId,
        Guid userId,
        CancellationToken cancellationToken);

    /// <summary>getAxisBreakdown: org + userId + period (findFirstOrThrow) → null when absent (endpoint 404s).</summary>
    Task<AxisBreakdownView?> GetAxisBreakdownAsync(
        string organizationId,
        Guid userId,
        string period,
        CancellationToken cancellationToken);

    /// <summary>getMovementHistory: org + userId/companyId intersect + <c>scopeWhereFor('nineBoxEvaluation')</c>
    /// row filter → PRE-ORDERED (userId asc, evaluatedAt asc) movement inputs for the pure computeMovements
    /// kernel.</summary>
    Task<IReadOnlyList<Domain.NineBox.MovementEvalInput>> GetMovementInputsAsync(
        string organizationId,
        MovementFilter filter,
        ScopePredicate scope,
        CancellationToken cancellationToken);

    /// <summary>listCalibrations: all org sessions, createdAt desc, take 100, + <c>_count.members</c>.</summary>
    Task<IReadOnlyList<CalibrationListRow>> ListCalibrationsAsync(
        string organizationId,
        CancellationToken cancellationToken);

    /// <summary>getCalibration narrow-scope gate probe: the in-org session's { id, createdById } or null (404).</summary>
    Task<CalibrationSessionAnchor?> GetCalibrationAnchorAsync(
        string organizationId,
        Guid sessionId,
        CancellationToken cancellationToken);

    /// <summary>getCalibration membership check: does a calibration_members row exist for (sessionId, userId)?
    /// Runs under the caller's org TenantScope (RLS on calibration_members joins the in-org session).</summary>
    Task<bool> IsCalibrationMemberAsync(
        string organizationId,
        Guid sessionId,
        Guid userId,
        CancellationToken cancellationToken);

    /// <summary>getCalibration full loader: the in-org session + creator + members(+user) + votes(+eval/voter).</summary>
    Task<CalibrationDetailView?> GetCalibrationAsync(
        string organizationId,
        Guid sessionId,
        CancellationToken cancellationToken);

    /// <summary>myCalibrations: the caller's sessions (createdBy OR member), createdAt desc, take 100,
    /// + <c>_count.{members,votes}</c>.</summary>
    Task<IReadOnlyList<MyCalibrationRow>> MyCalibrationsAsync(
        string organizationId,
        Guid callerId,
        CancellationToken cancellationToken);

    /// <summary>getBenchStrength / getDashboardKpis input: the org+period quadrant strings (for the kernels).</summary>
    Task<IReadOnlyList<string>> GetPeriodQuadrantsAsync(
        string organizationId,
        string period,
        CancellationToken cancellationToken);

    /// <summary>getDashboardKpis counts: evaluations + total sessions + active (status != 'finalized') sessions.</summary>
    Task<NineBoxKpiCounts> GetKpiCountsAsync(
        string organizationId,
        string period,
        CancellationToken cancellationToken);
}
