using Microsoft.EntityFrameworkCore;
using Tims.Application.Reporting;
using Tims.Domain.Reporting;

namespace Tims.Infrastructure.Reporting;

/// <summary>
/// Read-only EF implementation of <see cref="IReportingReadRepository"/> — a faithful port of the TS
/// <c>recruitment-analytics.repository.ts</c> aggregation queries. Every query is <c>AsNoTracking()</c> and
/// runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT
/// <c>organizationId</c> filter (defense-in-depth). Aggregates are ORG-WIDE — no per-row scope narrowing
/// (the endpoints enforce the organization/company org-gate, Codex F3). NEVER logs row content.
///
/// Prisma <c>timestamp(3)</c> columns are read as Unspecified-kind wall-clock UTC and converted to
/// epoch-milliseconds here (client-side, after materialization) so the pure kernels see the same instants
/// JS <c>Date.getTime()</c> produces from the same rows. The <c>take</c> memory caps mirror the TS repo.
/// </summary>
public sealed class ReportingReadRepository(ReportingReadDbContext db) : IReportingReadRepository
{
    private const string AcceptedStatus = "accepted";
    private const string ActiveStatus = "active";
    private const string RejectedStatus = "rejected";

    private readonly ReportingReadDbContext _db = db;

    public async Task<ReportingKpiData> GetKpiDataAsync(string organizationId, DateTime from, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var accepted = await _db.Offers.AsNoTracking()
            .Where(o => o.OrganizationId == orgId && o.Status == AcceptedStatus && o.RespondedAt >= from)
            .Select(o => new { o.RespondedAt, VacancyCreatedAt = o.Vacancy.CreatedAt, AppliedAt = (DateTime?)o.Application!.AppliedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var offersSent = await _db.Offers.AsNoTracking()
            .CountAsync(o => o.OrganizationId == orgId && o.SentAt >= from, cancellationToken).ConfigureAwait(false);
        var offersAccepted = await _db.Offers.AsNoTracking()
            .CountAsync(o => o.OrganizationId == orgId && o.Status == AcceptedStatus && o.RespondedAt >= from, cancellationToken).ConfigureAwait(false);
        var totalApplications = await _db.Applications.AsNoTracking()
            .CountAsync(a => a.OrganizationId == orgId && a.AppliedAt >= from, cancellationToken).ConfigureAwait(false);

        var rejected = await FetchRejectedAsync(orgId, from, cancellationToken).ConfigureAwait(false);

        return new ReportingKpiData(
            accepted.Select(o => new KpiAcceptedOffer(ToMsN(o.RespondedAt), ToMs(o.VacancyCreatedAt), ToMsN(o.AppliedAt))).ToList(),
            offersSent,
            offersAccepted,
            totalApplications,
            rejected.Select(r => new KpiRejectedApp(r.SlaHours, ToMsN(r.RejectedAt), ToMs(r.AppliedAt), ToMsN(r.LastMovedAt))).ToList());
    }

    public async Task<ReportingFunnelData> GetFunnelDataAsync(string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Deterministic order (order, then id) — matches the TS repo so the funnel merge/sort ties resolve
        // identically across stacks (the aggregation is order-sensitive on equal `order`).
        var stages = await _db.PipelineStages.AsNoTracking()
            .Where(p => p.OrganizationId == orgId && p.Vacancy.DeletedAt == null)
            .OrderBy(p => p.Order).ThenBy(p => p.Id)
            .Select(p => new { p.Id, p.Name, p.Order })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var counts = await _db.Applications.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.Status == ActiveStatus)
            .GroupBy(a => a.CurrentStageId)
            .Select(g => new { StageId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var totalApplications = await _db.Applications.AsNoTracking()
            .CountAsync(a => a.OrganizationId == orgId, cancellationToken).ConfigureAwait(false);
        var totalHired = await _db.Offers.AsNoTracking()
            .CountAsync(o => o.OrganizationId == orgId && o.Status == AcceptedStatus, cancellationToken).ConfigureAwait(false);

        return new ReportingFunnelData(
            stages.Select(s => new FunnelStageInput(s.Id.ToString(), s.Name, s.Order)).ToList(),
            counts.Select(c => new FunnelCountInput(c.StageId.ToString(), c.Count)).ToList(),
            totalApplications,
            totalHired);
    }

    public async Task<ReportingSourceData> GetSourceDataAsync(string organizationId, DateTime from, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Deterministic input order (source asc) — matches the TS repo so the kernel's stable
        // "sort by applications desc" resolves equal-count source ties identically across stacks.
        var apps = await _db.Applications.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.AppliedAt >= from)
            .GroupBy(a => a.Source)
            .Select(g => new { Source = g.Key, Count = g.Count() })
            .OrderBy(x => x.Source)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        // One entry per application that converted to an accepted offer in period (counted by source in the kernel).
        var hireSources = await _db.Applications.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.Offers.Any(o => o.Status == AcceptedStatus && o.RespondedAt >= from))
            .Select(a => a.Source)
            .Take(10_000)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        return new ReportingSourceData(
            apps.Select(a => new SourceApplications(a.Source, a.Count)).ToList(),
            hireSources);
    }

    public async Task<IReadOnlyList<long>> GetApplicationAppliedAtMsAsync(string organizationId, DateTime start, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var dates = await _db.Applications.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.AppliedAt >= start)
            .Select(a => a.AppliedAt)
            .Take(20_000)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        return dates.Select(ToMs).ToList();
    }

