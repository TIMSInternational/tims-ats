using Tims.Domain.Access;
using Tims.Domain.Succession;

namespace Tims.Application.Succession;

/// <summary>
/// The succession READ use case — infra-free orchestration, a faithful port of the nine read bodies of the
/// TS <c>succession</c> router. Reads 1/2/3/5 pass the repository's raw-model rows straight through; reads
/// 4/6/7/8/9 run the pure <see cref="SuccessionKernels"/> (golden-parity with @tims/shared). No clock, no
/// scope logic here (the endpoint owns the anchor loader + assertScoped/scopeWhereFor); the use case only
/// threads the resolved <see cref="ScopePredicate"/> to the repo.
/// </summary>
public sealed class SuccessionReadUseCase(ISuccessionReadRepository repository)
{
    private readonly ISuccessionReadRepository _repository = repository;

    public Task<IReadOnlyList<ListCriticalRoleRow>> ListCriticalRolesAsync(
        string organizationId,
        CriticalRoleFilters filters,
        ScopePredicate roleScope,
        ScopePredicate successorScope,
        CancellationToken cancellationToken) =>
        _repository.ListCriticalRolesAsync(organizationId, filters, roleScope, successorScope, cancellationToken);

    public Task<CriticalRoleDetailRow?> GetCriticalRoleAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate successorScope,
        CancellationToken cancellationToken) =>
        _repository.GetCriticalRoleAsync(organizationId, criticalRoleId, successorScope, cancellationToken);

    public Task<IReadOnlyList<FlightRiskRow>> GetFlightRiskAsync(
        string organizationId,
        double threshold,
        CancellationToken cancellationToken) =>
        _repository.GetFlightRiskAsync(organizationId, threshold, cancellationToken);

    public async Task<IReadOnlyList<CoverageRow>> GetCompetencyCoverageAsync(
        string organizationId,
        CancellationToken cancellationToken)
    {
        var roles = await _repository.GetCoverageRolesAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return SuccessionKernels.BuildCompetencyCoverage(roles);
    }

    public Task<IReadOnlyList<RoleWithoutSuccessorRow>> GetRolesWithoutSuccessorAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        _repository.GetRolesWithoutSuccessorAsync(organizationId, cancellationToken);

    public async Task<SuccessionKpiView> GetDashboardKpisAsync(
        string organizationId,
        CancellationToken cancellationToken)
    {
        var counts = await _repository.GetDashboardCountsAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return SuccessionKernels.BuildSuccessionKpis(counts);
    }

    /// <summary>Returns the comp-gap alerts AND the exposed comp ids to audit; the endpoint audits those ids
    /// fail-closed BEFORE serializing the alerts. <paramref name="compFields"/> is
    /// <c>selectFor(roles,'employeeCompensation')</c> — its membership decides which restricted fields the repo
    /// selects (an unentitled field is never read, so the kernel skips that successor).</summary>
    public async Task<CompGapResult> GetCompGapAlertsAsync(
        string organizationId,
        IReadOnlyList<string> compFields,
        ScopePredicate compScope,
        CancellationToken cancellationToken)
    {
        var data = await _repository
            .GetCompGapDataAsync(
                organizationId,
                compFields.Contains("currentSalary"),
                compFields.Contains("currency"),
                compScope,
                cancellationToken)
            .ConfigureAwait(false);
        return SuccessionKernels.BuildCompGapAlerts(data.Roles, data.Bands, data.Comps);
    }

    public async Task<IReadOnlyList<SuggestedSuccessor>> GetSuggestedSuccessorsAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate evaluationScope,
        CancellationToken cancellationToken)
    {
        var data = await _repository
            .GetSuggestedDataAsync(organizationId, criticalRoleId, evaluationScope, cancellationToken)
            .ConfigureAwait(false);
        return SuccessionKernels.BuildSuggestedSuccessors(data.Evaluations, data.ExistingUserIds);
    }

    /// <summary>Returns the full simulateExit response, or <c>null</c> if the role vanished after the upstream
    /// probe (the endpoint maps null → NOT_FOUND). The kernel decides risk + recommendation from the
    /// scope-filtered successors; the raw role/holder/successors are assembled around it.</summary>
    public async Task<ExitSimulationView?> SimulateExitAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate successorScope,
        CancellationToken cancellationToken)
    {
        var data = await _repository
            .GetSimulateExitDataAsync(organizationId, criticalRoleId, successorScope, cancellationToken)
            .ConfigureAwait(false);
        if (data is null)
        {
            return null;
        }

        var simulation = SuccessionKernels.BuildExitSimulation(
            data.Successors
                .Select(s => new ExitSuccessorInput(s.Readiness, new ExitSuccessorUser(s.User.FirstName, s.User.LastName)))
                .ToList());

        return new ExitSimulationView(
            data.Role,
            data.Holder,
            simulation.RiskLevel,
            simulation.Recommendation,
            data.Successors,
            simulation.ReadyNowCount,
            simulation.PipelineCount);
    }
}
