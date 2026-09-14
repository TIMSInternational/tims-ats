using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Application.Monitoring;
using Tims.Domain.Access;

namespace Tims.Infrastructure.Monitoring;

/// <summary>
/// Read-only EF implementation of <see cref="IMonitoringReadRepository"/> — a faithful port of the six
/// READ bodies of the TS <c>monitoring</c> router (Phase-5 Q0b slice 1, issue #100). Every query is
/// <c>AsNoTracking()</c> and runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC →
/// RLS) with an EXPLICIT <c>organization_id</c> filter (defense-in-depth). NEVER logs row content.
///
/// <c>getActionPlanAlerts</c> is the one row-scoped read: it composes the caller's
/// <see cref="ScopePredicate"/> through <see cref="ScopePredicateSqlTranslator"/> (reused, not re-ported)
/// as an <c>id = ANY(@ids) AND (predicate)</c> filter, so an out-of-scope plan silently drops — the
/// engagement <c>listActionPlans</c> pattern, matching the TS <c>AND [{ organizationId }, scopeWhere, …]</c>.
///
/// Prisma <c>timestamp(3)</c> columns are read as Unspecified-kind wall-clock UTC and re-kinded here;
/// the caller passes bounds in the same Unspecified-kind wall-clock UTC form.
/// </summary>
public sealed class MonitoringReadRepository(MonitoringReadDbContext db) : IMonitoringReadRepository
{
    private const string ActionPlansTable = "action_plans";
    private const string ActiveStatus = "active";
    private static readonly string[] OpenVacancyStatuses = ["approved", "published"];

    private readonly MonitoringReadDbContext _db = db;

    public async Task<ExecutiveKpiCounts> GetExecutiveKpiCountsAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Sequential, not Promise.all: one pooled connection inside one TenantScope transaction.
        var totalUsers = await _db.Users.AsNoTracking()
            .CountAsync(u => u.OrganizationId == orgId && u.IsActive, cancellationToken).ConfigureAwait(false);

        var activeVacancies = await _db.Vacancies.AsNoTracking()
            .CountAsync(
                v => v.OrganizationId == orgId && OpenVacancyStatuses.Contains(v.Status) && v.DeletedAt == null,
                cancellationToken).ConfigureAwait(false);

        var pendingAdjustments = await _db.SalaryAdjustments.AsNoTracking()
            .CountAsync(s => s.OrganizationId == orgId && s.Status == "pending", cancellationToken).ConfigureAwait(false);

        var activeSurveys = await _db.Surveys.AsNoTracking()
            .CountAsync(s => s.OrganizationId == orgId && s.Status == ActiveStatus, cancellationToken).ConfigureAwait(false);

        var openAlerts = await _db.Alerts.AsNoTracking()
            .CountAsync(a => a.OrganizationId == orgId && a.Status == ActiveStatus, cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new ExecutiveKpiCounts(totalUsers, activeVacancies, pendingAdjustments, activeSurveys, openAlerts);
    }

