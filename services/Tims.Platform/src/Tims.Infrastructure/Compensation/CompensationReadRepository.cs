using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Application.Compensation;
using Tims.Domain.Access;
using Tims.Domain.Compensation;
using Tims.Domain.Json;

namespace Tims.Infrastructure.Compensation;

/// <summary>
/// Read-only EF implementation of <see cref="ICompensationReadRepository"/> — a faithful port of the seven
/// FX-free READ bodies of the TS <c>compensation</c> router. Every query is <c>AsNoTracking()</c> and runs
/// UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT
/// <c>organizationId</c> filter (defense-in-depth). NEVER logs row content.
///
/// The field-authed reads build their SELECT column list from the caller's <c>selectFor</c> entitlement BEFORE
/// the query (raw parameterized SQL), so the restricted columns LEAVE the DB only for entitled roles — never
/// selected-then-nulled (db.md / api-security.md §21). listPendingAdjustments ALSO composes the caller's
/// <c>scopeWhereFor('salaryAdjustment')</c> <see cref="ScopePredicate"/> via
/// <see cref="ScopePredicateSqlTranslator"/> as an AND row filter (out-of-scope rows silently drop). All
/// identifiers ({column}) are fixed constants; every id/value is a bound Npgsql parameter — never interpolated.
/// </summary>
public sealed class CompensationReadRepository(CompensationReadDbContext db) : ICompensationReadRepository
{
    private const string SalaryAdjustmentsTable = "salary_adjustments";
    private readonly CompensationReadDbContext _db = db;

