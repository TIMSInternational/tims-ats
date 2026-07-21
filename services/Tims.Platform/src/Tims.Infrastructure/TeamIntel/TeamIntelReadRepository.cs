using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using System.Text.Json.Nodes;
using Tims.Application.TeamIntel;
using Tims.Domain.Access;
using Tims.Domain.TeamIntel;

namespace Tims.Infrastructure.TeamIntel;

/// <summary>
/// Read-only EF implementation of <see cref="ITeamIntelReadRepository"/> — a faithful port of the
/// <c>teamIntel</c> router's data steps. Every query is <c>AsNoTracking()</c> and runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS). MOST reads also carry an
/// EXPLICIT <c>organizationId</c> filter as defense-in-depth (teams/leader/business_units/vacancies/okrs);
/// the exception is the <c>user_teams</c> membership join in <see cref="GetMembersAsync"/> (and the profile
/// members include), which filters by <c>teamId</c> only and relies on TenantScope/RLS + the upstream
/// <c>assertScoped('team')</c> probe — <c>user_teams</c> has no <c>organization_id</c> column (matches TS).
/// NEVER logs row content.
///
/// The by-id reads (profile/members/balance) are gated upstream by the <c>assertScoped('team')</c> IDOR
/// probe; the compare read composes the caller's <c>scopeWhereFor('team')</c> fragment, TRANSLATED to SQL
/// via <see cref="ScopePredicateSqlTranslator"/> (reused, not re-ported) and run as an <c>id = ANY</c> filter
/// so out-of-scope teamIds silently drop — the C# analog of the Prisma <c>AND [{ id in }, scopeWhere]</c>.
///
/// Prisma <c>timestamp(3)</c> columns are read as Unspecified-kind wall-clock UTC and converted here — to
/// epoch-milliseconds for the pure kernels, or to a UTC <see cref="DateTimeOffset"/> for the raw wire dates.
/// </summary>
public sealed class TeamIntelReadRepository(TeamIntelReadDbContext db) : ITeamIntelReadRepository
{
    private readonly TeamIntelReadDbContext _db = db;

