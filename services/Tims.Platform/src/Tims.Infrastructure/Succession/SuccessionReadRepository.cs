using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Application.Succession;
using Tims.Domain.Access;
using Tims.Domain.Succession;

namespace Tims.Infrastructure.Succession;

/// <summary>
/// Read-only EF implementation of <see cref="ISuccessionReadRepository"/> — a faithful port of the nine READ
/// bodies of the TS <c>succession</c> router. Every query is <c>AsNoTracking()</c> and runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT
/// <c>organizationId</c> filter (defense-in-depth). NEVER logs row content.
///
/// The row-scoped reads (listCriticalRoles / getCriticalRole / getSuggestedSuccessors / simulateExit) compose
/// the caller's <see cref="ScopePredicate"/> via <see cref="ScopePredicateSqlTranslator"/> (reused, not
/// re-ported) as an <c>id [= ANY(@ids)] AND (predicate)</c> filter so out-of-scope critical_roles / successors
/// / nine_box_evaluations rows silently drop — the team-intel <c>compareTeams</c> pattern. Prisma
/// <c>timestamp(3)</c> columns are read as Unspecified-kind wall-clock UTC and re-kinded to UTC here.
///
/// getCompGapAlerts builds its employee_compensations SELECT column list from the caller's entitlement
/// (<c>selectFor</c>) BEFORE the query, so the restricted <c>current_salary</c>/<c>currency</c> only LEAVE the
/// DB for entitled roles — never selected-then-nulled (db.md / api-security.md §21).
/// </summary>
public sealed class SuccessionReadRepository(SuccessionReadDbContext db) : ISuccessionReadRepository
{
    private const string ReadyNow = "ready_now";
    private const string HighFlightRiskThreshold = "0.7"; // documented default (matches getDashboardKpis)

    private readonly SuccessionReadDbContext _db = db;

