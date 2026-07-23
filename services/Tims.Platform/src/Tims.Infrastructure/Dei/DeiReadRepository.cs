using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Tims.Application.Dei;

namespace Tims.Infrastructure.Dei;

/// <summary>
/// Read-only EF implementation of <see cref="IDeiReadRepository"/> — a faithful port of the READ methods of the TS
/// <c>dei.repository.ts</c> (+ the getHiringFunnel/getPromotionEquity/getInclusionIndex router queries). Every
/// query is <c>AsNoTracking()</c> and runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC →
/// RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth). Every method returns AGGREGATES (grouped
/// counts) or a raw DOB list — never an individual demographic row (§7). NEVER logs row content.
///
/// The three demographic group-bys read the NATIVE Prisma enums into CLR enums (the mapped data source) and
/// flatten them to their DB labels; <c>date_of_birth</c> (date) is read as DateOnly and converted to a date-only
/// DateTime for server-side age bucketing. Prisma <c>timestamp(3)</c> filters are compared as Unspecified-kind
/// wall-clock UTC.
/// </summary>
public sealed class DeiReadRepository(DeiReadDbContext db) : IDeiReadRepository
{
    // Role slugs that count as "leadership" (packages/api/src/repositories/dei.repository.ts LEADERSHIP_SLUGS).
    private static readonly string[] LeadershipSlugs = { "super_admin", "org_admin", "hr_admin", "leader" };
    private const string PromotionType = "promotion";
    private const string ClimateType = "climate";

    private readonly DeiReadDbContext _db = db;

