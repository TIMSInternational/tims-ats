using Tims.Domain.Reporting;

namespace Tims.Application.Reporting;

/// <summary>
/// Read port for the recruitment-analytics surface — a faithful port of
/// <c>recruitment-analytics.repository.ts</c>. Every method, in the infrastructure implementation, runs
/// <c>AsNoTracking</c> UNDER <c>TenantScope</c> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an
/// EXPLICIT <c>organizationId</c> filter (defense-in-depth). These aggregate ORG-WIDE pipeline/offer data;
/// the endpoints gate them to organization/company scope (Codex F3 org-gate) — the repository itself does
/// no per-row scope narrowing. Timestamps are returned as epoch-milliseconds for the pure kernels.
/// </summary>
public interface IReportingReadRepository
{
    /// <summary>getKpis inputs: accepted offers (with the TTF/TTH timestamps), the offer-sent/accepted +
    /// application counts in period, and the rejected applications (for lost-by-delay).</summary>
    Task<ReportingKpiData> GetKpiDataAsync(string organizationId, DateTime from, CancellationToken cancellationToken);

    /// <summary>getFunnel inputs: the live vacancies' pipeline stages, the active application counts per
    /// current stage, and the all-time application + accepted-offer totals.</summary>
    Task<ReportingFunnelData> GetFunnelDataAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getSourceBreakdown inputs: application counts per source in period, and one entry per
    /// application that converted to an accepted offer in period (counted by source in the kernel).</summary>
    Task<ReportingSourceData> GetSourceDataAsync(string organizationId, DateTime from, CancellationToken cancellationToken);

    /// <summary>getTrend input: the applied-at instants (epoch-ms) of applications since <paramref name="start"/>
    /// (the first day of the earliest UTC bucket month); the kernel buckets them into six months.</summary>
    Task<IReadOnlyList<long>> GetApplicationAppliedAtMsAsync(string organizationId, DateTime start, CancellationToken cancellationToken);

    /// <summary>getLostByDelay input: applications rejected in period, with their stage name + SLA and the
    /// entered-stage timestamp, so the kernel derives "lost while overdue".</summary>
    Task<IReadOnlyList<LostByDelayApp>> GetLostByDelayDataAsync(string organizationId, DateTime from, CancellationToken cancellationToken);

    /// <summary>getRecruiterSla inputs: assigned vacancies (+ assignee name), application counts per vacancy,
    /// accepted offers over the 1-year TTF lookback, and active applications with their stage SLA.</summary>
    Task<ReportingRecruiterData> GetRecruiterDataAsync(string organizationId, DateTime ttfLookback, CancellationToken cancellationToken);
}
