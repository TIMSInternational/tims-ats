using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Application.Engagement;
using Tims.Domain.Access;
using Tims.Domain.Engagement;

namespace Tims.Infrastructure.Engagement;

/// <summary>
/// Read-only EF implementation of <see cref="IEngagementReadRepository"/> — a faithful port of the 14 READ bodies
/// of the TS <c>engagement</c> router. Every query is <c>AsNoTracking()</c> and runs UNDER <see cref="TenantScope"/>
/// (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth).
/// NEVER logs row content.
///
/// The two row-scoped list reads (listActionPlans / listLeaderCommitments) compose the caller's
/// <see cref="ScopePredicate"/> via <see cref="ScopePredicateSqlTranslator"/> (reused) as an
/// <c>id = ANY(@ids) AND (predicate)</c> filter so out-of-scope rows silently drop — the succession/team-intel
/// pattern. Prisma <c>timestamp(3)</c> columns are read as Unspecified-kind wall-clock UTC and re-kinded to UTC
/// here; jsonb columns (questions/answers/actions/metadata) are parsed to <see cref="JsonNode"/>.
/// </summary>
public sealed class EngagementReadRepository(EngagementReadDbContext db) : IEngagementReadRepository
{
    private const string ActionPlansTable = "action_plans";
    private const string LeaderCommitmentsTable = "leader_commitments";
    private static readonly string[] OpenPlanStatuses = { "pending", "in_progress" };

    private readonly EngagementReadDbContext _db = db;

    // #1 listSurveys ────────────────────────────────────────────────────────────
    public async Task<SurveyListPage> ListSurveysAsync(
        string organizationId, string? status, int page, int limit, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var query = _db.Surveys.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && (status == null || s.Status == status));