    public async Task<IReadOnlyDictionary<string, int>> GetActiveAlertCountsByModuleAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var grouped = await _db.Alerts.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.Status == ActiveStatus)
            .GroupBy(a => a.Module)
            .Select(g => new { Module = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return grouped.ToDictionary(g => g.Module, g => g.Count);
    }

    public async Task<ActiveAlertsPage> GetActiveAlertsAsync(
        string organizationId, string? module, string? severity, int page, int limit, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var query = _db.Alerts.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.Status == ActiveStatus)
            .Where(a => module == null || a.Module == module)
            .Where(a => severity == null || a.Severity == severity);

        var total = await query.CountAsync(cancellationToken).ConfigureAwait(false);

        // TS: orderBy [{ severity: 'desc' }, { createdAt: 'desc' }]. `severity` is a plain text column,
        // so this is a LEXICOGRAPHIC sort ('warning' > 'info' > 'critical'), NOT a severity ranking.
        // Both stacks emit the same ORDER BY against the same column and collation, so the (odd) order
        // is preserved verbatim rather than "corrected" here.
        var rows = await query
            .OrderByDescending(a => a.Severity)
            .ThenByDescending(a => a.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(a => new { a.Id, a.Severity, a.Module, a.Title, a.Message, a.CreatedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var items = rows
            .Select(a => new ActiveAlertView(a.Id.ToString(), a.Severity, a.Module, a.Title, a.Message, ToUtc(a.CreatedAt)))
            .ToList();

        return new ActiveAlertsPage(items, total, page, limit);
    }

    public async Task<IReadOnlyList<ActionPlanAlertView>> GetActionPlanAlertsAsync(
        string organizationId, ScopePredicate scopeWhere, DateTime horizon, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var txScope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // 1. Candidates = org ∩ (status != 'completed') ∩ (dueDate <= horizon). A NULL dueDate never
        //    satisfies `<=` in SQL, exactly as Prisma's `dueDate: { lte: horizon }` excludes NULL.
        var candidateIds = await _db.ActionPlans.AsNoTracking()
            .Where(p => p.OrganizationId == orgId && p.Status != "completed" && p.DueDate <= horizon)
            .Select(p => p.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        // 2. Row scope: out-of-scope plans silently drop (unit/team/own callers hold monitoring:read too).
        var allowed = await FilterInScopeAsync(scopeWhere, orgId, candidateIds, cancellationToken).ConfigureAwait(false);
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
            .OrderBy(x => x.p.DueDate)
            .Select(x => new
            {
                x.p.Id,
                x.p.Title,
                x.p.Area,
                x.p.Status,
                x.p.DueDate,
                ResponsibleUserId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await txScope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(x => new ActionPlanAlertView(
            x.Id.ToString(),
            x.Title,
            x.Area,
            x.Status,
            ToUtcNullable(x.DueDate),
            new ActionPlanAlertResponsible(
                x.ResponsibleUserId.ToString(), x.FirstName, x.LastName, x.Avatar))).ToList();
    }

    public async Task<IReadOnlyList<int>> GetSurveyResponseCountsAsync(
        string organizationId, IReadOnlyList<(DateTime Start, DateTime End)> window, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var counts = new List<int>(window.Count);
        foreach (var (start, end) in window)
        {
            counts.Add(await _db.SurveyResponses.AsNoTracking()
                .CountAsync(
                    r => r.OrganizationId == orgId && r.SubmittedAt >= start && r.SubmittedAt <= end,
                    cancellationToken).ConfigureAwait(false));
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return counts;
    }

    public async Task<IReadOnlyList<int>> GetHeadcountCountsAsync(
        string organizationId, IReadOnlyList<(DateTime Start, DateTime End)> window, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var counts = new List<int>(window.Count);
        foreach (var (_, end) in window)
        {
            // CUMULATIVE by design: the TS reader filters `createdAt: { lte: monthEnd }` with NO lower
            // bound, so each point is "active users created up to the end of that month", not a bucket.
            counts.Add(await _db.Users.AsNoTracking()
                .CountAsync(
                    u => u.OrganizationId == orgId && u.IsActive && u.CreatedAt <= end,
                    cancellationToken).ConfigureAwait(false));
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return counts;
    }

    public async Task<IReadOnlyList<int>> GetAlertCountsAsync(
        string organizationId, IReadOnlyList<(DateTime Start, DateTime End)> window, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var counts = new List<int>(window.Count);
        foreach (var (start, end) in window)
        {
            // NOTE: no status filter — the TS trend counts alerts CREATED in the month whatever their
            // current status, unlike the `openAlerts` KPI which filters status='active'.
            counts.Add(await _db.Alerts.AsNoTracking()
                .CountAsync(
                    a => a.OrganizationId == orgId && a.CreatedAt >= start && a.CreatedAt <= end,
                    cancellationToken).ConfigureAwait(false));
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return counts;
    }

    public async Task<IReadOnlyList<AlertRuleView>> GetAlertRulesAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.AlertRules.AsNoTracking()
            .Where(r => r.OrganizationId == orgId)
            .OrderBy(r => r.Module)
            .Select(r => new { r.Id, r.Module, r.Condition, r.Severity, r.Message, r.IsActive })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows
            .Select(r => new AlertRuleView(
                r.Id.ToString(), r.Module, ParseNode(r.Condition), r.Severity, r.Message, r.IsActive))
            .ToList();
    }

    // ── helpers ───────────────────────────────────────────────────────────────────

    // Reuse the scope→SQL translator: surviving ids = candidate ∩ org ∩ scope over action_plans.
    // Identifiers (the table, the translated column) are fixed ScopeProbeRegistry constants; every
    // id/value is a bound Npgsql parameter — never interpolated. Empty candidate set → no query.
    private async Task<HashSet<Guid>> FilterInScopeAsync(
        ScopePredicate predicate, Guid orgId, IReadOnlyCollection<Guid> candidateIds, CancellationToken cancellationToken)
    {
        var result = new HashSet<Guid>();
        if (candidateIds.Count == 0)
        {
            return result;
        }

        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        var translated = ScopePredicateSqlTranslator.Translate(ActionPlansTable, predicate);
        var sql = $"SELECT t.id FROM {ActionPlansTable} t "
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

    private static JsonNode? ParseNode(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonNode.Parse(json);

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads Kind=Unspecified); reinterpret as UTC.
    private static DateTimeOffset ToUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? ToUtcNullable(DateTime? value) => value is null ? null : ToUtc(value.Value);
}