    // ── Read 1: getSalaryBands (raw model, orderBy level asc) ───────────────────
    public async Task<IReadOnlyList<SalaryBandRow>> GetSalaryBandsAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var bands = await _db.SalaryBands.AsNoTracking()
            .Where(b => b.OrganizationId == orgId)
            .OrderBy(b => b.Level)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return bands.Select(b => new SalaryBandRow(
            b.Id.ToString(),
            b.OrganizationId.ToString(),
            b.Level,
            b.Title,
            b.MinSalary,
            b.MidSalary,
            b.MaxSalary,
            b.Currency,
            b.IsActive,
            ToUtc(b.CreatedAt),
            ToUtc(b.UpdatedAt))).ToList();
    }

    // ── Read 2: getMarketComparison (projection, optional level filter) ─────────
    public async Task<IReadOnlyList<MarketComparisonRow>> GetMarketComparisonAsync(
        string organizationId, string? jobLevel, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var bands = await _db.SalaryBands.AsNoTracking()
            .Where(b => b.OrganizationId == orgId)
            .Where(b => jobLevel == null || b.Level == jobLevel)
            .OrderBy(b => b.Level)
            .Select(b => new { b.Level, b.Title, b.MinSalary, b.MidSalary, b.MaxSalary, b.Currency })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return bands.Select(b => new MarketComparisonRow(
            b.Level, b.Title, b.MinSalary, b.MidSalary, b.MaxSalary, b.Currency)).ToList();
    }

    // ── Read 3: getBenefitsUtilization (plans + enrolled counts + active users) ──
    public async Task<BenefitsUtilizationData> GetBenefitsUtilizationDataAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var plans = await _db.BenefitPlans.AsNoTracking()
            .Where(p => p.OrganizationId == orgId)
            .OrderBy(p => p.Name)
            .Select(p => new { p.Id, p.Name, p.Type })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var enrollmentCounts = (await _db.BenefitEnrollments.AsNoTracking()
                .Where(e => e.OrganizationId == orgId)
                .GroupBy(e => e.BenefitPlanId)
                .Select(g => new { PlanId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken).ConfigureAwait(false))
            .ToDictionary(x => x.PlanId, x => x.Count);

        var totalUsers = await _db.Users.AsNoTracking()
            .CountAsync(u => u.OrganizationId == orgId && u.IsActive, cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var inputs = plans.Select(p => new BenefitPlanInput(
            p.Id.ToString(),
            p.Name,
            p.Type,
            enrollmentCounts.TryGetValue(p.Id, out var c) ? c : 0)).ToList();
        return new BenefitsUtilizationData(inputs, totalUsers);
    }

    // ── Read 4: getCompaRatioDistribution (currentSalary + compaRatio rows) ─────
    public async Task<IReadOnlyList<CompaRatioRow>> GetCompaRatioRowsAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.EmployeeCompensations.AsNoTracking()
            .Where(c => c.OrganizationId == orgId)
            .Select(c => new CompaRatioRow(c.CurrentSalary, c.CompaRatio))
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows;
    }

    // ── Read 5: listPendingAdjustments (field-authed + scopeWhereFor row filter + audit ids) ──
    public async Task<PendingAdjustmentsResult> ListPendingAdjustmentsAsync(
        string organizationId,
        IReadOnlyList<string> adjustmentFields,
        ScopePredicate scope,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var tenant = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        var fields = new HashSet<string>(adjustmentFields, StringComparer.Ordinal);
        var hasPrev = fields.Contains("previousSalary");
        var hasNew = fields.Contains("newSalary");
        var hasCurrency = fields.Contains("currency");
        var hasReason = fields.Contains("reason");
        var hasType = fields.Contains("type");
        var hasStatus = fields.Contains("status");

        // id + createdAt are ALWAYS selected (hardcoded in the router select, not classified); the restricted
        // fields are selected ONLY when selectFor entitles them (never selected-then-nulled).
        var columns = new List<string> { "t.id AS sa_id", "t.created_at AS sa_created" };
        if (hasPrev)
        {
            columns.Add("t.previous_salary AS sa_prev");
        }

        if (hasNew)
        {
            columns.Add("t.new_salary AS sa_new");
        }

        if (hasCurrency)
        {
            columns.Add("t.currency AS sa_cur");
        }

        if (hasReason)
        {
            columns.Add("t.reason AS sa_reason");
        }

        if (hasType)
        {
            columns.Add("t.type AS sa_type");
        }

        if (hasStatus)
        {
            columns.Add("t.status AS sa_status");
        }

        columns.AddRange(new[]
        {
            "u.id AS u_id", "u.first_name AS u_first", "u.last_name AS u_last", "u.job_title AS u_job",
            "r.id AS r_id", "r.first_name AS r_first", "r.last_name AS r_last",
        });

        // scopeWhereFor('salaryAdjustment') → SubjectAsync("userId") row filter, ANDed. MatchAll → TRUE no-op.
        var translated = ScopePredicateSqlTranslator.Translate(SalaryAdjustmentsTable, scope);
        var sql = $"SELECT {string.Join(", ", columns)} FROM {SalaryAdjustmentsTable} t "
            + "JOIN users u ON u.id = t.user_id "
            + "JOIN users r ON r.id = t.requested_by_id "
            + $"WHERE t.organization_id = @org AND t.status = 'pending' AND ({translated.Sql}) "
            + "ORDER BY t.created_at DESC";

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("org", orgId);
        for (var i = 0; i < translated.Parameters.Count; i++)
        {
            command.Parameters.AddWithValue($"p{i}", translated.Parameters[i]);
        }

        var rows = new List<JsonObject>();
        var recordIds = new List<string>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false))
        {
            var ordId = reader.GetOrdinal("sa_id");
            var ordCreated = reader.GetOrdinal("sa_created");
            var ordPrev = hasPrev ? reader.GetOrdinal("sa_prev") : -1;
            var ordNew = hasNew ? reader.GetOrdinal("sa_new") : -1;
            var ordCur = hasCurrency ? reader.GetOrdinal("sa_cur") : -1;
            var ordReason = hasReason ? reader.GetOrdinal("sa_reason") : -1;
            var ordType = hasType ? reader.GetOrdinal("sa_type") : -1;
            var ordStatus = hasStatus ? reader.GetOrdinal("sa_status") : -1;
            var ordUId = reader.GetOrdinal("u_id");
            var ordUFirst = reader.GetOrdinal("u_first");
            var ordULast = reader.GetOrdinal("u_last");
            var ordUJob = reader.GetOrdinal("u_job");
            var ordRId = reader.GetOrdinal("r_id");
            var ordRFirst = reader.GetOrdinal("r_first");
            var ordRLast = reader.GetOrdinal("r_last");

            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var id = reader.GetGuid(ordId).ToString();
                var row = new JsonObject
                {
                    ["id"] = id,
                    ["createdAt"] = NodeIsoDateTimeOffsetConverter.ToNodeIso(ToUtc(reader.GetDateTime(ordCreated))),
                };

                if (hasPrev)
                {
                    row["previousSalary"] = reader.GetDouble(ordPrev);
                }

                if (hasNew)
                {
                    row["newSalary"] = reader.GetDouble(ordNew);
                }

                if (hasCurrency)
                {
                    row["currency"] = reader.GetString(ordCur);
                }

                if (hasReason)
                {
                    row["reason"] = reader.IsDBNull(ordReason) ? null : JsonValue.Create(reader.GetString(ordReason));
                }

                if (hasType)
                {
                    row["type"] = reader.GetString(ordType);
                }

                if (hasStatus)
                {
                    row["status"] = reader.GetString(ordStatus);
                }

                row["user"] = new JsonObject
                {
                    ["id"] = reader.GetGuid(ordUId).ToString(),
                    ["firstName"] = reader.GetString(ordUFirst),
                    ["lastName"] = reader.GetString(ordULast),
                    ["jobTitle"] = reader.IsDBNull(ordUJob) ? null : JsonValue.Create(reader.GetString(ordUJob)),
                };
                row["requester"] = new JsonObject
                {
                    ["id"] = reader.GetGuid(ordRId).ToString(),
                    ["firstName"] = reader.GetString(ordRFirst),
                    ["lastName"] = reader.GetString(ordRLast),
                };

                rows.Add(row);
                recordIds.Add(id);
            }
        }

        await tenant.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new PendingAdjustmentsResult(rows, recordIds);
    }

    // ── Reads 6/7: getEmployeeComp / myCompensation (field-authed subject read + optional band join) ──
    public async Task<EmployeeCompReadResult?> GetEmployeeCompAsync(
        string organizationId,
        Guid subjectUserId,
        IReadOnlyList<string> compensationFields,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var tenant = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        var fields = new HashSet<string>(compensationFields, StringComparer.Ordinal);
        var canSalary = fields.Contains("currentSalary");
        var canCurrency = fields.Contains("currency");
        var canVariable = fields.Contains("variablePay");
        var canCompaRatio = fields.Contains("compaRatio");
        var canBand = fields.Contains("bandId");

        var columns = new List<string> { "ec.id AS ec_id", "ec.user_id AS ec_uid" };
        if (canSalary)
        {
            columns.Add("ec.current_salary AS ec_sal");
        }

        if (canCurrency)
        {
            columns.Add("ec.currency AS ec_cur");
        }

        if (canVariable)
        {
            columns.Add("ec.variable_pay AS ec_var");
        }

        if (canCompaRatio)
        {
            columns.Add("ec.compa_ratio AS ec_cr");
        }

        var join = string.Empty;
        if (canBand)
        {
            columns.Add("ec.band_id AS ec_band");
            columns.AddRange(new[]
            {
                "sb.level AS b_level", "sb.title AS b_title", "sb.min_salary AS b_min",
                "sb.mid_salary AS b_mid", "sb.max_salary AS b_max", "sb.currency AS b_cur",
            });
            join = "LEFT JOIN salary_bands sb ON sb.id = ec.band_id AND sb.organization_id = ec.organization_id ";
        }

        var sql = $"SELECT {string.Join(", ", columns)} FROM employee_compensations ec {join}"
            + "WHERE ec.organization_id = @org AND ec.user_id = @subject LIMIT 1";

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("org", orgId);
        command.Parameters.AddWithValue("subject", subjectUserId);

        EmployeeCompReadResult? result = null;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false))
        {
            if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var recordId = reader.GetGuid(reader.GetOrdinal("ec_id")).ToString();
                var dto = new JsonObject
                {
                    ["userId"] = reader.GetGuid(reader.GetOrdinal("ec_uid")).ToString(),
                };

                if (canCurrency)
                {
                    dto["currency"] = reader.GetString(reader.GetOrdinal("ec_cur"));
                }

                if (canSalary)
                {
                    dto["currentSalary"] = reader.GetDouble(reader.GetOrdinal("ec_sal"));
                }

                if (canVariable)
                {
                    var ord = reader.GetOrdinal("ec_var");
                    dto["variablePay"] = reader.IsDBNull(ord) ? 0d : reader.GetDouble(ord); // Number(variablePay)||0
                }

                if (canCompaRatio)
                {
                    var ord = reader.GetOrdinal("ec_cr");
                    var cr = reader.IsDBNull(ord) ? 0d : reader.GetDouble(ord);
                    dto["compaRatio"] = cr != 0 ? JsonValue.Create(cr) : null; // Number(compaRatio)||null
                }

                if (canBand)
                {
                    var ordBMin = reader.GetOrdinal("b_min");
                    if (reader.IsDBNull(reader.GetOrdinal("ec_band")) || reader.IsDBNull(ordBMin))
                    {
                        dto["band"] = null;
                    }
                    else
                    {
                        var ordBLevel = reader.GetOrdinal("b_level");
                        var ordBTitle = reader.GetOrdinal("b_title");
                        var ordBCur = reader.GetOrdinal("b_cur");
                        dto["band"] = new JsonObject
                        {
                            ["level"] = reader.IsDBNull(ordBLevel) ? null : JsonValue.Create(reader.GetString(ordBLevel)),
                            ["title"] = reader.IsDBNull(ordBTitle) ? null : JsonValue.Create(reader.GetString(ordBTitle)),
                            ["min"] = reader.GetDouble(ordBMin),
                            ["mid"] = reader.GetDouble(reader.GetOrdinal("b_mid")),
                            ["max"] = reader.GetDouble(reader.GetOrdinal("b_max")),
                            ["currency"] = reader.GetString(ordBCur),
                        };
                    }
                }

                result = new EmployeeCompReadResult(recordId, dto);
            }
        }

        await tenant.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }

    // ── Slice 11c: the five FX reads' row data ──────────────────────────────────

    public async Task<CompAggregateData> GetCompAggregateDataAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.EmployeeCompensations.AsNoTracking()
            .Where(c => c.OrganizationId == orgId)
            .Select(c => new CompAmountRow(c.CurrentSalary, c.VariablePay, c.Currency))
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var displayCurrency = await FirstCompanyCurrencyAsync(orgId, cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new CompAggregateData(rows, displayCurrency);
    }

    public async Task<CompDashboardData> GetDashboardDataAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var compensatedRows = await _db.EmployeeCompensations.AsNoTracking()
            .Where(c => c.OrganizationId == orgId && c.CurrentSalary > 0)
            .Select(c => new CompAmountRow(c.CurrentSalary, c.VariablePay, c.Currency))
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var compaRatioRows = await _db.EmployeeCompensations.AsNoTracking()
            .Where(c => c.OrganizationId == orgId && c.CompaRatio != null)
            .Select(c => c.CompaRatio!.Value)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var activeEmployees = await _db.Users.AsNoTracking()
            .CountAsync(u => u.OrganizationId == orgId && u.IsActive, cancellationToken).ConfigureAwait(false);
        var benefitCounts = (await _db.BenefitEnrollments.AsNoTracking()
                .Where(e => e.OrganizationId == orgId)
                .GroupBy(e => e.BenefitPlanId)
                .Select(g => g.Count())
                .ToListAsync(cancellationToken).ConfigureAwait(false));
        var displayCurrency = await FirstCompanyCurrencyAsync(orgId, cancellationToken).ConfigureAwait(false);

        // salary_adjustments is not modeled as an entity here (field-authed raw SQL) — count pending via raw SQL
        // on THIS scope's connection so the org GUC / RLS still applies.
        var (connection, transaction) = RawHandles();
        int pending;
        await using (var command = new NpgsqlCommand(
            "SELECT COUNT(*)::int FROM salary_adjustments WHERE organization_id = @org AND status = 'pending'",
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("org", orgId);
            pending = (int)(await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false))!;
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var compaRatioAvg = compaRatioRows.Count > 0 ? compaRatioRows.Average() : (double?)null;
        return new CompDashboardData(
            compensatedRows,
            compensatedRows.Count,
            pending,
            compaRatioAvg,
            compaRatioRows.Count,
            activeEmployees,
            benefitCounts,
            displayCurrency);
    }

    public async Task<BandDistributionData> GetBandDistributionDataAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await (from c in _db.EmployeeCompensations.AsNoTracking()
                          join b in _db.SalaryBands.AsNoTracking() on c.BandId equals b.Id
                          where c.OrganizationId == orgId && c.BandId != null
                          select new BandDistributionRow(
                              c.CurrentSalary, c.Currency, b.Id, b.Level, b.Title,
                              b.MinSalary, b.MidSalary, b.MaxSalary, b.Currency))
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var unassigned = await _db.EmployeeCompensations.AsNoTracking()
            .CountAsync(c => c.OrganizationId == orgId && c.BandId == null, cancellationToken).ConfigureAwait(false);
        // FIX 1: the POSITIVE-salary unbanded sub-bucket — the missing operand the differencing oracle exploits
        // (dashboard.compensatedEmployees = positiveBanded + positiveUnbanded; Σdots = positiveBanded).
        var positiveUnbanded = await _db.EmployeeCompensations.AsNoTracking()
            .CountAsync(c => c.OrganizationId == orgId && c.BandId == null && c.CurrentSalary > 0, cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new BandDistributionData(rows, unassigned, positiveUnbanded);
    }

    public async Task<SimulateCompRow?> GetSimulateRowAsync(
        string organizationId, Guid subjectUserId, IReadOnlyList<string> compensationFields, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var tenant = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = RawHandles();

        var fields = new HashSet<string>(compensationFields, StringComparer.Ordinal);
        var canSalary = fields.Contains("currentSalary");
        var canCurrency = fields.Contains("currency");
        var canCompaRatio = fields.Contains("compaRatio");
        var canBand = fields.Contains("bandId");

        // §21: only the selectFor-entitled columns LEAVE the DB (never select-then-null). id is always selected.
        var columns = new List<string> { "id" };
        if (canSalary)
        {
            columns.Add("current_salary");
        }

        if (canCurrency)
        {
            columns.Add("currency");
        }

        if (canCompaRatio)
        {
            columns.Add("compa_ratio");
        }

        if (canBand)
        {
            columns.Add("band_id");
        }

        var sql = $"SELECT {string.Join(", ", columns)} FROM employee_compensations "
            + "WHERE organization_id = @org AND user_id = @subject LIMIT 1";
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("org", orgId);
        command.Parameters.AddWithValue("subject", subjectUserId);

        SimulateCompRow? result = null;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false))
        {
            if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var recordId = reader.GetGuid(reader.GetOrdinal("id")).ToString();
                double? salary = canSalary && !reader.IsDBNull(reader.GetOrdinal("current_salary"))
                    ? reader.GetDouble(reader.GetOrdinal("current_salary")) : null;
                var currency = canCurrency && !reader.IsDBNull(reader.GetOrdinal("currency"))
                    ? reader.GetString(reader.GetOrdinal("currency")) : null;
                double? compaRatio = canCompaRatio && !reader.IsDBNull(reader.GetOrdinal("compa_ratio"))
                    ? reader.GetDouble(reader.GetOrdinal("compa_ratio")) : null;
                Guid? bandId = canBand && !reader.IsDBNull(reader.GetOrdinal("band_id"))
                    ? reader.GetGuid(reader.GetOrdinal("band_id")) : null;
                result = new SimulateCompRow(recordId, salary, currency, compaRatio, bandId, canCompaRatio);
            }
        }

        await tenant.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }

    public async Task<SimulateBand?> GetSimulateBandAsync(
        string organizationId, Guid bandId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var band = await _db.SalaryBands.AsNoTracking()
            .Where(b => b.Id == bandId && b.OrganizationId == orgId)
            .Select(b => new SimulateBand(b.MinSalary, b.MidSalary, b.MaxSalary, b.Currency))
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return band;
    }

    private async Task<string?> FirstCompanyCurrencyAsync(Guid orgId, CancellationToken cancellationToken) =>
        await _db.Companies.AsNoTracking()
            .Where(c => c.OrganizationId == orgId)
            .OrderBy(c => c.CreatedAt)
            .Select(c => c.Currency)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

    // ── helpers ───────────────────────────────────────────────────────────────

    private (NpgsqlConnection Connection, NpgsqlTransaction Transaction) RawHandles()
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();
        return (connection, transaction);
    }

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads Kind=Unspecified); re-kind to UTC so
    // the shared Node-ISO converter emits the same `…fffZ` wire form Node's Date.toISOString() produces.
    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
