using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Application.NineBox;
using Tims.Domain.Access;
using Tims.Domain.NineBox;

namespace Tims.Infrastructure.NineBox;

/// <summary>
/// Read-only EF implementation of <see cref="INineBoxReadRepository"/> — a faithful port of the 11 READ
/// bodies of the TS <c>ninebox</c> router. Every query is <c>AsNoTracking()</c> and runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT
/// <c>organizationId</c> filter (defense-in-depth). NEVER logs row content.
///
/// The row-scoped reads (getGrid / getMovementHistory) compose the caller's <see cref="ScopePredicate"/> via
/// <see cref="ScopePredicateSqlTranslator"/> (reused, not re-ported) as an <c>id = ANY(@ids) AND (predicate)</c>
/// filter so out-of-scope nine_box_evaluations rows silently drop — the succession/team-intel pattern. The
/// input teamId/unitId/companyId (grid) and userId/companyId (movement) filters only INTERSECT (userId IN …),
/// never widen. Prisma <c>timestamp(3)</c> columns are read as Unspecified-kind wall-clock UTC and re-kinded to
/// UTC here; <c>axis_breakdown</c> jsonb is parsed to a <see cref="JsonNode"/> passthrough.
/// </summary>
public sealed class NineBoxReadRepository(NineBoxReadDbContext db) : INineBoxReadRepository
{
    private const string FinalizedStatus = "finalized";
    private const int MaxCalibrations = 100;

    private readonly NineBoxReadDbContext _db = db;