    public async Task<IReadOnlyList<ListCriticalRoleRow>> ListCriticalRolesAsync(
        string organizationId,
        CriticalRoleFilters filters,
        ScopePredicate roleScope,
        ScopePredicate successorScope,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        // 1. Candidate role ids = org + input filters (bounded), then translator-filter to the caller's scope.
        var candidateRoleIds = await _db.CriticalRoles.AsNoTracking()
            .Where(r => r.OrganizationId == orgId)
            .Where(r => filters.CompanyId == null || r.CompanyId == filters.CompanyId)
            .Where(r => filters.UnitId == null || r.UnitId == filters.UnitId)
            .Where(r => filters.Criticality == null || r.Criticality == filters.Criticality)
            .Where(r => filters.Search == null || EF.Functions.ILike(r.Title, "%" + filters.Search + "%"))
            .Select(r => r.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var allowedRoleIds = await FilterInScopeAsync(
            connection, transaction, "critical_roles", roleScope, orgId, candidateRoleIds, cancellationToken)
            .ConfigureAwait(false);
        if (allowedRoleIds.Count == 0)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return [];
        }

        // 2. Load the surviving roles (title asc) + their holders + their scope-filtered successors.
        var roles = await _db.CriticalRoles.AsNoTracking()
            .Where(r => r.OrganizationId == orgId && allowedRoleIds.Contains(r.Id))
            .OrderBy(r => r.Title)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var roleIds = roles.Select(r => r.Id).ToList();

        var holders = await LoadHoldersAsync(orgId, roles.Select(r => r.CurrentHolderId), cancellationToken)
            .ConfigureAwait(false);

        var successorsByRole = await LoadScopedSuccessorsAsync(
            connection, transaction, orgId, roleIds, successorScope, cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return roles.Select(r => new ListCriticalRoleRow(
            r.Id.ToString(),
            r.OrganizationId.ToString(),
            r.Title,
            r.PositionId,
            r.CurrentHolderId?.ToString(),
            r.CompanyId?.ToString(),
            r.UnitId?.ToString(),
            r.Criticality,
            r.FlightRisk,
            r.TargetBandLevel,
            ToUtc(r.CreatedAt),
            ToUtc(r.UpdatedAt),
            HolderBasicFor(r.CurrentHolderId, holders),
            successorsByRole.TryGetValue(r.Id, out var list) ? list : [])).ToList();
    }

    public async Task<CriticalRoleDetailRow?> GetCriticalRoleAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate successorScope,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        var role = await _db.CriticalRoles.AsNoTracking()
            .Where(r => r.Id == criticalRoleId && r.OrganizationId == orgId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (role is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        // Holder select for getCriticalRole INCLUDES email (unlike listCriticalRoles).
        HolderWithEmail? holder = null;
        if (role.CurrentHolderId is { } holderId)
        {
            holder = await _db.Users.AsNoTracking()
                .Where(u => u.Id == holderId && u.OrganizationId == orgId)
                .Select(u => new HolderWithEmail(
                    u.Id.ToString(), u.FirstName, u.LastName, u.Avatar, u.JobTitle, u.Email))
                .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        }

        // Scope-filtered successors (createdAt asc) + user + addedByUser.
        var candidateIds = await _db.Successors.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && s.CriticalRoleId == criticalRoleId)
            .Select(s => s.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var allowed = await FilterInScopeAsync(
            connection, transaction, "successors", successorScope, orgId, candidateIds, cancellationToken)
            .ConfigureAwait(false);

        var successorRows = await _db.Successors.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && s.CriticalRoleId == criticalRoleId && allowed.Contains(s.Id))
            .Join(_db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId), s => s.UserId, u => u.Id, (s, u) => new { s, u })
            .OrderBy(x => x.s.CreatedAt)
            .Select(x => new
            {
                x.s.Id,
                x.s.OrganizationId,
                x.s.CriticalRoleId,
                x.s.UserId,
                x.s.Readiness,
                x.s.Type,
                x.s.DevelopmentPlan,
                x.s.AddedById,
                x.s.CreatedAt,
                x.s.UpdatedAt,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
                x.u.JobTitle,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var addedBy = await LoadAddedByAsync(orgId, successorRows.Select(s => s.AddedById), cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var successors = successorRows.Select(s => new DetailSuccessorRow(
            s.Id.ToString(),
            s.OrganizationId.ToString(),
            s.CriticalRoleId.ToString(),
            s.UserId.ToString(),
            s.Readiness,
            s.Type,
            s.DevelopmentPlan,
            s.AddedById?.ToString(),
            ToUtc(s.CreatedAt),
            ToUtc(s.UpdatedAt),
            new SuccessorUser(s.UId.ToString(), s.FirstName, s.LastName, s.Avatar, s.JobTitle),
            s.AddedById is { } abid && addedBy.TryGetValue(abid, out var ab) ? ab : null)).ToList();

        return new CriticalRoleDetailRow(
            role.Id.ToString(),
            role.OrganizationId.ToString(),
            role.Title,
            role.PositionId,
            role.CurrentHolderId?.ToString(),
            role.CompanyId?.ToString(),
            role.UnitId?.ToString(),
            role.Criticality,
            role.FlightRisk,
            role.TargetBandLevel,
            ToUtc(role.CreatedAt),
            ToUtc(role.UpdatedAt),
            holder,
            successors);
    }

    public async Task<IReadOnlyList<FlightRiskRow>> GetFlightRiskAsync(
        string organizationId, double threshold, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var roles = await _db.CriticalRoles.AsNoTracking()
            .Where(r => r.OrganizationId == orgId && r.FlightRisk >= threshold)
            .OrderByDescending(r => r.FlightRisk)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var roleIds = roles.Select(r => r.Id).ToList();

        var holders = await LoadHoldersAsync(orgId, roles.Select(r => r.CurrentHolderId), cancellationToken)
            .ConfigureAwait(false);

        // _count.successors per role.
        var counts = (await _db.Successors.AsNoTracking()
                .Where(s => s.OrganizationId == orgId && roleIds.Contains(s.CriticalRoleId))
                .GroupBy(s => s.CriticalRoleId)
                .Select(g => new { RoleId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken).ConfigureAwait(false))
            .ToDictionary(x => x.RoleId, x => x.Count);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return roles.Select(r => new FlightRiskRow(
            r.Id.ToString(),
            r.OrganizationId.ToString(),
            r.Title,
            r.PositionId,
            r.CurrentHolderId?.ToString(),
            r.CompanyId?.ToString(),
            r.UnitId?.ToString(),
            r.Criticality,
            r.FlightRisk,
            r.TargetBandLevel,
            ToUtc(r.CreatedAt),
            ToUtc(r.UpdatedAt),
            r.CurrentHolderId is { } hid && holders.TryGetValue(hid, out var h)
                ? new FlightRiskHolder(h.Id, h.FirstName, h.LastName, h.Avatar)
                : null,
            new CriticalRoleCount(counts.TryGetValue(r.Id, out var c) ? c : 0))).ToList();
    }

    public async Task<IReadOnlyList<CoverageRoleInput>> GetCoverageRolesAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var roles = await _db.CriticalRoles.AsNoTracking()
            .Where(r => r.OrganizationId == orgId)
            .OrderBy(r => r.Id) // TS has no orderBy here; deterministic output for the C# read
            .Select(r => new { r.Id, r.Title, r.Criticality })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var roleIds = roles.Select(r => r.Id).ToList();

        var readinessByRole = (await _db.Successors.AsNoTracking()
                .Where(s => s.OrganizationId == orgId && roleIds.Contains(s.CriticalRoleId))
                .Select(s => new { s.CriticalRoleId, s.Readiness })
                .ToListAsync(cancellationToken).ConfigureAwait(false))
            .GroupBy(s => s.CriticalRoleId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Readiness).ToList());

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return roles.Select(r => new CoverageRoleInput(
            r.Id.ToString(),
            r.Title,
            r.Criticality,
            (readinessByRole.TryGetValue(r.Id, out var rs) ? rs : [])
                .Select(readiness => new CoverageSuccessorInput(readiness)).ToList())).ToList();
    }

    public async Task<IReadOnlyList<RoleWithoutSuccessorRow>> GetRolesWithoutSuccessorAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var roles = await _db.CriticalRoles.AsNoTracking()
            .Where(r => r.OrganizationId == orgId
                && !_db.Successors.Any(s => s.CriticalRoleId == r.Id && s.OrganizationId == orgId))
            .OrderBy(r => r.Criticality)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var holders = await LoadHoldersAsync(orgId, roles.Select(r => r.CurrentHolderId), cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return roles.Select(r => new RoleWithoutSuccessorRow(
            r.Id.ToString(),
            r.OrganizationId.ToString(),
            r.Title,
            r.PositionId,
            r.CurrentHolderId?.ToString(),
            r.CompanyId?.ToString(),
            r.UnitId?.ToString(),
            r.Criticality,
            r.FlightRisk,
            r.TargetBandLevel,
            ToUtc(r.CreatedAt),
            ToUtc(r.UpdatedAt),
            HolderBasicFor(r.CurrentHolderId, holders))).ToList();
    }

    public async Task<SuccessionKpiCounts> GetDashboardCountsAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var threshold = double.Parse(HighFlightRiskThreshold, System.Globalization.CultureInfo.InvariantCulture);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var totalRoles = await _db.CriticalRoles.AsNoTracking()
            .CountAsync(r => r.OrganizationId == orgId, cancellationToken).ConfigureAwait(false);
        var totalSuccessors = await _db.Successors.AsNoTracking()
            .CountAsync(s => s.OrganizationId == orgId, cancellationToken).ConfigureAwait(false);
        var rolesWithoutSuccessor = await _db.CriticalRoles.AsNoTracking()
            .CountAsync(r => r.OrganizationId == orgId
                && !_db.Successors.Any(s => s.CriticalRoleId == r.Id && s.OrganizationId == orgId),
                cancellationToken).ConfigureAwait(false);
        var highFlightRisk = await _db.CriticalRoles.AsNoTracking()
            .CountAsync(r => r.OrganizationId == orgId && r.FlightRisk >= threshold, cancellationToken)
            .ConfigureAwait(false);
        var readyNow = await _db.Successors.AsNoTracking()
            .CountAsync(s => s.OrganizationId == orgId && s.Readiness == ReadyNow, cancellationToken)
            .ConfigureAwait(false);
        var ready1To2 = await _db.Successors.AsNoTracking()
            .CountAsync(s => s.OrganizationId == orgId
                && (s.Readiness == "ready_1_year" || s.Readiness == "ready_2_years"), cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new SuccessionKpiCounts(
            totalRoles, totalSuccessors, rolesWithoutSuccessor, readyNow, ready1To2, highFlightRisk);
    }

    public async Task<CompGapData> GetCompGapDataAsync(
        string organizationId,
        bool includeCurrentSalary,
        bool includeCurrency,
        ScopePredicate compScope,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        // Only roles that opted into a target band can ever produce an alert.
        var bandedRoles = await _db.CriticalRoles.AsNoTracking()
            .Where(r => r.OrganizationId == orgId && r.TargetBandLevel != null)
            .Select(r => new { r.Id, r.Title, r.TargetBandLevel })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var bandedRoleIds = bandedRoles.Select(r => r.Id).ToList();

        // ready_now successors of those roles (+ user id/name/avatar).
        var readyNowRows = await _db.Successors.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && bandedRoleIds.Contains(s.CriticalRoleId) && s.Readiness == ReadyNow)
            .Join(_db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId), s => s.UserId, u => u.Id, (s, u) => new { s, u })
            .Select(x => new
            {
                x.s.Id,
                x.s.CriticalRoleId,
                x.s.UserId,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var successorsByRole = readyNowRows
            .GroupBy(s => s.CriticalRoleId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<CompGapSuccessorInput>)g
                    .Select(s => new CompGapSuccessorInput(
                        s.Id.ToString(),
                        s.UserId.ToString(),
                        new CompGapUser(s.UId.ToString(), s.FirstName, s.LastName, s.Avatar)))
                    .ToList());

        var candidateRoles = bandedRoles
            .Where(r => successorsByRole.ContainsKey(r.Id))
            .Select(r => new CompGapRoleInput(
                r.Id.ToString(), r.Title, r.TargetBandLevel, successorsByRole[r.Id]))
            .ToList();

        if (candidateRoles.Count == 0)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new CompGapData([], [], []);
        }

        // Soft level match: targetBandLevel → salary_bands.level.
        var levels = candidateRoles
            .Select(r => r.TargetBandLevel!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var bands = await _db.SalaryBands.AsNoTracking()
            .Where(b => b.OrganizationId == orgId && levels.Contains(b.Level))
            .Select(b => new CompGapBandInput(b.Level, b.MidSalary))
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        // §21: build the employee_compensations SELECT columns from selectFor BEFORE the query, so the
        // restricted current_salary/currency LEAVE the DB only for entitled roles (never selected-then-nulled).
        var userIds = readyNowRows.Select(s => s.UserId).Distinct().ToArray();
        var comps = await LoadCompensationsAsync(
            connection, transaction, orgId, userIds, includeCurrentSalary, includeCurrency, compScope, cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new CompGapData(candidateRoles, bands, comps);
    }

    public async Task<SuggestedData> GetSuggestedDataAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate evaluationScope,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        // Scope-filter ALL org evaluations (no natural candidate bound — the read wants every scoped eval).
        var allowed = await FilterInScopeAsync(
            connection, transaction, "nine_box_evaluations", evaluationScope, orgId, null, cancellationToken)
            .ConfigureAwait(false);

        var evaluations = allowed.Count == 0
            ? new List<SuggestedEvaluationInput>()
            : (await _db.NineBoxEvaluations.AsNoTracking()
                    .Where(e => e.OrganizationId == orgId && allowed.Contains(e.Id))
                    .Join(_db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId), e => e.UserId, u => u.Id, (e, u) => new { e, u })
                    .OrderByDescending(x => x.e.EvaluatedAt)
                    .ThenByDescending(x => x.e.CreatedAt)
                    .Select(x => new
                    {
                        x.e.UserId,
                        x.e.Quadrant,
                        x.e.PotentialScore,
                        x.e.PerformanceScore,
                        UId = x.u.Id,
                        x.u.FirstName,
                        x.u.LastName,
                        x.u.Avatar,
                        x.u.JobTitle,
                    })
                    .ToListAsync(cancellationToken).ConfigureAwait(false))
                .Select(x => new SuggestedEvaluationInput(
                    x.UserId.ToString(),
                    x.Quadrant,
                    x.PotentialScore,
                    x.PerformanceScore,
                    new SuggestedUser(x.UId.ToString(), x.FirstName, x.LastName, x.Avatar, x.JobTitle)))
                .ToList();

        var existing = await _db.Successors.AsNoTracking()
            .Where(s => s.CriticalRoleId == criticalRoleId && s.OrganizationId == orgId)
            .Select(s => s.UserId)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new SuggestedData(evaluations, existing.Select(u => u.ToString()).ToList());
    }

