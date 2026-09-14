namespace Tims.Application.PlatformDashboard;

// Read models for getMrrTrend (routers/platform/dashboard.ts:451) and getMrrForecast
// (routers/platform/dashboard-forecast.ts:7) — Phase-5 slice 23, issue #81, PR 2 of 3. Both derive
// every figure from the PLAN_PRICES USD constants, which is why they belong to the FX-FREE tier.

/// <summary>One <c>getMrrTrend</c> point — <c>{ month, mrr }</c>, where <c>month</c> is the
/// <c>"sept 26"</c>-style label (see <c>PlatformDashboardReadUseCase.SpanishShortMonthYear2</c>), NOT the
/// <c>YYYY-MM</c> bucket key used internally.</summary>
public sealed record MrrTrendPoint(string Month, long Mrr);

/// <summary>One <c>getMrrForecast</c> point — <c>{ month, mrr, type }</c> where <c>type</c> is the literal
/// <c>"historical"</c> or <c>"projected"</c>. TS builds the two arrays with the discriminator baked into
/// each object literal, so it is a value on the wire, not a container-level fact.</summary>
public sealed record MrrForecastPoint(string Month, long Mrr, string Type);

/// <summary>One <c>planBreakdown</c> value — <c>{ count, mrr }</c>. The KEY is the plan name; TS builds a
/// <c>Record&lt;string, …&gt;</c> keyed by whatever plans the active subscriptions actually carry, so a
/// plan with no active subscriber is absent rather than zero.</summary>
public sealed record PlanBreakdownEntry(int Count, long Mrr);

/// <summary>
/// The whole <c>getMrrForecast</c> payload.
///
/// <para><c>PlanBreakdown</c> is serialised as a JSON OBJECT keyed by plan name.
/// <c>JsonSerializerDefaults.Web</c> camel-cases PROPERTY names but leaves DICTIONARY KEYS alone
/// (<c>DictionaryKeyPolicy</c> is unset), so <c>"professional"</c> stays <c>"professional"</c>. Key order
/// within it is unspecified in BOTH stacks — TS's insertion order follows an unordered <c>findMany</c> —
/// and the parity differ walks a key-set union rather than comparing serialised text, so nothing depends
/// on it.</para>
///
/// <para><c>MonthlyGrowthPct</c> is a <see cref="double"/> because TS emits <c>Math.round(g*100*10)/10</c>
/// — one decimal place. It is NON-NEGATIVE in practice: the historical series it is derived from is a
/// cumulative count over a filter that only widens, so it cannot decrease (pinned by
/// <c>Forecast_historical_is_monotone_nonDecreasing_so_the_negative_growth_cap_is_dead_code</c>).
/// An earlier draft of this docblock said the opposite — that it goes "NEGATIVE whenever MRR is
/// shrinking, which is the case that forced <c>JsRound</c> off <see cref="MidpointRounding.AwayFromZero"/>"
/// — and that causal claim was retracted in the same commit that introduced it; see
/// <c>PlatformDashboardMrrUseCase.MinMonthlyGrowth</c>.</para>
/// </summary>
public sealed record MrrForecastResult(
    IReadOnlyList<MrrForecastPoint> Historical,
    IReadOnlyList<MrrForecastPoint> Projected,
    long CurrentMrr,
    long ProjectedMrr12m,
    long ProjectedArr,
    double MonthlyGrowthPct,
    IReadOnlyDictionary<string, PlanBreakdownEntry> PlanBreakdown,
    int PendingTrials,
    long PotentialMrrFromTrials);

/// <summary>
/// One <c>(YYYY-MM creation month, plan, count)</c> aggregate row over ACTIVE subscriptions — the single
/// database read behind both MRR procedures.
///
/// <para><c>getMrrTrend</c> already asks the database for exactly this. <c>getMrrForecast</c> instead
/// issues TWELVE <c>findMany</c> calls, one per month boundary, each re-reading every active subscription
/// created before it; the same aggregate answers all twelve, because "active subscriptions created before
/// the first instant of month M+1" is exactly "all rows whose creation month is ≤ M". The values are
/// identical — this is not a narrowing.</para>
///
/// <para><b>The one behavioural difference, stated rather than buried:</b> TS's twelve queries run at
/// twelve different instants, so a subscription created mid-loop lands in the later buckets only. One
/// aggregate is a single snapshot, which is more self-consistent, not less faithful in output — the
/// affected window is milliseconds and TS's own result is unspecified inside it.</para>
/// </summary>
public sealed record ActivePlanMonthCount(string Month, string Plan, int Count);