    public async Task<TeamProfileView?> GetTeamProfileAsync(
        string organizationId, Guid teamId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var team = await _db.Teams.AsNoTracking()
            .Where(t => t.Id == teamId && t.OrganizationId == orgId)
            .Select(t => new
            {
                t.Id,
                t.OrganizationId,
                t.BusinessUnitId,
                t.Name,
                t.LeaderId,
                t.Settings,
                t.IsActive,
                t.CreatedAt,
                t.UpdatedAt,
            })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

        if (team is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        TeamLeaderView? leader = null;
        if (team.LeaderId is { } leaderId)
        {
            leader = await _db.Users.AsNoTracking()
                .Where(u => u.Id == leaderId && u.OrganizationId == orgId)
                .Select(u => new TeamLeaderView(
                    u.Id.ToString(), u.FirstName, u.LastName, u.Avatar, u.JobTitle, u.Email))
                .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        }

        var businessUnit = await _db.BusinessUnits.AsNoTracking()
            .Where(bu => bu.Id == team.BusinessUnitId && bu.OrganizationId == orgId)
            .Select(bu => new TeamBusinessUnitView(bu.Id.ToString(), bu.Name, bu.CompanyId.ToString()))
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

        // getTeamProfile members: user select is NARROWER than getMembers (no email / createdAt). TS applies
        // no orderBy; ordered by joinedAt (then id) here purely for deterministic output — undefined in TS.
        var members = await _db.UserTeams.AsNoTracking()
            .Where(ut => ut.TeamId == teamId)
            .Join(
                _db.Users.AsNoTracking(),
                ut => ut.UserId,
                u => u.Id,
                (ut, u) => new
                {
                    ut.Id,
                    ut.UserId,
                    ut.TeamId,
                    ut.Role,
                    ut.JoinedAt,
                    u.FirstName,
                    u.LastName,
                    u.Avatar,
                    u.JobTitle,
                })
            .OrderBy(x => x.JoinedAt).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var vacancyCount = await _db.Vacancies.AsNoTracking()
            .CountAsync(v => v.TeamId == teamId && v.OrganizationId == orgId, cancellationToken).ConfigureAwait(false);
        var okrCount = await _db.Okrs.AsNoTracking()
            .CountAsync(o => o.TeamId == teamId && o.OrganizationId == orgId, cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new TeamProfileView(
            team.Id.ToString(),
            team.OrganizationId.ToString(),
            team.BusinessUnitId.ToString(),
            team.Name,
            team.LeaderId?.ToString(),
            JsonNode.Parse(team.Settings),
            team.IsActive,
            ToUtc(team.CreatedAt),
            ToUtc(team.UpdatedAt),
            leader,
            businessUnit,
            members.Select(m => new TeamProfileMember(
                m.Id.ToString(),
                m.UserId.ToString(),
                m.TeamId.ToString(),
                m.Role,
                ToUtc(m.JoinedAt),
                new TeamProfileMemberUser(m.UserId.ToString(), m.FirstName, m.LastName, m.Avatar, m.JobTitle))).ToList(),
            new TeamCountView(vacancyCount, okrCount));
    }

    public async Task<IReadOnlyList<TeamMemberView>> GetMembersAsync(
        string organizationId, Guid teamId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // user_teams has no organization_id column → filter by teamId only; isolation comes from
        // TenantScope/RLS + the upstream assertScoped('team') probe (matches the TS getMembers).
        var members = await _db.UserTeams.AsNoTracking()
            .Where(ut => ut.TeamId == teamId)
            .Join(
                _db.Users.AsNoTracking(),
                ut => ut.UserId,
                u => u.Id,
                (ut, u) => new
                {
                    ut.Id,
                    ut.UserId,
                    ut.TeamId,
                    ut.Role,
                    ut.JoinedAt,
                    u.FirstName,
                    u.LastName,
                    u.Avatar,
                    u.JobTitle,
                    u.Email,
                    u.CreatedAt,
                })
            .OrderBy(x => x.JoinedAt).ThenBy(x => x.Id) // TS: orderBy joinedAt asc; id tiebreak = determinism
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return members.Select(m => new TeamMemberView(
            m.Id.ToString(),
            m.UserId.ToString(),
            m.TeamId.ToString(),
            m.Role,
            ToUtc(m.JoinedAt),
            new TeamMemberUserView(
                m.UserId.ToString(), m.FirstName, m.LastName, m.Avatar, m.JobTitle, m.Email, ToUtc(m.CreatedAt)))).ToList();
    }

    public async Task<IReadOnlyList<BalanceScoreMember>> GetBalanceMembersAsync(
        string organizationId, Guid teamId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.UserTeams.AsNoTracking()
            .Where(ut => ut.TeamId == teamId)
            .Join(_db.Users.AsNoTracking(), ut => ut.UserId, u => u.Id, (ut, u) => new { u.JobTitle, u.CreatedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new BalanceScoreMember(r.JobTitle, ToMs(r.CreatedAt))).ToList();
    }

    public async Task<IReadOnlyList<TeamComparisonInput>> GetComparisonTeamsAsync(
        string organizationId, ScopePredicate scopeWhere, IReadOnlyList<Guid> teamIds, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // 1. Reuse the scope→SQL translator: surviving ids = teamIds ∩ scope ∩ org (out-of-scope drop).
        //    Identifiers ("teams", the translated columns) are fixed registry constants; every id/value is a
        //    bound Npgsql parameter (@ids, @org, @p0…) — never interpolated.
        var translated = ScopePredicateSqlTranslator.Translate("teams", scopeWhere);
        var sql = $"SELECT id FROM teams t WHERE t.id = ANY(@ids) AND t.organization_id = @org AND ({translated.Sql})";

        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        var allowedIds = new List<Guid>();
        await using (var command = new NpgsqlCommand(sql, connection, transaction))
        {
            command.Parameters.AddWithValue("ids", teamIds.ToArray());
            command.Parameters.AddWithValue("org", orgId);
            for (var i = 0; i < translated.Parameters.Count; i++)
            {
                command.Parameters.AddWithValue($"p{i}", translated.Parameters[i]);
            }

            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                allowedIds.Add(reader.GetGuid(0));
            }
        }

        if (allowedIds.Count == 0)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return [];
        }

        // 2. EF-load the surviving teams + per-team vacancy/okr counts (deterministic order by id).
        var teams = await _db.Teams.AsNoTracking()
            .Where(t => allowedIds.Contains(t.Id))
            .OrderBy(t => t.Id)
            .Select(t => new
            {
                t.Id,
                t.Name,
                t.LeaderId,
                VacancyCount = _db.Vacancies.Count(v => v.TeamId == t.Id && v.OrganizationId == orgId),
                OkrCount = _db.Okrs.Count(o => o.TeamId == t.Id && o.OrganizationId == orgId),
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        // Leaders (compare leader select { id, firstName, lastName }).
        var leaderIds = teams.Where(t => t.LeaderId != null).Select(t => t.LeaderId!.Value).Distinct().ToList();
        var leaders = leaderIds.Count == 0
            ? new Dictionary<Guid, TeamComparisonLeader>()
            : (await _db.Users.AsNoTracking()
                    .Where(u => leaderIds.Contains(u.Id) && u.OrganizationId == orgId)
                    .Select(u => new { u.Id, u.FirstName, u.LastName })
                    .ToListAsync(cancellationToken).ConfigureAwait(false))
                .ToDictionary(u => u.Id, u => new TeamComparisonLeader(u.Id.ToString(), u.FirstName, u.LastName));

        // Members per team (jobTitle + createdAt for the kernel).
        var memberRows = await _db.UserTeams.AsNoTracking()
            .Where(ut => allowedIds.Contains(ut.TeamId))
            .Join(_db.Users.AsNoTracking(), ut => ut.UserId, u => u.Id, (ut, u) => new { ut.TeamId, u.JobTitle, u.CreatedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var membersByTeam = memberRows
            .GroupBy(m => m.TeamId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<TeamComparisonMember>)g
                .Select(m => new TeamComparisonMember(m.JobTitle, ToMs(m.CreatedAt))).ToList());

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return teams.Select(t => new TeamComparisonInput(
            t.Id.ToString(),
            t.Name,
            t.LeaderId is { } lid && leaders.TryGetValue(lid, out var l) ? l : null,
            membersByTeam.TryGetValue(t.Id, out var ms) ? ms : [],
            t.VacancyCount,
            t.OkrCount)).ToList();
    }

    public async Task<DashboardKpiData> GetDashboardKpiDataAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var totalTeams = await _db.Teams.AsNoTracking()
            .CountAsync(t => t.OrganizationId == orgId && t.IsActive, cancellationToken).ConfigureAwait(false);

        // totalMembers = userTeam rows whose team is active + in-org (TS: where team: { organizationId, isActive }).
        var totalMembers = await _db.UserTeams.AsNoTracking()
            .CountAsync(
                ut => _db.Teams.Any(t => t.Id == ut.TeamId && t.OrganizationId == orgId && t.IsActive),
                cancellationToken).ConfigureAwait(false);

        var teamsWithLeader = await _db.Teams.AsNoTracking()
            .CountAsync(t => t.OrganizationId == orgId && t.IsActive && t.LeaderId != null, cancellationToken).ConfigureAwait(false);

        // Active org headcount (tenure + diversity) — a DIFFERENT population from totalMembers by design.
        var members = await _db.Users.AsNoTracking()
            .Where(u => u.OrganizationId == orgId && u.IsActive)
            .Select(u => new { u.CreatedAt, u.JobTitle })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new DashboardKpiData(
            totalTeams,
            totalMembers,
            teamsWithLeader,
            members.Select(m => ToMs(m.CreatedAt)).ToList(),
            members.Select(m => m.JobTitle).ToList());
    }

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads Kind=Unspecified); reinterpret as UTC.
    private static long ToMs(DateTime value) =>
        new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
