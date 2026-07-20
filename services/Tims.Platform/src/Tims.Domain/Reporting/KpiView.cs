using System.Collections.Generic;
using System.Linq;

namespace Tims.Domain.Reporting;

public sealed record KpiAcceptedOffer(long? RespondedAtMs, long VacancyCreatedAtMs, long? AppliedAtMs);
public sealed record KpiRejectedApp(double? SlaHours, long? RejectedAtMs, long AppliedAtMs, long? LastMovedAtMs);

public sealed record KpiViewInput(
    string Period,
    IReadOnlyList<KpiAcceptedOffer> Accepted,
    int OffersSent,
    int OffersAccepted,
    int TotalApplications,
    IReadOnlyList<KpiRejectedApp> Rejected);

/// <summary>
/// The <c>recruitmentAnalytics.getKpis</c> response — a faithful port of the TS <c>buildKpiView</c>
/// (@tims/shared). INTERNAL staff read = raw view shape, NO <c>schemaVersion</c>. Golden-fixtured BOTH
/// stacks (contracts/reporting-fixtures/kpi-view.json). Only honestly computable metrics are present —
/// cost-per-hire / quality-of-hire / ML have no data source and are intentionally absent, never stubbed.
/// </summary>
public sealed record KpiView(
    string Period,
    int? TimeToFillDays,
    int? TimeToHireDays,
    int Hires,
    int OffersSent,
    int OffersAccepted,
    int? OfferAcceptRatePct,
    int TotalApplications,
    int LostByDelay);

/// <summary>Pure builder for <see cref="KpiView"/>. Time-to-fill = accepted-offer respondedAt −
/// vacancy.createdAt; time-to-hire = respondedAt − application.appliedAt; both average only non-negative
/// spans over offers with the needed timestamps. <c>lostByDelay</c> counts rejections that sat STRICTLY
/// past their stage SLA at rejection time. Rounding uses JS half-up (<see cref="ReportingMath.JsRound"/>).</summary>
public static class KpiViewBuilder
{
    public static KpiView Build(KpiViewInput input)
    {
        var ttf = ReportingHelpers.AvgDaysFromSpans(
            input.Accepted
                .Where(o => o.RespondedAtMs.HasValue)
                .Select(o => o.RespondedAtMs!.Value - o.VacancyCreatedAtMs)
                .Where(ms => ms >= 0)
                .ToList());

        var tth = ReportingHelpers.AvgDaysFromSpans(
            input.Accepted
                .Where(o => o.RespondedAtMs.HasValue && o.AppliedAtMs.HasValue)
                .Select(o => o.RespondedAtMs!.Value - o.AppliedAtMs!.Value)
                .Where(ms => ms >= 0)
                .ToList());

        var lostByDelay = input.Rejected.Count(r =>
            r.SlaHours.HasValue &&
            r.RejectedAtMs.HasValue &&
            ReportingHelpers.HoursInStage(r.AppliedAtMs, r.LastMovedAtMs, r.RejectedAtMs.Value) > r.SlaHours.Value);

        int? offerAcceptRatePct = input.OffersSent > 0
            ? (int)ReportingMath.JsRound((double)input.OffersAccepted / input.OffersSent * 100)
            : null;

        return new KpiView(
            input.Period,
            ttf,
            tth,
            input.Accepted.Count,
            input.OffersSent,
            input.OffersAccepted,
            offerAcceptRatePct,
            input.TotalApplications,
            lostByDelay);
    }
}
