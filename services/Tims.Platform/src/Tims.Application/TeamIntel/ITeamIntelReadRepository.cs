using Tims.Domain.Access;
using Tims.Domain.TeamIntel;

namespace Tims.Application.TeamIntel;

/// <summary>
/// Read port for the team-intel surface — a faithful port of the <c>teamIntel</c> router's data steps.
/// Every method, in the infrastructure implementation, runs <c>AsNoTracking</c> UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT
/// <c>organizationId</c> filter (defense-in-depth). The by-id endpoints (profile/members/balance) are
/// additionally gated by the <c>assertScoped('team')</c> IDOR probe BEFORE these run; the compare read
/// composes the caller's <c>scopeWhereFor('team')</c> fragment so out-of-scope ids silently drop.
/// Timestamps are returned as epoch-milliseconds for the pure kernels.
/// </summary>
public interface ITeamIntelReadRepository
{
    /// <summary>getTeamProfile: the org-filtered team + leader/businessUnit/members + vacancy/okr counts, or
    /// null when the team does not exist in the org (→ NOT_FOUND at the caller).</summary>
    Task<TeamProfileView?> GetTeamProfileAsync(string organizationId, Guid teamId, CancellationToken cancellationToken);

    /// <summary>getMembers: the team's membership rows (user select incl. email + createdAt), joinedAt asc.</summary>
    Task<IReadOnlyList<TeamMemberView>> GetMembersAsync(string organizationId, Guid teamId, CancellationToken cancellationToken);

    /// <summary>getBalanceScore input: the team members' jobTitle + createdAt (epoch-ms) for the balance kernel.</summary>
    Task<IReadOnlyList<BalanceScoreMember>> GetBalanceMembersAsync(string organizationId, Guid teamId, CancellationToken cancellationToken);

    /// <summary>compareTeams input: the teams in <c>teamIds ∩ scope ∩ org</c> (out-of-scope ids dropped by the
    /// translated <paramref name="scopeWhere"/> fragment), each with members + leader + vacancy/okr counts.</summary>
    Task<IReadOnlyList<TeamComparisonInput>> GetComparisonTeamsAsync(
        string organizationId, ScopePredicate scopeWhere, IReadOnlyList<Guid> teamIds, CancellationToken cancellationToken);

    /// <summary>getDashboardKpis input: org-wide team/member/leader counts + the active headcount's
    /// createdAt (epoch-ms) + jobTitle for the tenure/diversity kernels.</summary>
    Task<DashboardKpiData> GetDashboardKpiDataAsync(string organizationId, CancellationToken cancellationToken);
}