    public async Task<IReadOnlyList<LostByDelayApp>> GetLostByDelayDataAsync(string organizationId, DateTime from, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rejected = await FetchRejectedAsync(orgId, from, cancellationToken).ConfigureAwait(false);
        return rejected
            .Select(r => new LostByDelayApp(r.StageName, r.SlaHours, ToMsN(r.RejectedAt), ToMs(r.AppliedAt), ToMsN(r.LastMovedAt)))
            .ToList();
    }

    public async Task<ReportingRecruiterData> GetRecruiterDataAsync(string organizationId, DateTime ttfLookback, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Deterministic order (id asc) — matches the TS repo so the recruiter grouping (first-seen name +
        // insertion order for the vacancy-count tie sort) resolves identically across stacks.
        var vacancies = await _db.Vacancies.AsNoTracking()
            .Where(v => v.OrganizationId == orgId && v.AssignedTo != null && v.DeletedAt == null)
            .OrderBy(v => v.Id)
            .Select(v => new { v.Id, v.AssignedTo, FirstName = v.Assignee!.FirstName, LastName = v.Assignee!.LastName })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var appCounts = await _db.Applications.AsNoTracking()
            .Where(a => a.OrganizationId == orgId)
            .GroupBy(a => a.VacancyId)
            .Select(g => new { VacancyId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var accepted = await _db.Offers.AsNoTracking()
            .Where(o => o.OrganizationId == orgId && o.Status == AcceptedStatus && o.RespondedAt >= ttfLookback)
            .Select(o => new { o.VacancyId, o.RespondedAt, VacancyCreatedAt = o.Vacancy.CreatedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var active = await _db.Applications.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.Status == ActiveStatus)
            .Select(a => new
            {
                a.VacancyId,
                a.AppliedAt,
                SlaHours = a.CurrentStage.SlaHours,
                LastMovedAt = a.Movements.OrderByDescending(m => m.MovedAt).Select(m => (DateTime?)m.MovedAt).FirstOrDefault(),
            })
            .Take(10_000)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        return new ReportingRecruiterData(
            vacancies.Select(v => new RecruiterVacancy(v.Id.ToString(), v.AssignedTo!.Value.ToString(), v.FirstName, v.LastName)).ToList(),
            appCounts.Select(c => new RecruiterAppCount(c.VacancyId.ToString(), c.Count)).ToList(),
            accepted.Select(o => new RecruiterAcceptedOffer(o.VacancyId.ToString(), ToMsN(o.RespondedAt), ToMs(o.VacancyCreatedAt))).ToList(),
            active.Select(a => new RecruiterActiveApp(a.VacancyId.ToString(), a.SlaHours, ToMs(a.AppliedAt), ToMsN(a.LastMovedAt))).ToList());
    }

    // Applications rejected in period with the stage name + SLA and the latest stage movement (entered-stage
    // moment) — the shared shape for both the KPI lostByDelay count and the lost-by-delay report.
    private async Task<List<RejectedRow>> FetchRejectedAsync(Guid orgId, DateTime from, CancellationToken cancellationToken) =>
        // Deterministic order (id asc) — matches the TS repo so the lost-by-delay group's FIRST-SEEN SLA
        // (two same-name stages with different SLA) resolves identically across stacks.
        await _db.Applications.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.Status == RejectedStatus && a.RejectedAt >= from)
            .OrderBy(a => a.Id)
            .Select(a => new RejectedRow(
                a.CurrentStage.Name,
                a.CurrentStage.SlaHours,
                a.RejectedAt,
                a.AppliedAt,
                a.Movements.OrderByDescending(m => m.MovedAt).Select(m => (DateTime?)m.MovedAt).FirstOrDefault()))
            .ToListAsync(cancellationToken).ConfigureAwait(false);

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads them Kind=Unspecified); reinterpret
    // as UTC and take epoch-ms so the kernels see the same value JS Date.getTime() yields from the same row.
    private static long ToMs(DateTime value) =>
        new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    private static long? ToMsN(DateTime? value) => value is null ? null : ToMs(value.Value);

    private sealed record RejectedRow(string StageName, int? SlaHours, DateTime? RejectedAt, DateTime AppliedAt, DateTime? LastMovedAt);
}
