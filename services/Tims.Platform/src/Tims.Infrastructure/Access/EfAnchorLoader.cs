using Microsoft.EntityFrameworkCore;
using Tims.Domain.Access;

namespace Tims.Infrastructure.Access;

/// <summary>
/// The EF-backed, request-local port of <c>createAnchorLoader(organizationId, userId)</c>
/// (packages/api/src/access/anchors.ts). Each anchor method runs its query inside a
/// <see cref="TenantScope"/> unit of work (the C# analog of a per-op <c>tenantDb</c> transaction):
/// <c>SET LOCAL ROLE app_tenant</c> + org GUC engage RLS, and the queries ALSO carry explicit
/// <c>organization_id</c> filters (defense in depth, api-security.md).
///
/// SECURITY / memoization: each method's <see cref="Task{TResult}"/> is cached in a field and
/// computed at most once per instance. A rejected load stays memoized (re-await re-throws) —
/// deliberate: consistent fail-closed denial beats inconsistent retry. The loader must NEVER be
/// cached across requests (a revoked leader/hrbp/evaluator must lose access next request), so
/// <see cref="EfAnchorLoaderFactory"/> mints a fresh instance (with its own context) per request.
///
/// Floor semantics (ported verbatim from anchors.ts):
/// <list type="bullet">
///   <item><description><see cref="TeamMemberIdsAsync"/> floors to <c>[self]</c> (keeps team ⊇ own).</description></item>
///   <item><description><see cref="LedTeamIdsAsync"/> / <see cref="UnitIdsAsync"/> / <see cref="PanelInterviewIdsAsync"/> / <see cref="UnitMemberIdsAsync"/> floor to <c>[]</c>.</description></item>
/// </list>
/// </summary>
public sealed class EfAnchorLoader(AnchorDbContext db, Guid organizationId, Guid userId)
    : IAnchorLoader, IAsyncDisposable
{
    private Task<IReadOnlyList<string>>? _teamMembers;
    private Task<IReadOnlyList<string>>? _unitIds;
    private Task<IReadOnlyList<string>>? _panelInterviewIds;
    private Task<IReadOnlyList<string>>? _ledTeamIds;
    private Task<IReadOnlyList<string>>? _unitMemberIds;

    public Task<IReadOnlyList<string>> TeamMemberIdsAsync(CancellationToken ct = default) =>
        _teamMembers ??= LoadTeamMembersAsync(ct);

    public Task<IReadOnlyList<string>> UnitIdsAsync(CancellationToken ct = default) =>
        _unitIds ??= LoadUnitIdsAsync(ct);

    public Task<IReadOnlyList<string>> PanelInterviewIdsAsync(CancellationToken ct = default) =>
        _panelInterviewIds ??= LoadPanelInterviewIdsAsync(ct);

    public Task<IReadOnlyList<string>> LedTeamIdsAsync(CancellationToken ct = default) =>
        _ledTeamIds ??= LoadLedTeamIdsAsync(ct);

    public Task<IReadOnlyList<string>> UnitMemberIdsAsync(CancellationToken ct = default) =>
        _unitMemberIds ??= LoadUnitMemberIdsAsync(ct);

    // ledTeamIds: TEAM ids the user leads. Floor [] — a team-scope grant with no led teams
    // matches no team rows (user-anchored OR-arms still apply elsewhere).
    private async Task<IReadOnlyList<string>> LoadLedTeamIdsAsync(CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var ids = await db.Teams.AsNoTracking()
            .Where(t => t.OrganizationId == organizationId && t.LeaderId == userId && t.IsActive)
            .Select(t => t.Id)
            .ToListAsync(ct);
        await scope.CommitAsync(ct);
        return ids.Select(id => id.ToString()).ToList();
    }

    // teamMemberIds: user ids in the teams the caller leads. Floor is [self], NOT []: keeps
    // team ⊇ own; a team-scope grant with no led teams degrades to own-scope (fail-narrow).
    // The led-teams query is inlined (mirrors anchors.ts — it does NOT reuse ledTeamIds()).
    private async Task<IReadOnlyList<string>> LoadTeamMembersAsync(CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var led = await db.Teams.AsNoTracking()
            .Where(t => t.OrganizationId == organizationId && t.LeaderId == userId && t.IsActive)
            .Select(t => t.Id)
            .ToListAsync(ct);

        if (led.Count == 0)
        {
            await scope.CommitAsync(ct);
            return new List<string> { userId.ToString() };
        }

        var members = await db.UserTeams.AsNoTracking()
            .Where(ut => led.Contains(ut.TeamId))
            .Select(ut => ut.UserId)
            .ToListAsync(ct);
        await scope.CommitAsync(ct);

        // [...new Set([userId, ...members])] — self first, then members deduped, order preserved.
        var ordered = new List<string> { userId.ToString() };
        var seen = new HashSet<Guid> { userId };
        foreach (var member in members)
        {
            if (seen.Add(member))
            {
                ordered.Add(member.ToString());
            }
        }

        return ordered;
    }

    // unitIds: business-unit ids the caller is assigned to (active units only). Floor [].
    private async Task<IReadOnlyList<string>> LoadUnitIdsAsync(CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var ids = await db.UserBusinessUnits.AsNoTracking()
            .Where(ubu => ubu.OrganizationId == organizationId
                && ubu.UserId == userId
                && db.BusinessUnits.Any(bu => bu.Id == ubu.BusinessUnitId && bu.IsActive))
            .Select(ubu => ubu.BusinessUnitId)
            .ToListAsync(ct);
        await scope.CommitAsync(ct);
        return ids.Select(id => id.ToString()).ToList();
    }

    // panelInterviewIds: interview ids where the caller is an assigned evaluator. Floor [].
    // Org isolation enforced BOTH app-level (interview.organizationId) and by RLS — defense in depth.
    private async Task<IReadOnlyList<string>> LoadPanelInterviewIdsAsync(CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var ids = await db.InterviewEvaluators.AsNoTracking()
            .Where(ie => ie.UserId == userId
                && db.Interviews.Any(i => i.Id == ie.InterviewId && i.OrganizationId == organizationId))
            .Select(ie => ie.InterviewId)
            .ToListAsync(ct);
        await scope.CommitAsync(ct);
        return ids.Select(id => id.ToString()).ToList();
    }

    // unitMemberIds: every user in the caller's assigned units — via the direct User.businessUnitId
    // FK OR membership in a team of that unit (both forms exist; union + dedupe). Floor []. Reuses
    // the memoized unitIds() so units load at most once per request.
    private async Task<IReadOnlyList<string>> LoadUnitMemberIdsAsync(CancellationToken ct)
    {
        var units = await UnitIdsAsync(ct);
        if (units.Count == 0)
        {
            return [];
        }

        var unitGuids = units.Select(Guid.Parse).ToArray();

        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var users = await db.Users.AsNoTracking()
            .Where(u => u.OrganizationId == organizationId
                && ((u.BusinessUnitId != null && unitGuids.Contains(u.BusinessUnitId.Value))
                    || db.UserTeams.Any(ut => ut.UserId == u.Id
                        && db.Teams.Any(t => t.Id == ut.TeamId
                            && t.BusinessUnitId != null
                            && unitGuids.Contains(t.BusinessUnitId.Value)))))
            .Select(u => u.Id)
            .ToListAsync(ct);
        await scope.CommitAsync(ct);

        var ordered = new List<string>();
        var seen = new HashSet<Guid>();
        foreach (var user in users)
        {
            if (seen.Add(user))
            {
                ordered.Add(user.ToString());
            }
        }

        return ordered;
    }

    public ValueTask DisposeAsync() => db.DisposeAsync();
}
