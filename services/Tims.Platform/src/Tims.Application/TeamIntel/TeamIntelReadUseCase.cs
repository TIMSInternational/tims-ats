using Tims.Domain.Access;
using Tims.Domain.TeamIntel;

namespace Tims.Application.TeamIntel;

/// <summary>
/// The team-intel READ use case — infra-free orchestration, a faithful port of the <c>teamIntel</c> router
/// bodies. Each method calls the repository (which runs UNDER TenantScope/RLS + explicit org) and, where the
/// TS body shapes the rows, returns the pure <c>Tims.Domain.TeamIntel</c> kernel output. A single
/// ms-truncated <c>now</c> is injected into the balance/comparison/KPI kernels — matching JS
/// <c>Date.now()</c> (integer ms), as the reporting slice does — so the read is deterministic per request.
/// </summary>
public sealed class TeamIntelReadUseCase(ITeamIntelReadRepository repository)
{
    private readonly ITeamIntelReadRepository _repository = repository;

    public Task<TeamProfileView?> GetTeamProfileAsync(
        string organizationId, Guid teamId, CancellationToken cancellationToken) =>
        _repository.GetTeamProfileAsync(organizationId, teamId, cancellationToken);

    public Task<IReadOnlyList<TeamMemberView>> GetMembersAsync(
        string organizationId, Guid teamId, CancellationToken cancellationToken) =>
        _repository.GetMembersAsync(organizationId, teamId, cancellationToken);

    public async Task<BalanceScoreResponse> GetBalanceScoreAsync(
        string organizationId, Guid teamId, CancellationToken cancellationToken)
    {
        var members = await _repository.GetBalanceMembersAsync(organizationId, teamId, cancellationToken).ConfigureAwait(false);
        var view = BalanceScoreBuilder.Build(members, NowMs());
        return new BalanceScoreResponse(
            teamId.ToString(),
            view.MemberCount,
            view.UniqueRoles,
            view.RoleDiversity,
            view.AvgTenureMonths,
            view.SizeScore,
            view.BalanceScore);
    }

    public async Task<TeamComparisonView> GetComparisonAsync(
        string organizationId, ScopePredicate scopeWhere, IReadOnlyList<Guid> teamIds, CancellationToken cancellationToken)
    {
        var teams = await _repository.GetComparisonTeamsAsync(organizationId, scopeWhere, teamIds, cancellationToken).ConfigureAwait(false);
        return TeamComparisonBuilder.Build(teams, NowMs());
    }

    public async Task<DashboardKpiView> GetDashboardKpisAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetDashboardKpiDataAsync(organizationId, cancellationToken).ConfigureAwait(false);

        var avgTeamSize = data.TotalTeams > 0
            ? ReportingMathTeamSize(data.TotalMembers, data.TotalTeams)
            : 0d;

        return new DashboardKpiView(
            data.TotalTeams,
            data.TotalMembers,
            data.TeamsWithLeader,
            data.TotalTeams - data.TeamsWithLeader,
            avgTeamSize,
            TeamIntelMetrics.ComputeAvgTenureYears(data.MemberCreatedAtMs, NowMs()),
            TeamIntelMetrics.ComputeRoleDiversity(data.MemberJobTitles));
    }

    // avgTeamSize = round((totalMembers / totalTeams) * 10) / 10 — one decimal, JS half-up (Floor(x+0.5)).
    private static double ReportingMathTeamSize(int totalMembers, int totalTeams) =>
        Tims.Domain.Reporting.ReportingMath.JsRound((double)totalMembers / totalTeams * 10) / 10d;

    // Current UTC time as epoch-milliseconds (matching JS Date.now() integer-ms), injected into the kernels.
    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
