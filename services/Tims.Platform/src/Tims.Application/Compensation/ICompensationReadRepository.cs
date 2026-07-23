using Tims.Domain.Access;
using Tims.Domain.Compensation;

namespace Tims.Application.Compensation;

/// <summary>
/// Read port for the FX-free compensation surface — a faithful port of the seven FX-free READ bodies of
/// <c>packages/api/src/routers/compensation.ts</c> (the five FX reads + the two writes are NOT ported). Every
/// method, in the infrastructure implementation, runs <c>AsNoTracking</c> UNDER <c>TenantScope</c> (SET LOCAL
/// ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth).
///
/// The field-authed reads (#5 listPendingAdjustments, #6/#7 getEmployeeComp/myCompensation) build their SELECT
/// column list from <c>selectFor(roles, entity)</c> BEFORE the query — the restricted columns
/// (previousSalary/newSalary/currency/reason on salary_adjustments; currentSalary/variablePay/compaRatio/bandId
/// on employee_compensations) LEAVE the DB only for entitled roles, never selected-then-nulled. #5 additionally
/// composes <c>scopeWhereFor('salaryAdjustment')</c> as an <c>id IN (…)</c> row filter (via
/// <see cref="ScopePredicateSqlTranslator"/>). The endpoint owns the audit + the by-subject scope guard.
/// </summary>
public interface ICompensationReadRepository
{
    /// <summary>getSalaryBands: the full org SalaryBand rows (orderBy level asc). Org-level catalog — no scope.</summary>
    Task<IReadOnlyList<SalaryBandRow>> GetSalaryBandsAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getMarketComparison: the band projection (org + optional level filter, orderBy level asc).</summary>
    Task<IReadOnlyList<MarketComparisonRow>> GetMarketComparisonAsync(
        string organizationId,
        string? jobLevel,
        CancellationToken cancellationToken);

    /// <summary>getBenefitsUtilization input: the org benefit plans (+ enrolled counts, orderBy name asc) and
    /// the active-user count. Org-rollup — gated by the org-scope gate upstream.</summary>
    Task<BenefitsUtilizationData> GetBenefitsUtilizationDataAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getCompaRatioDistribution input: every org employee_compensations (currentSalary + compaRatio).
    /// Org-rollup — gated by the org-scope gate upstream; the min-5 shaping is the pure kernel.</summary>
    Task<IReadOnlyList<CompaRatioRow>> GetCompaRatioRowsAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>listPendingAdjustments: pending salary_adjustments in the caller's
    /// <c>scopeWhereFor('salaryAdjustment')</c> row scope (orderBy createdAt desc), field-authed via
    /// <paramref name="adjustmentFields"/> (<c>selectFor(roles,'salaryAdjustment')</c>). Returns the rows +
    /// the record ids to audit fail-closed.</summary>
    Task<PendingAdjustmentsResult> ListPendingAdjustmentsAsync(
        string organizationId,
        IReadOnlyList<string> adjustmentFields,
        ScopePredicate scope,
        CancellationToken cancellationToken);

    /// <summary>getEmployeeComp / myCompensation: ONE subject's compensation, field-authed via
    /// <paramref name="compensationFields"/> (<c>selectFor(roles,'employeeCompensation')</c>) with the salary_bands
    /// join added ONLY when bandId is entitled. Null when the subject has no comp row (no audit on absence).</summary>
    Task<EmployeeCompReadResult?> GetEmployeeCompAsync(
        string organizationId,
        Guid subjectUserId,
        IReadOnlyList<string> compensationFields,
        CancellationToken cancellationToken);

    // ── Slice 11c: the five FX reads' row data ──────────────────────────────────

    /// <summary>getPayEquity/getTotalCompBreakdown: every comp row's currentSalary/variablePay/currency + the org
    /// display currency (companies.currency, earliest createdAt).</summary>
    Task<CompAggregateData> GetCompAggregateDataAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getDashboardKpis: the compensated rows (currentSalary &gt; 0) + compensated/compaRatio counts +
    /// pending-adjustment count + compaRatio avg + active headcount + benefit enrollment counts + display currency.</summary>
    Task<CompDashboardData> GetDashboardDataAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getBandDistribution: the banded comp rows (bandId not null) with band bounds + the unbanded count.</summary>
    Task<BandDistributionData> GetBandDistributionDataAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>simulateAdjustment: the subject's field-authed comp row (only the selectFor-entitled columns), or
    /// null when the subject has no comp row.</summary>
    Task<SimulateCompRow?> GetSimulateRowAsync(
        string organizationId, Guid subjectUserId, IReadOnlyList<string> compensationFields, CancellationToken cancellationToken);

    /// <summary>simulateAdjustment: a salary band's bounds (loaded only when the caller sees compaRatio + has a band).</summary>
    Task<SimulateBand?> GetSimulateBandAsync(string organizationId, Guid bandId, CancellationToken cancellationToken);
}