        var total = await query.CountAsync(cancellationToken).ConfigureAwait(false);
        var rows = await query
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(s => new
            {
                s.Id,
                s.Title,
                s.Type,
                s.Status,
                s.StartsAt,
                s.EndsAt,
                s.CreatedAt,
                s.UpdatedAt,
                s.ResponseCount,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new SurveyListPage(
            rows.Select(s => new SurveyListRow(
                s.Id.ToString(), s.Title, s.Type, s.Status,
                ToUtcNullable(s.StartsAt), ToUtcNullable(s.EndsAt), ToUtc(s.CreatedAt), ToUtc(s.UpdatedAt),
                s.ResponseCount)).ToList(),
            total);
    }

    // #2 getSurveyResults ─────────────────────────────────────────────────────────
    public async Task<SurveyResultsData?> GetSurveyResultsDataAsync(
        string organizationId, Guid surveyId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var survey = await _db.Surveys.AsNoTracking()
            .Where(s => s.Id == surveyId && s.OrganizationId == orgId)
            .Select(s => new { s.Id, s.Title, s.Questions })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (survey is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        // §21 minimal-select improvement: TS uses include:{responses:{select:{answers:true}}}; port with an
        // answers-only projection (never userId or other response columns).
        var answers = await _db.SurveyResponses.AsNoTracking()
            .Where(r => r.SurveyId == surveyId && r.OrganizationId == orgId)
            .Select(r => r.Answers)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new SurveyResultsData(
            survey.Id.ToString(), survey.Title, ParseQuestions(survey.Questions), answers.Select(ParseObject).ToList());
    }

    // #3 myPendingSurveys (OWN, anti-join) ────────────────────────────────────────
    public async Task<IReadOnlyList<PendingSurveyRow>> GetPendingSurveysAsync(
        string organizationId, Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowDt = Unspecified(now);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.Surveys.AsNoTracking()
            .Where(s => s.OrganizationId == orgId
                && s.Status == "active"
                && (s.StartsAt == null || s.StartsAt <= nowDt)
                && (s.EndsAt == null || s.EndsAt >= nowDt)
                // anti-join: exclude surveys the CALLER already responded to (responses:{none:{userId}}).
                && !_db.SurveyResponses.Any(r => r.SurveyId == s.Id && r.UserId == userId))
            .OrderBy(s => s.EndsAt)
            .Take(50)
            .Select(s => new { s.Id, s.Title, s.Type, s.StartsAt, s.EndsAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(s => new PendingSurveyRow(
            s.Id.ToString(), s.Title, s.Type, ToUtcNullable(s.StartsAt), ToUtcNullable(s.EndsAt))).ToList();
    }

    // #4 getSurveyForResponse (OWN, active-window) ────────────────────────────────
    public async Task<SurveyForResponseView?> GetSurveyForResponseAsync(
        string organizationId, Guid surveyId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowDt = Unspecified(now);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var survey = await _db.Surveys.AsNoTracking()
            .Where(s => s.Id == surveyId
                && s.OrganizationId == orgId
                && s.Status == "active"
                && (s.StartsAt == null || s.StartsAt <= nowDt)
                && (s.EndsAt == null || s.EndsAt >= nowDt))
            .Select(s => new { s.Id, s.Title, s.Type, s.Questions })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return survey is null
            ? null
            : new SurveyForResponseView(survey.Id.ToString(), survey.Title, survey.Type, ParseNode(survey.Questions));
    }

    // #5 getEnps ──────────────────────────────────────────────────────────────────
    public async Task<IReadOnlyList<JsonObject>> GetEnpsAnswersAsync(
        string organizationId, DateTimeOffset since, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var sinceDt = Unspecified(since);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var answers = await _db.SurveyResponses.AsNoTracking()
            .Where(r => r.OrganizationId == orgId
                && r.SubmittedAt >= sinceDt
                && _db.Surveys.Any(sv => sv.Id == r.SurveyId && sv.Type == "enps"))
            .Select(r => r.Answers)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return answers.Select(ParseObject).ToList();
    }

    // #6 getClimateHeatmap ────────────────────────────────────────────────────────
    public async Task<ClimateSurveyData?> GetClimateHeatmapDataAsync(
        string organizationId, Guid? surveyId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var survey = await _db.Surveys.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && s.Type == "climate" && (surveyId == null || s.Id == surveyId))
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new { s.Id, s.Title, s.Questions })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (survey is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        var answers = await _db.SurveyResponses.AsNoTracking()
            .Where(r => r.SurveyId == survey.Id && r.OrganizationId == orgId)
            .Select(r => r.Answers)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new ClimateSurveyData(
            survey.Id.ToString(), survey.Title, ParseQuestions(survey.Questions), answers.Select(ParseObject).ToList());
    }

    // #7 getResultsByArea ─────────────────────────────────────────────────────────
    public async Task<AreaSurveyData?> GetResultsByAreaDataAsync(
        string organizationId, Guid surveyId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var exists = await _db.Surveys.AsNoTracking()
            .AnyAsync(s => s.Id == surveyId && s.OrganizationId == orgId, cancellationToken).ConfigureAwait(false);
        if (!exists)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        var responses = await _db.SurveyResponses.AsNoTracking()
            .Where(r => r.SurveyId == surveyId && r.OrganizationId == orgId)
            .Select(r => new { r.Answers, r.UserId })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        // LEFT join to users (userId nullable, user may be SetNull after deletion) → the area anchors.
        var userIds = responses.Where(r => r.UserId != null).Select(r => r.UserId!.Value).Distinct().ToList();
        var users = userIds.Count == 0
            ? new Dictionary<Guid, (Guid? CompanyId, Guid? BusinessUnitId)>()
            : (await _db.Users.AsNoTracking()
                    .Where(u => userIds.Contains(u.Id) && u.OrganizationId == orgId)
                    .Select(u => new { u.Id, u.CompanyId, u.BusinessUnitId })
                    .ToListAsync(cancellationToken).ConfigureAwait(false))
                .ToDictionary(u => u.Id, u => (u.CompanyId, u.BusinessUnitId));

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var rows = responses.Select(r =>
        {
            (Guid? CompanyId, Guid? BusinessUnitId) anchor = r.UserId is { } uid && users.TryGetValue(uid, out var a)
                ? a
                : (null, null);
            return new AreaResponseRow(ParseObject(r.Answers), anchor.CompanyId?.ToString(), anchor.BusinessUnitId?.ToString());
        }).ToList();

        return new AreaSurveyData(surveyId.ToString(), rows);
    }

    // #10 getLowClimateAlerts ─────────────────────────────────────────────────────
    public async Task<IReadOnlyList<AlertRow>> GetLowClimateAlertsAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.Alerts.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.Module == "engagement" && a.Status == "active")
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(a => new AlertRow(
            a.Id.ToString(),
            a.OrganizationId.ToString(),
            a.RuleId?.ToString(),
            a.Module,
            a.Severity,
            a.Title,
            a.Message,
            ParseNode(a.Metadata),
            a.Status,
            a.DismissedById?.ToString(),
            ToUtcNullable(a.DismissedAt),
            ToUtc(a.CreatedAt))).ToList();
    }

    // #11 listActionPlans (scopeWhereFor('actionPlan')) ───────────────────────────
    public async Task<IReadOnlyList<ActionPlanRow>> ListActionPlansAsync(
        string organizationId, string? status, ScopePredicate scope, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        var candidateIds = await _db.ActionPlans.AsNoTracking()
            .Where(p => p.OrganizationId == orgId && (status == null || p.Status == status))
            .Select(p => p.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var allowed = await FilterInScopeAsync(
            connection, transaction, ActionPlansTable, scope, orgId, candidateIds, cancellationToken).ConfigureAwait(false);
        if (allowed.Count == 0)
        {
            await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return [];
        }

        var rows = await _db.ActionPlans.AsNoTracking()
            .Where(p => allowed.Contains(p.Id))
            .Join(
                _db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId),
                p => p.ResponsibleId, u => u.Id, (p, u) => new { p, u })
            .OrderByDescending(x => x.p.CreatedAt)
            .Select(x => new
            {
                x.p.Id,
                x.p.OrganizationId,
                x.p.Title,
                x.p.ResponsibleId,
                x.p.Area,
                x.p.Status,
                x.p.DueDate,
                x.p.Actions,
                x.p.Notes,
                x.p.CreatedAt,
                x.p.UpdatedAt,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(x => new ActionPlanRow(
            x.Id.ToString(),
            x.OrganizationId.ToString(),
            x.Title,
            x.ResponsibleId.ToString(),
            x.Area,
            x.Status,
            ToUtcNullable(x.DueDate),
            ParseNode(x.Actions),
            x.Notes,
            ToUtc(x.CreatedAt),
            ToUtc(x.UpdatedAt),
            new ActionPlanResponsible(x.UId.ToString(), x.FirstName, x.LastName, x.Avatar))).ToList();
    }

    // #12 listLeaderCommitments (scopeWhereFor('leaderCommitment')) ────────────────
    public async Task<IReadOnlyList<LeaderCommitmentRow>> ListLeaderCommitmentsAsync(
        string organizationId, Guid? leaderId, string? status, ScopePredicate scope, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        var candidateIds = await _db.LeaderCommitments.AsNoTracking()
            .Where(c => c.OrganizationId == orgId
                && (leaderId == null || c.LeaderId == leaderId)
                && (status == null || c.Status == status))
            .Select(c => c.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var allowed = await FilterInScopeAsync(
            connection, transaction, LeaderCommitmentsTable, scope, orgId, candidateIds, cancellationToken).ConfigureAwait(false);
        if (allowed.Count == 0)
        {
            await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return [];
        }

        var rows = await _db.LeaderCommitments.AsNoTracking()
            .Where(c => allowed.Contains(c.Id))
            .Join(
                _db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId),
                c => c.LeaderId, u => u.Id, (c, u) => new { c, u })
            .OrderBy(x => x.c.DueDate)
            .Select(x => new
            {
                x.c.Id,
                x.c.OrganizationId,
                x.c.LeaderId,
                x.c.Description,
                x.c.Status,
                x.c.DueDate,
                x.c.CompletedAt,
                x.c.CreatedAt,
                x.c.UpdatedAt,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(x => new LeaderCommitmentRow(
            x.Id.ToString(),
            x.OrganizationId.ToString(),
            x.LeaderId.ToString(),
            x.Description,
            x.Status,
            ToUtcNullable(x.DueDate),
            ToUtcNullable(x.CompletedAt),
            ToUtc(x.CreatedAt),
            ToUtc(x.UpdatedAt),
            new LeaderCommitmentLeader(x.UId.ToString(), x.FirstName, x.LastName, x.Avatar))).ToList();
    }

    // #13 getDashboardKpis ────────────────────────────────────────────────────────
    public async Task<EngagementKpiData> GetDashboardKpiDataAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var activeSurveys = await _db.Surveys.AsNoTracking()
            .CountAsync(s => s.OrganizationId == orgId && s.Status == "active", cancellationToken).ConfigureAwait(false);
        var totalResponses = await _db.SurveyResponses.AsNoTracking()
            .CountAsync(r => r.OrganizationId == orgId, cancellationToken).ConfigureAwait(false);
        var perSurveyCounts = await _db.SurveyResponses.AsNoTracking()
            .Where(r => r.OrganizationId == orgId)
            .GroupBy(r => r.SurveyId)
            .Select(g => g.Count())
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var actionPlansOpen = await _db.ActionPlans.AsNoTracking()
            .CountAsync(p => p.OrganizationId == orgId && OpenPlanStatuses.Contains(p.Status), cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new EngagementKpiData(activeSurveys, totalResponses, perSurveyCounts, actionPlansOpen);
    }

    // #14 getRotationRisk (active user count) ──────────────────────────────────────
    public async Task<int> GetActiveUserCountAsync(
        string organizationId, Guid? companyId, Guid? businessUnitId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var total = await _db.Users.AsNoTracking()
            .CountAsync(
                u => u.OrganizationId == orgId
                    && u.IsActive
                    && (companyId == null || u.CompanyId == companyId)
                    && (businessUnitId == null || u.BusinessUnitId == businessUnitId),
                cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return total;
    }

    // ── helpers ───────────────────────────────────────────────────────────────────

    private (NpgsqlConnection Connection, NpgsqlTransaction Transaction) RawHandles()
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();
        return (connection, transaction);
    }

    // Reuse the scope→SQL translator: surviving ids = candidate ∩ org ∩ scope over the given table. Identifiers
    // (the table, the translated column) are fixed registry constants; every id/value is a bound Npgsql parameter
    // — never interpolated. Empty candidate set → no query, no rows.
    private static async Task<HashSet<Guid>> FilterInScopeAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string table,
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

        var translated = ScopePredicateSqlTranslator.Translate(table, predicate);
        var sql = $"SELECT t.id FROM {table} t WHERE t.id = ANY(@ids) AND t.organization_id = @org AND ({translated.Sql})";

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

    private static IReadOnlyList<JsonObject> ParseQuestions(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return Array.Empty<JsonObject>();
        }

        return JsonNode.Parse(json) is JsonArray array
            ? array.Where(n => n is JsonObject).Select(n => n!.AsObject()).ToList()
            : Array.Empty<JsonObject>();
    }

    private static JsonObject ParseObject(string? json) =>
        (string.IsNullOrWhiteSpace(json) ? null : JsonNode.Parse(json)) as JsonObject ?? new JsonObject();

    private static JsonNode? ParseNode(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonNode.Parse(json);

    private static DateTime Unspecified(DateTimeOffset value) =>
        DateTime.SpecifyKind(value.UtcDateTime, DateTimeKind.Unspecified);

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads Kind=Unspecified); re-kind to UTC so the
    // shared Node-ISO converter emits the same `…fffZ` wire form Node's Date.toISOString() produces.
    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? ToUtcNullable(DateTime? value) =>
        value is { } instant ? ToUtc(instant) : null;
}