    public async Task<ExitData?> GetSimulateExitDataAsync(
        string organizationId,
        Guid criticalRoleId,
        ScopePredicate successorScope,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        var role = await _db.CriticalRoles.AsNoTracking()
            .Where(r => r.Id == criticalRoleId && r.OrganizationId == orgId)
            .Select(r => new { r.Id, r.Title, r.Criticality, r.CurrentHolderId })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (role is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        ExitHolder? holder = null;
        if (role.CurrentHolderId is { } holderId)
        {
            holder = await _db.Users.AsNoTracking()
                .Where(u => u.Id == holderId && u.OrganizationId == orgId)
                .Select(u => new ExitHolder(u.Id.ToString(), u.FirstName, u.LastName))
                .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        }

        var candidateIds = await _db.Successors.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && s.CriticalRoleId == criticalRoleId)
            .Select(s => s.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var allowed = await FilterInScopeAsync(
            connection, transaction, "successors", successorScope, orgId, candidateIds, cancellationToken)
            .ConfigureAwait(false);

        var successorRows = await _db.Successors.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && s.CriticalRoleId == criticalRoleId && allowed.Contains(s.Id))
            .Join(_db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId), s => s.UserId, u => u.Id, (s, u) => new { s, u })
            .OrderBy(x => x.s.Readiness)
            .Select(x => new
            {
                x.s.Id,
                x.s.OrganizationId,
                x.s.CriticalRoleId,
                x.s.UserId,
                x.s.Readiness,
                x.s.Type,
                x.s.DevelopmentPlan,
                x.s.AddedById,
                x.s.CreatedAt,
                x.s.UpdatedAt,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.JobTitle,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var successors = successorRows.Select(s => new ExitSuccessorRow(
            s.Id.ToString(),
            s.OrganizationId.ToString(),
            s.CriticalRoleId.ToString(),
            s.UserId.ToString(),
            s.Readiness,
            s.Type,
            s.DevelopmentPlan,
            s.AddedById?.ToString(),
            ToUtc(s.CreatedAt),
            ToUtc(s.UpdatedAt),
            new ExitSuccessorUserView(s.UId.ToString(), s.FirstName, s.LastName, s.JobTitle))).ToList();

        return new ExitData(
            new ExitRole(role.Id.ToString(), role.Title, role.Criticality),
            holder,
            successors);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private (NpgsqlConnection Connection, NpgsqlTransaction Transaction) RawHandles()
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();
        return (connection, transaction);
    }

    // Reuse the scope→SQL translator: surviving ids = [candidate ∩] org ∩ scope. Identifiers ({table}, the
    // translated columns) are fixed registry constants; every id/value is a bound Npgsql parameter — never
    // interpolated. candidateIds == null → filter ALL in-org rows (no id bound).
    private static async Task<HashSet<Guid>> FilterInScopeAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string table,
        ScopePredicate predicate,
        Guid orgId,
        IReadOnlyCollection<Guid>? candidateIds,
        CancellationToken cancellationToken)
    {
        var result = new HashSet<Guid>();
        if (candidateIds is { Count: 0 })
        {
            return result;
        }

        var translated = ScopePredicateSqlTranslator.Translate(table, predicate);
        var idClause = candidateIds is null ? string.Empty : "t.id = ANY(@ids) AND ";
        var sql = $"SELECT t.id FROM {table} t WHERE {idClause}t.organization_id = @org AND ({translated.Sql})";

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        if (candidateIds is not null)
        {
            command.Parameters.AddWithValue("ids", candidateIds.ToArray());
        }

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

    // §21: build the SELECT column list from the caller's selectFor entitlement so current_salary/currency
    // are read from the DB ONLY when entitled (absent → CompGapCompInput field null → kernel skips). Column
    // names are fixed constants; user_id set is a bound parameter.
    private static async Task<IReadOnlyList<CompGapCompInput>> LoadCompensationsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid orgId,
        Guid[] userIds,
        bool includeCurrentSalary,
        bool includeCurrency,
        ScopePredicate compScope,
        CancellationToken cancellationToken)
    {
        var comps = new List<CompGapCompInput>();
        if (userIds.Length == 0)
        {
            return comps;
        }

        var columns = "id, user_id";
        if (includeCurrentSalary)
        {
            columns += ", current_salary";
        }

        if (includeCurrency)
        {
            columns += ", currency";
        }

        // Codex hardening: AND the caller's employeeCompensation scope predicate as an extra ROW filter (the
        // C# analog of the Prisma AND [{ userId IN }, compScopeWhere]). Table aliased t so the translator's
        // `t.<col>` output resolves; identifiers are fixed registry constants, every value a bound parameter.
        // MatchAll (org/company scope) → TRUE → semantic no-op (behavior-identical to before the row filter).
        var translated = ScopePredicateSqlTranslator.Translate("employee_compensations", compScope);
        var sql = $"SELECT {columns} FROM employee_compensations t "
            + $"WHERE t.organization_id = @org AND t.user_id = ANY(@uids) AND ({translated.Sql})";

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("org", orgId);
        command.Parameters.AddWithValue("uids", userIds);
        for (var i = 0; i < translated.Parameters.Count; i++)
        {
            command.Parameters.AddWithValue($"p{i}", translated.Parameters[i]);
        }

        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var salaryOrdinal = includeCurrentSalary ? reader.GetOrdinal("current_salary") : -1;
        var currencyOrdinal = includeCurrency ? reader.GetOrdinal("currency") : -1;
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            comps.Add(new CompGapCompInput(
                reader.GetGuid(0).ToString(),
                reader.GetGuid(1).ToString(),
                salaryOrdinal >= 0 ? reader.GetDouble(salaryOrdinal) : null,
                currencyOrdinal >= 0 ? reader.GetString(currencyOrdinal) : null));
        }