    // #1 getDashboardKpis: the 8-query aggregate bundle under ONE TenantScope ──────
    public async Task<DeiDashboardData> GetDashboardDataAsync(string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var totalEmployees = await _db.Users.AsNoTracking()
            .CountAsync(u => u.OrganizationId == orgId && u.IsActive, cancellationToken).ConfigureAwait(false);
        var withDemographics = await _db.Demographics.AsNoTracking()
            .CountAsync(d => d.OrganizationId == orgId, cancellationToken).ConfigureAwait(false);
        var genders = await GroupGendersAsync(orgId, cancellationToken).ConfigureAwait(false);
        var nationalities = await GroupNationalitiesAsync(orgId, cancellationToken).ConfigureAwait(false);
        var nullNationalityCount = await _db.Demographics.AsNoTracking()
            .CountAsync(d => d.OrganizationId == orgId && d.Nationality == null, cancellationToken).ConfigureAwait(false);
        var nullDobCount = await _db.Demographics.AsNoTracking()
            .CountAsync(d => d.OrganizationId == orgId && d.DateOfBirth == null, cancellationToken).ConfigureAwait(false);
        var ethnicities = await GroupEthnicitiesAsync(orgId, cancellationToken).ConfigureAwait(false);
        var leaderGenders = await LeadershipGendersAsync(orgId, cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new DeiDashboardData(
            totalEmployees, withDemographics, genders, nationalities, nullNationalityCount, nullDobCount,
            ethnicities, leaderGenders);
    }

    // #2 getGenderRepresentation ──────────────────────────────────────────────────
    public async Task<IReadOnlyList<DeiGroupCount>> GetGenderCountsAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var result = await GroupGendersAsync(orgId, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }

    // #5 getEthnicityDistribution ─────────────────────────────────────────────────
    public async Task<IReadOnlyList<DeiGroupCount>> GetEthnicityCountsAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var result = await GroupEthnicitiesAsync(orgId, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }

    // #6 getDisabilityDistribution ────────────────────────────────────────────────
    public async Task<IReadOnlyList<DeiGroupCount>> GetDisabilityCountsAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var rows = await _db.Demographics.AsNoTracking()
            .Where(d => d.OrganizationId == orgId)
            .GroupBy(d => d.DisabilityStatus)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new DeiGroupCount(r.Key.Label(), r.Count)).ToList();
    }

    // #4 getNationalityDiversity ──────────────────────────────────────────────────
    public async Task<NationalityCountsData> GetNationalityDataAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var counts = await GroupNationalitiesAsync(orgId, cancellationToken).ConfigureAwait(false);
        var nullCount = await _db.Demographics.AsNoTracking()
            .CountAsync(d => d.OrganizationId == orgId && d.Nationality == null, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new NationalityCountsData(counts, nullCount);
    }

    // #3 getAgeDistribution ───────────────────────────────────────────────────────
    public async Task<AgeRawData> GetAgeDataAsync(string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var dobs = await _db.Demographics.AsNoTracking()
            .Where(d => d.OrganizationId == orgId && d.DateOfBirth != null)
            .Select(d => d.DateOfBirth!.Value)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var nullDobCount = await _db.Demographics.AsNoTracking()
            .CountAsync(d => d.OrganizationId == orgId && d.DateOfBirth == null, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new AgeRawData(dobs.Select(d => d.ToDateTime(TimeOnly.MinValue)).ToList(), nullDobCount);
    }

    // #8 getLeadershipDiversity ───────────────────────────────────────────────────
    public async Task<IReadOnlyList<string>> GetLeadershipGendersAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var result = await LeadershipGendersAsync(orgId, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }

    // #9 getHiringFunnel ──────────────────────────────────────────────────────────
    public async Task<int> CountCandidatesAsync(
        string organizationId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var query = _db.Candidates.AsNoTracking().Where(c => c.OrganizationId == orgId);
        if (dateFrom is { } from)
        {
            var f = Unspecified(from);
            query = query.Where(c => c.CreatedAt >= f);
        }

        if (dateTo is { } to)
        {
            var t = Unspecified(to);
            query = query.Where(c => c.CreatedAt <= t);
        }

        var total = await query.CountAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return total;
    }

    // #10 getPromotionEquity ──────────────────────────────────────────────────────
    public async Task<int> CountPromotionsAsync(
        string organizationId, DateTimeOffset start, DateTimeOffset end, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var s = Unspecified(start);
        var e = Unspecified(end);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var total = await _db.SalaryAdjustments.AsNoTracking()
            .CountAsync(
                a => a.OrganizationId == orgId
                    && a.Type == PromotionType
                    && a.EffectiveDate != null
                    && a.EffectiveDate >= s
                    && a.EffectiveDate < e,
                cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return total;
    }

    // #11 getInclusionIndex ───────────────────────────────────────────────────────
    public async Task<ClimateInclusionData?> GetClimateInclusionDataAsync(
        string organizationId, Guid? surveyId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var survey = await _db.Surveys.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && s.Type == ClimateType && (surveyId == null || s.Id == surveyId))
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new { s.Id, s.Questions })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (survey is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        // §21 minimal-select: answers-only (never userId or other response columns).
        var answers = await _db.SurveyResponses.AsNoTracking()
            .Where(r => r.SurveyId == survey.Id && r.OrganizationId == orgId)
            .Select(r => r.Answers)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new ClimateInclusionData(ParseQuestions(survey.Questions), answers.Select(ParseObject).ToList());
    }

    // #12 getPayEquity (Slice 11c) ────────────────────────────────────────────────
    public async Task<DeiPayEquityData> GetPayEquityDataAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var connection = (Npgsql.NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (Npgsql.NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        // salaryWithGender: employee_compensations ⋈ user ⋈ employee_demographics.gender. gender is a native
        // enum → ::text so this needs NO enum-mapped data source (avoids the DeiReadDataSource here). The LEFT
        // join keeps comp rows whose user has no demographics (gender null → the skipped-salaried bucket).
        var rows = new List<DeiSalaryGenderRow>();
        await using (var command = new Npgsql.NpgsqlCommand(
            "SELECT ec.current_salary, ec.currency, ed.gender::text AS gender "
            + "FROM employee_compensations ec "
            + "LEFT JOIN employee_demographics ed ON ed.user_id = ec.user_id "
            + "WHERE ec.organization_id = @org",
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("org", orgId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                rows.Add(new DeiSalaryGenderRow(
                    reader.GetDouble(0),
                    reader.IsDBNull(1) ? null : reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2)));
            }
        }

        // FULL demographic gender counts (the getGenderRepresentation population) — ::text, no enum mapping.
        var genderCounts = new List<DeiGroupCount>();
        await using (var command = new Npgsql.NpgsqlCommand(
            "SELECT gender::text AS gender, COUNT(*)::int AS c FROM employee_demographics "
            + "WHERE organization_id = @org GROUP BY gender",
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("org", orgId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                genderCounts.Add(new DeiGroupCount(reader.GetString(0), reader.GetInt32(1)));
            }
        }

        // Display currency = companies.currency, earliest created_at (matches the TS displayCurrency query).
        string? displayCurrency;
        await using (var command = new Npgsql.NpgsqlCommand(
            "SELECT currency FROM companies WHERE organization_id = @org ORDER BY created_at ASC LIMIT 1",
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("org", orgId);
            var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
            displayCurrency = value as string;
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new DeiPayEquityData(rows, genderCounts, displayCurrency);
    }

    // ── scope-free group-by helpers (called inside an already-open TenantScope) ────

    private async Task<IReadOnlyList<DeiGroupCount>> GroupGendersAsync(Guid orgId, CancellationToken cancellationToken)
    {
        var rows = await _db.Demographics.AsNoTracking()
            .Where(d => d.OrganizationId == orgId)
            .GroupBy(d => d.Gender)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new DeiGroupCount(r.Key.Label(), r.Count)).ToList();
    }

    private async Task<IReadOnlyList<DeiGroupCount>> GroupEthnicitiesAsync(Guid orgId, CancellationToken cancellationToken)
    {
        var rows = await _db.Demographics.AsNoTracking()
            .Where(d => d.OrganizationId == orgId)
            .GroupBy(d => d.Ethnicity)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new DeiGroupCount(r.Key.Label(), r.Count)).ToList();
    }

    private async Task<IReadOnlyList<DeiGroupCount>> GroupNationalitiesAsync(Guid orgId, CancellationToken cancellationToken)
    {
        var rows = await _db.Demographics.AsNoTracking()
            .Where(d => d.OrganizationId == orgId && d.Nationality != null)
            .GroupBy(d => d.Nationality!)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new DeiGroupCount(r.Key, r.Count)).ToList();
    }

    private async Task<IReadOnlyList<string>> LeadershipGendersAsync(Guid orgId, CancellationToken cancellationToken)
    {
        var rows = await _db.Demographics.AsNoTracking()
            .Where(d => d.OrganizationId == orgId
                && _db.UserRoles.Any(ur => ur.UserId == d.UserId
                    && _db.Roles.Any(r => r.Id == ur.RoleId && LeadershipSlugs.Contains(r.Slug))))
            .Select(d => d.Gender)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(g => g.Label()).ToList();
    }

    // ── helpers ────────────────────────────────────────────────────────────────────

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

    private static DateTime Unspecified(DateTimeOffset value) =>
        DateTime.SpecifyKind(value.UtcDateTime, DateTimeKind.Unspecified);
}
