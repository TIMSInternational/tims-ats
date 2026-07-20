using Tims.Domain.Reporting;

namespace Tims.Application.Reporting;

/// <summary>
/// Repository-return bundles for the recruitment-analytics reads. Each holds the exact pure-kernel input
/// pieces (Tims.Domain.Reporting.*) that the corresponding TS service method assembles from its repository
/// calls; the use case wraps them and calls the matching build*View kernel. Keeping the repository's output
/// as the kernel input types avoids a second layer of near-duplicate DTOs.
/// </summary>
public sealed record ReportingKpiData(
    IReadOnlyList<KpiAcceptedOffer> Accepted,
    int OffersSent,
    int OffersAccepted,
    int TotalApplications,
    IReadOnlyList<KpiRejectedApp> Rejected);

public sealed record ReportingFunnelData(
    IReadOnlyList<FunnelStageInput> Stages,
    IReadOnlyList<FunnelCountInput> Counts,
    int TotalApplications,
    int TotalHired);

public sealed record ReportingSourceData(
    IReadOnlyList<SourceApplications> Apps,
    IReadOnlyList<string> HireSources);

public sealed record ReportingRecruiterData(
    IReadOnlyList<RecruiterVacancy> Vacancies,
    IReadOnlyList<RecruiterAppCount> AppCounts,
    IReadOnlyList<RecruiterAcceptedOffer> Accepted,
    IReadOnlyList<RecruiterActiveApp> Active);