        return comps;
    }

    private async Task<Dictionary<Guid, HolderBasic>> LoadHoldersAsync(
        Guid orgId, IEnumerable<Guid?> holderIds, CancellationToken cancellationToken)
    {
        var ids = holderIds.Where(id => id is not null).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0)
        {
            return new Dictionary<Guid, HolderBasic>();
        }

        return (await _db.Users.AsNoTracking()
                .Where(u => ids.Contains(u.Id) && u.OrganizationId == orgId)
                .Select(u => new { u.Id, u.FirstName, u.LastName, u.Avatar, u.JobTitle })
                .ToListAsync(cancellationToken).ConfigureAwait(false))
            .ToDictionary(
                u => u.Id,
                u => new HolderBasic(u.Id.ToString(), u.FirstName, u.LastName, u.Avatar, u.JobTitle));
    }

    private async Task<Dictionary<Guid, SuccessorAddedBy>> LoadAddedByAsync(
        Guid orgId, IEnumerable<Guid?> addedByIds, CancellationToken cancellationToken)
    {
        var ids = addedByIds.Where(id => id is not null).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0)
        {
            return new Dictionary<Guid, SuccessorAddedBy>();
        }

        return (await _db.Users.AsNoTracking()
                .Where(u => ids.Contains(u.Id) && u.OrganizationId == orgId)
                .Select(u => new { u.Id, u.FirstName, u.LastName })
                .ToListAsync(cancellationToken).ConfigureAwait(false))
            .ToDictionary(
                u => u.Id,
                u => new SuccessorAddedBy(u.Id.ToString(), u.FirstName, u.LastName));
    }

    private async Task<Dictionary<Guid, IReadOnlyList<ListSuccessorRow>>> LoadScopedSuccessorsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid orgId,
        IReadOnlyList<Guid> roleIds,
        ScopePredicate successorScope,
        CancellationToken cancellationToken)
    {
        var candidateIds = await _db.Successors.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && roleIds.Contains(s.CriticalRoleId))
            .Select(s => s.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var allowed = await FilterInScopeAsync(
            connection, transaction, "successors", successorScope, orgId, candidateIds, cancellationToken)
            .ConfigureAwait(false);

        var rows = await _db.Successors.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && roleIds.Contains(s.CriticalRoleId) && allowed.Contains(s.Id))
            .Join(_db.Users.AsNoTracking().Where(u => u.OrganizationId == orgId), s => s.UserId, u => u.Id, (s, u) => new { s, u })
            .OrderBy(x => x.s.CreatedAt)
            .Select(x => new
            {
                x.s.Id,
                x.s.OrganizationId,
                x.s.CriticalRoleId,
                x.s.UserId,
                x.s.Readiness,
                x.s.Type,
                x.s.DevelopmentPlan,
                x.s.AddedById,
                x.s.CreatedAt,
                x.s.UpdatedAt,
                UId = x.u.Id,
                x.u.FirstName,
                x.u.LastName,
                x.u.Avatar,
                x.u.JobTitle,
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        return rows
            .GroupBy(s => s.CriticalRoleId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<ListSuccessorRow>)g.Select(s => new ListSuccessorRow(
                    s.Id.ToString(),
                    s.OrganizationId.ToString(),
                    s.CriticalRoleId.ToString(),
                    s.UserId.ToString(),
                    s.Readiness,
                    s.Type,
                    s.DevelopmentPlan,
                    s.AddedById?.ToString(),
                    ToUtc(s.CreatedAt),
                    ToUtc(s.UpdatedAt),
                    new SuccessorUser(s.UId.ToString(), s.FirstName, s.LastName, s.Avatar, s.JobTitle))).ToList());
    }

    private static HolderBasic? HolderBasicFor(Guid? holderId, IReadOnlyDictionary<Guid, HolderBasic> holders) =>
        holderId is { } id && holders.TryGetValue(id, out var holder) ? holder : null;

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads Kind=Unspecified); re-kind to UTC so
    // the shared Node-ISO converter emits the same `…fffZ` wire form Node's Date.toISOString() produces.
    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
