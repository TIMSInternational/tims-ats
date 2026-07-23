namespace Tims.Application.Dei;

/// <summary>
/// Read port for the DEI surface — a faithful port of the READ methods of
/// <c>packages/api/src/repositories/dei.repository.ts</c> (the 10 ported reads; getPayEquity → Slice 11c). Every
/// method, in the infrastructure implementation, runs <c>AsNoTracking</c> UNDER <c>TenantScope</c> (SET LOCAL ROLE
/// app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth). Every method
/// returns AGGREGATES (grouped counts) or a raw DOB list — NEVER an individual's demographic row (§7). The three
/// demographic-enum group-bys read the NATIVE Prisma enums into CLR enums (the mapped data source) and flatten
/// them to their DB labels.
/// </summary>
public interface IDeiReadRepository
{
    /// <summary>getDashboardKpis: the 8-query aggregate bundle (active users, demographics coverage, gender /
    /// nationality(+null) / ethnicity group-bys, null-DOB, leadership genders) under ONE TenantScope.</summary>
    Task<DeiDashboardData> GetDashboardDataAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getGenderRepresentation: employee_demographics grouped by the native Gender enum.</summary>
    Task<IReadOnlyList<DeiGroupCount>> GetGenderCountsAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getEthnicityDistribution: employee_demographics grouped by the native Ethnicity enum.</summary>
    Task<IReadOnlyList<DeiGroupCount>> GetEthnicityCountsAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getDisabilityDistribution: employee_demographics grouped by the native DisabilityStatus enum.</summary>
    Task<IReadOnlyList<DeiGroupCount>> GetDisabilityCountsAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getNationalityDiversity: present-nationality group-by (String) + the null-nationality count.</summary>
    Task<NationalityCountsData> GetNationalityDataAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getAgeDistribution: the raw DOBs (dateOfBirth not null) + the null-DOB count.</summary>
    Task<AgeRawData> GetAgeDataAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getLeadershipDiversity: the gender of every user holding a LEADERSHIP_SLUGS role (demographics ⋈
    /// user_roles ⋈ roles).</summary>
    Task<IReadOnlyList<string>> GetLeadershipGendersAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getHiringFunnel: candidates count in the optional [dateFrom, dateTo] createdAt window (no suppression).</summary>
    Task<int> CountCandidatesAsync(
        string organizationId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CancellationToken cancellationToken);

    /// <summary>getPromotionEquity: salary_adjustments count where type='promotion' and effectiveDate ∈ [start, end).</summary>
    Task<int> CountPromotionsAsync(
        string organizationId, DateTimeOffset start, DateTimeOffset end, CancellationToken cancellationToken);

    /// <summary>getInclusionIndex: the most-recent climate survey (optional id) — its questions + each response's
    /// answers (answers-only). Null when the org has no climate survey.</summary>
    Task<ClimateInclusionData?> GetClimateInclusionDataAsync(
        string organizationId, Guid? surveyId, CancellationToken cancellationToken);
}