    public async Task<IReadOnlyList<GridEvaluation>> GetGridEvaluationsAsync(
        string organizationId,
        string period,
        GridFilter filter,
        ScopePredicate scope,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        // Input teamId/unitId/companyId → the userId intersect set (exclusive branch priority, TS if/else-if).
        var (userFilterActive, allowedUserIds) = await ResolveGridUserFilterAsync(orgId, filter, cancellationToken)
            .ConfigureAwait(false);

        var candidateQuery = _db.NineBoxEvaluations.AsNoTracking()
            .Where(e => e.OrganizationId == orgId && e.Period == period);
        if (userFilterActive)
        {
            candidateQuery = candidateQuery.Where(e => allowedUserIds.Contains(e.UserId));
        }

        var candidateIds = await candidateQuery.Select(e => e.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var allowed = await FilterInScopeAsync(
            connection, transaction, scope, orgId, candidateIds, cancellationToken).ConfigureAwait(false);
        if (allowed.Count == 0)
        {
            await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return [];
        }

        var rows = await _db.NineBoxEvaluations.AsNoTracking()
            .Where(e => e.OrganizationId == orgId && e.Period == period && allowed.Contains(e.Id))
            .Join(
                _db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId),
                e => e.UserId, u => u.Id, (e, u) => new { e, u })
            .OrderByDescending(x => x.e.EvaluatedAt)
            .Select(x => new
            {
                x.e.Id,
                x.e.OrganizationId,
                x.e.UserId,
                x.e.Period,
                x.e.PotentialScore,
                x.e.PerformanceScore,
                x.e.Quadrant,
                x.e.Confidence,
                x.e.AxisBreakdown,
                x.e.EvaluatedAt,
                x.e.CreatedAt,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
                x.u.JobTitle,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(x => new GridEvaluation(
            x.Id.ToString(),
            x.OrganizationId.ToString(),
            x.UserId.ToString(),
            x.Period,
            x.PotentialScore,
            x.PerformanceScore,
            x.Quadrant,
            x.Confidence,
            ParseJson(x.AxisBreakdown),
            ToUtc(x.EvaluatedAt),
            ToUtc(x.CreatedAt),
            new GridUser(x.UId.ToString(), x.FirstName, x.LastName, x.Avatar, x.JobTitle))).ToList();
    }

    public async Task<EmployeeDetailEvaluation?> GetEmployeeEvaluationAsync(
        string organizationId,
        Guid userId,
        string period,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var row = await _db.NineBoxEvaluations.AsNoTracking()
            .Where(e => e.OrganizationId == orgId && e.UserId == userId && e.Period == period)
            .Join(
                _db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId),
                e => e.UserId, u => u.Id, (e, u) => new { e, u })
            .Select(x => new
            {
                x.e.Id,
                x.e.OrganizationId,
                x.e.UserId,
                x.e.Period,
                x.e.PotentialScore,
                x.e.PerformanceScore,
                x.e.Quadrant,
                x.e.Confidence,
                x.e.AxisBreakdown,
                x.e.EvaluatedAt,
                x.e.CreatedAt,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
                x.u.JobTitle,
                x.u.Email,
            })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return row is null
            ? null
            : new EmployeeDetailEvaluation(
                row.Id.ToString(),
                row.OrganizationId.ToString(),
                row.UserId.ToString(),
                row.Period,
                row.PotentialScore,
                row.PerformanceScore,
                row.Quadrant,
                row.Confidence,
                ParseJson(row.AxisBreakdown),
                ToUtc(row.EvaluatedAt),
                ToUtc(row.CreatedAt),
                new EmployeeDetailUser(row.UId.ToString(), row.FirstName, row.LastName, row.Avatar, row.JobTitle, row.Email));
    }

    public async Task<IReadOnlyList<EmployeeHistoryRow>> GetEmployeeHistoryAsync(
        string organizationId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.NineBoxEvaluations.AsNoTracking()
            .Where(e => e.OrganizationId == orgId && e.UserId == userId)
            .OrderBy(e => e.EvaluatedAt)
            .Select(e => new { e.Period, e.Quadrant, e.PotentialScore, e.PerformanceScore, e.EvaluatedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(r => new EmployeeHistoryRow(
            r.Period, r.Quadrant, r.PotentialScore, r.PerformanceScore, ToUtc(r.EvaluatedAt))).ToList();
    }

    public async Task<AxisBreakdownView?> GetAxisBreakdownAsync(
        string organizationId,
        Guid userId,
        string period,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var row = await _db.NineBoxEvaluations.AsNoTracking()
            .Where(e => e.OrganizationId == orgId && e.UserId == userId && e.Period == period)
            .Select(e => new { e.PotentialScore, e.PerformanceScore, e.Quadrant, e.Confidence, e.AxisBreakdown })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return row is null
            ? null
            : new AxisBreakdownView(
                userId.ToString(),
                period,
                row.PotentialScore,
                row.PerformanceScore,
                row.Quadrant,
                row.Confidence,
                ParseJson(row.AxisBreakdown));
    }

    public async Task<IReadOnlyList<Domain.NineBox.MovementEvalInput>> GetMovementInputsAsync(
        string organizationId,
        MovementFilter filter,
        ScopePredicate scope,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        // SINGLE query — TS parity (one findMany with the scope predicate AND-composed; ninebox.ts:180-197).
        // Replaces the earlier two-phase (materialize EVERY org candidate id → ANY(@ids) → refetch), which was
        // UNBOUNDED for this period-less read (Codex M2): a large tenant forced huge in-memory id lists + a giant
        // ANY(@ids) parameter before the real fetch. The translated scope predicate (alias `t`, registry-only
        // identifiers) drops out-of-scope rows in-SQL; the input userId/companyId filters only INTERSECT (never
        // widen — userId is a scalar eq, companyId joins u.company_id). Ordering userId asc, evaluatedAt asc = TS.
        var translated = ScopePredicateSqlTranslator.Translate("nine_box_evaluations", scope);
        var sql =
            "SELECT t.user_id, u.first_name, u.last_name, t.period, t.quadrant "
            + "FROM nine_box_evaluations t "
            + "JOIN users u ON u.id = t.user_id AND u.organization_id = @org "
            + "WHERE t.organization_id = @org"
            + (filter.UserId is null ? string.Empty : " AND t.user_id = @filterUserId")
            + (filter.CompanyId is null ? string.Empty : " AND u.company_id = @companyId")
            + $" AND ({translated.Sql}) "
            + "ORDER BY t.user_id, t.evaluated_at";

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("org", orgId);
        if (filter.UserId is { } filterUserId)
        {
            command.Parameters.AddWithValue("filterUserId", filterUserId);
        }

        if (filter.CompanyId is { } companyId)
        {
            command.Parameters.AddWithValue("companyId", companyId);
        }

        for (var i = 0; i < translated.Parameters.Count; i++)
        {
            command.Parameters.AddWithValue($"p{i}", translated.Parameters[i]);
        }

        var results = new List<Domain.NineBox.MovementEvalInput>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false))
        {
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                results.Add(new Domain.NineBox.MovementEvalInput(
                    reader.GetGuid(0).ToString(),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4)));
            }
        }

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return results;
    }

    public async Task<IReadOnlyList<CalibrationListRow>> ListCalibrationsAsync(
        string organizationId,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var sessions = await _db.CalibrationSessions.AsNoTracking()
            .Where(s => s.OrganizationId == orgId)
            .OrderByDescending(s => s.CreatedAt)
            .Take(MaxCalibrations)
            .Select(s => new { s.Id, s.Period, s.Status, s.ScheduledAt, s.CreatedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var sessionIds = sessions.Select(s => s.Id).ToList();

        var memberCounts = await MemberCountsAsync(sessionIds, cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return sessions.Select(s => new CalibrationListRow(
            s.Id.ToString(),
            s.Period,
            s.Status,
            ToUtcNullable(s.ScheduledAt),
            ToUtc(s.CreatedAt),
            new CalibrationMemberCount(memberCounts.TryGetValue(s.Id, out var c) ? c : 0))).ToList();
    }

    public async Task<CalibrationSessionAnchor?> GetCalibrationAnchorAsync(
        string organizationId,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var anchor = await _db.CalibrationSessions.AsNoTracking()
            .Where(s => s.Id == sessionId && s.OrganizationId == orgId)
            .Select(s => new { s.Id, s.CreatedById })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return anchor is null ? null : new CalibrationSessionAnchor(anchor.Id, anchor.CreatedById);
    }

    public async Task<bool> IsCalibrationMemberAsync(
        string organizationId,
        Guid sessionId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        // The endpoint has already org-verified the session via GetCalibrationAnchorAsync; the membership row is
        // reachable only through that in-org session (RLS on calibration_members joins the session). Runs under a
        // fresh TenantScope keyed on the caller's org so RLS engages.
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var membership = await _db.CalibrationMembers.AsNoTracking()
            .AnyAsync(m => m.SessionId == sessionId && m.UserId == userId, cancellationToken)
            .ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return membership;
    }

    public async Task<CalibrationDetailView?> GetCalibrationAsync(
        string organizationId,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var session = await _db.CalibrationSessions.AsNoTracking()
            .Where(s => s.Id == sessionId && s.OrganizationId == orgId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (session is null)
        {
            await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        var creator = await _db.Users.AsNoTracking()
            .Where(u => u.Id == session.CreatedById && u.OrganizationId == orgId)
            .Select(u => new CalibrationCreator(u.Id.ToString(), u.FirstName, u.LastName))
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

        // members (+ user). No orderBy in the TS include; ordered createdAt asc, id for a deterministic wire.
        var memberRows = await _db.CalibrationMembers.AsNoTracking()
            .Where(m => m.SessionId == sessionId)
            .Join(
                _db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId),
                m => m.UserId, u => u.Id, (m, u) => new { m, u })
            .OrderBy(x => x.m.CreatedAt).ThenBy(x => x.m.Id)
            .Select(x => new
            {
                x.m.Id,
                x.m.SessionId,
                x.m.UserId,
                x.m.Status,
                x.m.CreatedAt,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        // votes (+ evaluatedUser + voter). Two user joins; deterministic createdAt asc, id order.
        var voteRows = await _db.CalibrationVotes.AsNoTracking()
            .Where(v => v.SessionId == sessionId)
            .Join(
                _db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId),
                v => v.EvaluatedUserId, u => u.Id, (v, u) => new { v, eval = u })
            .Join(
                _db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId),
                x => x.v.VoterId, u => u.Id, (x, voter) => new { x.v, x.eval, voter })
            .OrderBy(x => x.v.CreatedAt).ThenBy(x => x.v.Id)
            .Select(x => new
            {
                x.v.Id,
                x.v.SessionId,
                x.v.EvaluatedUserId,
                x.v.VoterId,
                x.v.Quadrant,
                x.v.Justification,
                x.v.CreatedAt,
                EvalId = x.eval.Id,
                EvalFirst = x.eval.FirstName,
                EvalLast = x.eval.LastName,
                VoterId2 = x.voter.Id,
                VoterFirst = x.voter.FirstName,
                VoterLast = x.voter.LastName,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var members = memberRows.Select(m => new CalibrationMemberRow(
            m.Id.ToString(),
            m.SessionId.ToString(),
            m.UserId.ToString(),
            m.Status,
            ToUtc(m.CreatedAt),
            new CalibrationMemberUser(m.UId.ToString(), m.FirstName, m.LastName, m.Avatar))).ToList();

        var votes = voteRows.Select(v => new CalibrationVoteRow(
            v.Id.ToString(),
            v.SessionId.ToString(),
            v.EvaluatedUserId.ToString(),
            v.VoterId.ToString(),
            v.Quadrant,
            v.Justification,
            ToUtc(v.CreatedAt),
            new CalibrationVoteUser(v.EvalId.ToString(), v.EvalFirst, v.EvalLast),
            new CalibrationVoteUser(v.VoterId2.ToString(), v.VoterFirst, v.VoterLast))).ToList();

        return new CalibrationDetailView(
            session.Id.ToString(),
            session.OrganizationId.ToString(),
            session.Period,
            session.Status,
            ToUtcNullable(session.ScheduledAt),
            ToUtcNullable(session.CompletedAt),
            session.CreatedById.ToString(),
            ToUtc(session.CreatedAt),
            ToUtc(session.UpdatedAt),
            creator ?? new CalibrationCreator(session.CreatedById.ToString(), string.Empty, string.Empty),
            members,
            votes);
    }

    public async Task<IReadOnlyList<MyCalibrationRow>> MyCalibrationsAsync(
        string organizationId,
        Guid callerId,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // createdById == caller OR EXISTS(member where user_id = caller). Tenant-isolated, createdAt desc, 100.
        var sessions = await _db.CalibrationSessions.AsNoTracking()
            .Where(s => s.OrganizationId == orgId
                && (s.CreatedById == callerId
                    || _db.CalibrationMembers.Any(m => m.SessionId == s.Id && m.UserId == callerId)))
            .OrderByDescending(s => s.CreatedAt)
            .Take(MaxCalibrations)
            .Select(s => new { s.Id, s.Period, s.Status, s.ScheduledAt, s.CompletedAt, s.CreatedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var sessionIds = sessions.Select(s => s.Id).ToList();

        var memberCounts = await MemberCountsAsync(sessionIds, cancellationToken).ConfigureAwait(false);
        var voteCounts = await VoteCountsAsync(sessionIds, cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return sessions.Select(s => new MyCalibrationRow(
            s.Id.ToString(),
            s.Period,
            s.Status,
            ToUtcNullable(s.ScheduledAt),
            ToUtcNullable(s.CompletedAt),
            ToUtc(s.CreatedAt),
            new MyCalibrationCount(
                memberCounts.TryGetValue(s.Id, out var mc) ? mc : 0,
                voteCounts.TryGetValue(s.Id, out var vc) ? vc : 0))).ToList();
    }

    public async Task<IReadOnlyList<string>> GetPeriodQuadrantsAsync(
        string organizationId,
        string period,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var quadrants = await _db.NineBoxEvaluations.AsNoTracking()
            .Where(e => e.OrganizationId == orgId && e.Period == period)
            .Select(e => e.Quadrant)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return quadrants;
    }

    public async Task<NineBoxKpiCounts> GetKpiCountsAsync(
        string organizationId,
        string period,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var totalEvaluations = await _db.NineBoxEvaluations.AsNoTracking()
            .CountAsync(e => e.OrganizationId == orgId && e.Period == period, cancellationToken).ConfigureAwait(false);
        var calibrationSessions = await _db.CalibrationSessions.AsNoTracking()
            .CountAsync(s => s.OrganizationId == orgId && s.Period == period, cancellationToken).ConfigureAwait(false);
        var activeCalibrations = await _db.CalibrationSessions.AsNoTracking()
            .CountAsync(
                s => s.OrganizationId == orgId && s.Period == period && s.Status != FinalizedStatus,
                cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new NineBoxKpiCounts(totalEvaluations, calibrationSessions, activeCalibrations);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    // getGrid teamId/unitId/companyId → the userId intersect set. Exclusive branch priority (TS if/else-if):
    // teamId → user_teams members; unitId → user_teams ⋈ teams(business_unit); companyId → users.company_id.
    // Returns (active?, userIds). active=false → no user filter (org+period only).
    private async Task<(bool Active, List<Guid> UserIds)> ResolveGridUserFilterAsync(
        Guid orgId, GridFilter filter, CancellationToken cancellationToken)
    {
        if (filter.TeamId is { } teamId)
        {
            var ids = await _db.UserTeams.AsNoTracking()
                .Where(ut => ut.TeamId == teamId)
                .Select(ut => ut.UserId)
                .ToListAsync(cancellationToken).ConfigureAwait(false);
            return (true, ids);
        }

        if (filter.UnitId is { } unitId)
        {
            var ids = await _db.UserTeams.AsNoTracking()
                .Join(
                    _db.Teams.AsNoTracking().Where(t => t.OrganizationId == orgId && t.BusinessUnitId == unitId),
                    ut => ut.TeamId, t => t.Id, (ut, t) => ut.UserId)
                .ToListAsync(cancellationToken).ConfigureAwait(false);
            return (true, ids);
        }

        if (filter.CompanyId is { } companyId)
        {
            var ids = await _db.Users.AsNoTracking()
                .Where(u => u.OrganizationId == orgId && u.CompanyId == companyId)
                .Select(u => u.Id)
                .ToListAsync(cancellationToken).ConfigureAwait(false);
            return (true, ids);
        }

        return (false, []);
    }

    private async Task<Dictionary<Guid, int>> MemberCountsAsync(
        IReadOnlyList<Guid> sessionIds, CancellationToken cancellationToken)
    {
        if (sessionIds.Count == 0)
        {
            return new Dictionary<Guid, int>();
        }

        return (await _db.CalibrationMembers.AsNoTracking()
                .Where(m => sessionIds.Contains(m.SessionId))
                .GroupBy(m => m.SessionId)
                .Select(g => new { SessionId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken).ConfigureAwait(false))
            .ToDictionary(x => x.SessionId, x => x.Count);
    }

    private async Task<Dictionary<Guid, int>> VoteCountsAsync(
        IReadOnlyList<Guid> sessionIds, CancellationToken cancellationToken)
    {
        if (sessionIds.Count == 0)
        {
            return new Dictionary<Guid, int>();
        }

        return (await _db.CalibrationVotes.AsNoTracking()
                .Where(v => sessionIds.Contains(v.SessionId))
                .GroupBy(v => v.SessionId)
                .Select(g => new { SessionId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken).ConfigureAwait(false))
            .ToDictionary(x => x.SessionId, x => x.Count);
    }

    private (NpgsqlConnection Connection, NpgsqlTransaction Transaction) RawHandles()
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();
        return (connection, transaction);
    }

    // Reuse the scope→SQL translator: surviving ids = candidate ∩ org ∩ scope over nine_box_evaluations.
    // Identifiers (the table, the translated user_id column) are fixed registry constants; every id/value is a
    // bound Npgsql parameter — never interpolated. Empty candidate set → no query, no rows.
    private static async Task<HashSet<Guid>> FilterInScopeAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        ScopePredicate predicate,
        Guid orgId,
        IReadOnlyCollection<Guid> candidateIds,
        CancellationToken cancellationToken)
    {
        var result = new HashSet<Guid>();
        if (candidateIds.Count == 0)
        {
            return result;
        }

        var translated = ScopePredicateSqlTranslator.Translate("nine_box_evaluations", predicate);
        var sql =
            "SELECT t.id FROM nine_box_evaluations t "
            + $"WHERE t.id = ANY(@ids) AND t.organization_id = @org AND ({translated.Sql})";

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("ids", candidateIds.ToArray());
        command.Parameters.AddWithValue("org", orgId);
        for (var i = 0; i < translated.Parameters.Count; i++)
        {
            command.Parameters.AddWithValue($"p{i}", translated.Parameters[i]);
        }

        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            result.Add(reader.GetGuid(0));
        }

        return result;
    }

    private static JsonNode? ParseJson(string raw) =>
        string.IsNullOrWhiteSpace(raw) ? null : JsonNode.Parse(raw);

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads Kind=Unspecified); re-kind to UTC so
    // the shared Node-ISO converter emits the same `…fffZ` wire form Node's Date.toISOString() produces.
    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? ToUtcNullable(DateTime? value) =>
        value is { } instant ? ToUtc(instant) : null;
}
