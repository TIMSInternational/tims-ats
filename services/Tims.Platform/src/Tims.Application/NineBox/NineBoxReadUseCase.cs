using Tims.Domain.Access;
using Tims.Domain.NineBox;

namespace Tims.Application.NineBox;

/// <summary>
/// The nine-box READ use case — infra-free orchestration, a faithful port of the 11 read bodies of the TS
/// <c>ninebox</c> router. The raw-model reads (#2/#3/#6/#7/#8) pass the repository rows straight through; the
/// kernel reads run the pure <see cref="NineBoxKernels"/> (golden-parity with @tims/shared): #1 gridPlacement,
/// #4 computeMovements, #5 simulateBands, #9 resolveQuadrantPlan, #10 buildBenchStrength, #11 distribution. No
/// clock, no scope logic here (the endpoint owns the anchor loader + assertSubjectInScope/scopeWhereFor / the
/// hand-rolled calibration gate); the use case only threads the resolved <see cref="ScopePredicate"/> to the repo.
/// </summary>
public sealed class NineBoxReadUseCase(INineBoxReadRepository repository)
{
    private readonly INineBoxReadRepository _repository = repository;

    // #1 getGrid: repo evaluations (evaluatedAt desc) → pure gridPlacement (order preserved within/across cells).
    public async Task<GridView> GetGridAsync(
        string organizationId,
        string period,
        GridFilter filter,
        ScopePredicate scope,
        CancellationToken cancellationToken)
    {
        var evaluations = await _repository
            .GetGridEvaluationsAsync(organizationId, period, filter, scope, cancellationToken)
            .ConfigureAwait(false);
        var grid = NineBoxKernels.GridPlacement(evaluations, e => e.Quadrant);
        return new GridView(period, grid, evaluations.Count);
    }

    // #2 getEmployeeDetail: (nullable) evaluation + cross-period history.
    public async Task<EmployeeDetailView> GetEmployeeDetailAsync(
        string organizationId,
        Guid userId,
        string period,
        CancellationToken cancellationToken)
    {
        var evaluation = await _repository
            .GetEmployeeEvaluationAsync(organizationId, userId, period, cancellationToken)
            .ConfigureAwait(false);
        var history = await _repository
            .GetEmployeeHistoryAsync(organizationId, userId, cancellationToken)
            .ConfigureAwait(false);
        return new EmployeeDetailView(evaluation, history);
    }

    // #3 getAxisBreakdown: null → the endpoint maps to 404 (findFirstOrThrow parity).
    public Task<AxisBreakdownView?> GetAxisBreakdownAsync(
        string organizationId,
        Guid userId,
        string period,
        CancellationToken cancellationToken) =>
        _repository.GetAxisBreakdownAsync(organizationId, userId, period, cancellationToken);

    // #4 getMovementHistory: repo pre-ordered inputs → pure computeMovements.
    public async Task<MovementHistoryView> GetMovementHistoryAsync(
        string organizationId,
        MovementFilter filter,
        ScopePredicate scope,
        CancellationToken cancellationToken)
    {
        var inputs = await _repository
            .GetMovementInputsAsync(organizationId, filter, scope, cancellationToken)
            .ConfigureAwait(false);
        var movements = NineBoxKernels.ComputeMovements(inputs);
        return new MovementHistoryView(movements, movements.Count);
    }

    // #5 simulate: PURE — band thresholds → quadrant map + the _stub marker.
    public static SimulateView Simulate(string userId, double newPotentialScore, double newPerformanceScore)
    {
        var bands = NineBoxKernels.SimulateBands(newPotentialScore, newPerformanceScore);
        return new SimulateView(userId, bands.SimulatedQuadrant, bands.PotentialBand, bands.PerformanceBand, true);
    }

    // #9 getQuadrantPlan: PURE — catalog lookup with the fixed fallback.
    public static QuadrantPlanResult GetQuadrantPlan(string quadrant) =>
        NineBoxKernels.ResolveQuadrantPlan(quadrant);

    // #6 listCalibrations.
    public Task<IReadOnlyList<CalibrationListRow>> ListCalibrationsAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        _repository.ListCalibrationsAsync(organizationId, cancellationToken);

    // #7 getCalibration hand-rolled gate helpers + full loader (the endpoint owns the gate decision).
    public Task<CalibrationSessionAnchor?> GetCalibrationAnchorAsync(
        string organizationId,
        Guid sessionId,
        CancellationToken cancellationToken) =>
        _repository.GetCalibrationAnchorAsync(organizationId, sessionId, cancellationToken);

    public Task<bool> IsCalibrationMemberAsync(
        string organizationId,
        Guid sessionId,
        Guid userId,
        CancellationToken cancellationToken) =>
        _repository.IsCalibrationMemberAsync(organizationId, sessionId, userId, cancellationToken);

    public Task<CalibrationDetailView?> GetCalibrationAsync(
        string organizationId,
        Guid sessionId,
        CancellationToken cancellationToken) =>
        _repository.GetCalibrationAsync(organizationId, sessionId, cancellationToken);

    // #8 myCalibrations.
    public Task<IReadOnlyList<MyCalibrationRow>> MyCalibrationsAsync(
        string organizationId,
        Guid callerId,
        CancellationToken cancellationToken) =>
        _repository.MyCalibrationsAsync(organizationId, callerId, cancellationToken);

    // #10 getBenchStrength: repo quadrants → pure buildBenchStrength + period wrap.
    public async Task<BenchStrengthView> GetBenchStrengthAsync(
        string organizationId,
        string period,
        CancellationToken cancellationToken)
    {
        var quadrants = await _repository
            .GetPeriodQuadrantsAsync(organizationId, period, cancellationToken)
            .ConfigureAwait(false);
        var bench = NineBoxKernels.BuildBenchStrength(quadrants);
        return new BenchStrengthView(period, bench.Total, bench.Distribution, bench.HighPotentialRatio, bench.BenchStrength);
    }

    // #11 getDashboardKpis: repo counts + quadrants → pure distribution.
    public async Task<DashboardKpisView> GetDashboardKpisAsync(
        string organizationId,
        string period,
        CancellationToken cancellationToken)
    {
        var counts = await _repository
            .GetKpiCountsAsync(organizationId, period, cancellationToken)
            .ConfigureAwait(false);
        var quadrants = await _repository
            .GetPeriodQuadrantsAsync(organizationId, period, cancellationToken)
            .ConfigureAwait(false);
        var distribution = NineBoxKernels.BuildQuadrantDistribution(quadrants);
        return new DashboardKpisView(
            period, counts.TotalEvaluations, counts.CalibrationSessions, counts.ActiveCalibrations, distribution);
    }
}
