namespace Tims.Application.PlatformDashboard;

/// <summary>
/// <c>getMrrTrend</c> and <c>getMrrForecast</c> (Phase-5 slice 23 / issue #81, PR 2 of 3) — the two
/// procedures that reconstruct a cumulative MRR history from ACTIVE subscriptions' creation months and
/// the <see cref="PlanPrices"/> USD table. No live FX is involved, which is what puts them in this tier.
///
/// <para>Both walk the same twelve <c>YYYY-MM</c> buckets, both label them with the same
/// <c>"sept 26"</c>-style ICU format, and both read the same aggregate — but they are NOT the same
/// computation, and the difference is the sharpest edge in this slice. See
/// <see cref="BuildMrrTrend"/>'s baseline note.</para>
/// </summary>
public sealed class PlatformDashboardMrrUseCase(IPlatformDashboardMrrRepository repository)
{
    public const int TrendMonths = 12;
    public const int ForecastMonths = 12;

    /// <summary>
    /// <c>Math.max(-0.2, Math.min(0.3, avgGrowthRate))</c> — "cap growth between -20% and +30% per month
    /// for realistic forecast".
    ///
    /// <para><b>The LOWER bound is unreachable, in both stacks.</b> Each historical bucket counts the
    /// active subscriptions created before that month's end, so widening the window can only ADD rows:
    /// the series is monotone non-decreasing, every month-over-month rate is ≥ 0, and their mean is
    /// therefore ≥ 0. Ported as written — it is TS's constant, and the property that makes it dead lives
    /// in a query, not here — but do not cite it as evidence that negative growth is handled: it is
    /// evidence that a shrinking MRR would not be reported at all.</para>
    /// </summary>
    public const double MinMonthlyGrowth = -0.2;

    public const double MaxMonthlyGrowth = 0.3;

    public async Task<IReadOnlyList<MrrTrendPoint>> GetMrrTrendAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        var rows = await repository.GetActiveSubscriptionPlanMonthCountsAsync(cancellationToken).ConfigureAwait(false);
        return BuildMrrTrend(rows, nowUtc);
    }

    public async Task<MrrForecastResult> GetMrrForecastAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        var rows = await repository.GetActiveSubscriptionPlanMonthCountsAsync(cancellationToken).ConfigureAwait(false);
        var pendingTrials = await repository.CountTrialingSubscriptionsAsync(cancellationToken).ConfigureAwait(false);
        return BuildMrrForecast(rows, pendingTrials, nowUtc);
    }

    /// <summary>
    /// Twelve cumulative MRR snapshots, oldest first.
    ///
    /// <para><b>The baseline is where TS's own behaviour is surprising, and it is reproduced, not fixed.</b>
    /// TS sums every aggregate row whose month is NOT one of the twelve bucket keys into a
    /// <c>baselineMrr</c> that is then present in ALL twelve snapshots. For rows OLDER than the window
    /// that is the intent — they were active at every boundary. But the test <c>!bucketSet.has(month)</c>
    /// is a set-membership test, not an ordering test, so a subscription with a FUTURE <c>created_at</c>
    /// (clock skew, a backdated import, a seeded fixture) also fails it and is likewise added to all
    /// twelve months, including ones that precede its own creation. That is a defect in the TS
    /// procedure. Porting it faithfully is the requirement: a C# side that "correctly" excluded future
    /// rows would diff against production on exactly the data that triggers it, and the fix belongs in
    /// one place — the TS procedure — not smuggled in through a port.</para>
    /// </summary>
    public static IReadOnlyList<MrrTrendPoint> BuildMrrTrend(IReadOnlyList<ActivePlanMonthCount> rows, DateTime nowUtc)
    {
        var mrrByMonth = MrrByMonth(rows);
        var bucketKeys = PlatformDashboardReadUseCase.MonthBucketKeys(TrendMonths, nowUtc);
        var bucketSet = new HashSet<string>(bucketKeys, StringComparer.Ordinal);

        var running = 0L;
        foreach (var (month, mrr) in mrrByMonth)
        {
            if (!bucketSet.Contains(month))
            {
                running += mrr;
            }
        }

        var result = new List<MrrTrendPoint>(bucketKeys.Count);
        foreach (var key in bucketKeys)
        {
            if (mrrByMonth.TryGetValue(key, out var newThisMonth))
            {
                running += newThisMonth;
            }

            var (year, monthIndex) = PlatformDashboardReadUseCase.ParseMonthBucketKey(key);
            result.Add(new MrrTrendPoint(PlatformDashboardReadUseCase.SpanishShortMonthYear2(year, monthIndex), running));
        }

        return result;
    }

    /// <summary>
    /// Twelve historical months, twelve projected months, and the derived headline numbers.
    ///
    /// <para><b>Historical is NOT the trend.</b> Each historical bucket is an independent
    /// <c>createdAt &lt; endOfThatMonth</c> query in TS, i.e. every active subscription created up to that
    /// point — future-dated rows included only once their own month is reached. The trend's
    /// baseline-plus-increments walk gives a different answer on exactly the skewed rows described in
    /// <see cref="BuildMrrTrend"/>. Both are reproduced as written; do not "unify" them.</para>
    /// </summary>
    public static MrrForecastResult BuildMrrForecast(
        IReadOnlyList<ActivePlanMonthCount> rows,
        int pendingTrials,
        DateTime nowUtc)
    {
        var mrrByMonth = MrrByMonth(rows);
        var bucketKeys = PlatformDashboardReadUseCase.MonthBucketKeys(ForecastMonths, nowUtc);

        var historical = new List<MrrForecastPoint>(bucketKeys.Count);
        foreach (var key in bucketKeys)
        {
            // `createdAt < end`, where end is the first instant of the NEXT month — i.e. every creation
            // month at or before this bucket's.
            var mrr = 0L;
            foreach (var (month, monthMrr) in mrrByMonth)
            {
                if (string.CompareOrdinal(month, key) <= 0)
                {
                    mrr += monthMrr;
                }
            }

            var (year, monthIndex) = PlatformDashboardReadUseCase.ParseMonthBucketKey(key);
            historical.Add(new MrrForecastPoint(
                PlatformDashboardReadUseCase.SpanishShortMonthYear2(year, monthIndex),
                mrr,
                "historical"));
        }

        var avgGrowthRate = AverageMonthOverMonthGrowth(historical);
        avgGrowthRate = Math.Max(MinMonthlyGrowth, Math.Min(MaxMonthlyGrowth, avgGrowthRate));

        var currentMrr = historical[^1].Mrr;

        // The projected labels come from `new Date()` advanced i months with the day pinned to the 1st —
        // the SAME calendar walk as the buckets, continued forward.
        var currentMonthStart = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var projected = new List<MrrForecastPoint>(ForecastMonths);
        for (var i = 1; i <= ForecastMonths; i++)
        {
            var future = currentMonthStart.AddMonths(i);
            projected.Add(new MrrForecastPoint(
                PlatformDashboardReadUseCase.SpanishShortMonthYear2(future.Year, future.Month - 1),
                PlatformDashboardReadUseCase.JsRoundToInt64(currentMrr * Math.Pow(1 + avgGrowthRate, i)),
                "projected"));
        }

        var projectedMrr12m = projected[^1].Mrr;

        // `Record<string, { count, mrr }>` over ALL active subscriptions — note this one has NO date
        // bound at all, so a future-dated row IS counted here while it is absent from `currentMrr`.
        var planBreakdown = new Dictionary<string, PlanBreakdownEntry>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            var price = PlanPrices.For(row.Plan);
            planBreakdown.TryGetValue(row.Plan, out var existing);
            planBreakdown[row.Plan] = new PlanBreakdownEntry(
                (existing?.Count ?? 0) + row.Count,
                (existing?.Mrr ?? 0) + ((long)price * row.Count));
        }

        // `pendingTrials * (PLAN_PRICES.starter || 499)`. The `|| 499` is dead while starter is 499 and
        // would only fire if the plan were repriced to 0 — reproduced so a repricing behaves identically
        // in both stacks rather than diverging at the one value JS treats as falsy.
        var starterPrice = PlanPrices.For("starter");
        var trialConversionPrice = starterPrice != 0 ? starterPrice : 499;

        return new MrrForecastResult(
            historical,
            projected,
            currentMrr,
            projectedMrr12m,
            projectedMrr12m * 12,
            // `Math.round(avgGrowthRate * 100 * 10) / 10` — one decimal, and the ONLY caller of JsRound
            // that can go negative.
            PlatformDashboardReadUseCase.JsRound(avgGrowthRate * 100 * 10) / 10.0,
            planBreakdown,
            pendingTrials,
            (long)pendingTrials * trialConversionPrice);
    }

    /// <summary>
    /// The mean month-over-month growth rate across the NON-ZERO historical months only.
    ///
    /// <para>Reproduced with both of TS's guards intact: fewer than two non-zero months yields 0, and the
    /// inner <c>if (nonZero[i-1].mrr &gt; 0)</c> is kept even though the array is already filtered to
    /// positive values — a redundant test in TS, and removing it would be a silent behaviour change if the
    /// filter ever loosened.</para>
    ///
    /// <para>Dropping the zero months means the "months" being compared can be non-adjacent: a platform
    /// with MRR in January and then nothing until June compares June directly against January and calls
    /// it one month of growth. That is what the procedure does.</para>
    /// </summary>
    private static double AverageMonthOverMonthGrowth(IReadOnlyList<MrrForecastPoint> historical)
    {
        var nonZero = historical.Where(m => m.Mrr > 0).ToList();
        if (nonZero.Count < 2)
        {
            return 0;
        }

        var growthRates = new List<double>(nonZero.Count - 1);
        for (var i = 1; i < nonZero.Count; i++)
        {
            if (nonZero[i - 1].Mrr > 0)
            {
                growthRates.Add((double)(nonZero[i].Mrr - nonZero[i - 1].Mrr) / nonZero[i - 1].Mrr);
            }
        }

        if (growthRates.Count == 0)
        {
            return 0;
        }

        // `reduce((a, b) => a + b, 0) / growthRates.length` — a sequential left-to-right sum, which is
        // what LINQ Sum() over doubles also does. Summation ORDER matters for IEEE-754 doubles, so this
        // is a fidelity note, not pedantry.
        return growthRates.Sum() / growthRates.Count;
    }

    /// <summary>Collapses the <c>(month, plan, count)</c> aggregate to <c>month → MRR</c>, applying the
    /// plan price table once per row.</summary>
    private static Dictionary<string, long> MrrByMonth(IReadOnlyList<ActivePlanMonthCount> rows)
    {
        var mrrByMonth = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            mrrByMonth.TryGetValue(row.Month, out var current);
            mrrByMonth[row.Month] = current + ((long)PlanPrices.For(row.Plan) * row.Count);
        }

        return mrrByMonth;
    }
}
