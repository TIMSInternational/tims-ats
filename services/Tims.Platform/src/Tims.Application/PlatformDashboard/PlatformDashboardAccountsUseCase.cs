using System.Globalization;

namespace Tims.Application.PlatformDashboard;

/// <summary>
/// <c>getCustomerHealth</c> and <c>getUpsellOpportunities</c> (Phase-5 slice 23 / issue #81, PR 2 of 3) —
/// the two per-tenant scoring reads. Both are pure classification over counts; neither touches currency
/// conversion, which is what puts them in the FX-free tier alongside the MRR pair.
/// </summary>
public sealed class PlatformDashboardAccountsUseCase(IPlatformDashboardAccountsRepository repository)
{
    /// <summary>"No login ever = treat as very stale" — the sentinel TS substitutes for a null
    /// <c>lastLogin</c>. It is a real value on the wire, not a null, and it lands in the
    /// <c>&gt;= 14</c> critical branch.</summary>
    public const int NeverLoggedInDays = 999;

    /// <summary>An organization with no subscription row is treated as a trial.</summary>
    public const string DefaultPlan = "trial";

    // ── getCustomerHealth ────────────────────────────────────────────────────────────────────────────
    public async Task<IReadOnlyList<CustomerHealthItem>> GetCustomerHealthAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        var sevenDaysAgo = nowUtc.AddDays(-7);

        // `fourteenDaysAgo` is computed by the TS procedure and never used — the 14-day rule is applied
        // to the DERIVED daysSinceLastLogin instead. Not reproduced: it is a local variable with no
        // observable effect, unlike the dead `recentAudit` QUERY in getRecentActivity, which at least
        // cost a round trip.
        var rows = await repository.GetCustomerHealthRowsAsync(nowUtc, sevenDaysAgo, cancellationToken).ConfigureAwait(false);
        return BuildCustomerHealth(rows, nowUtc);
    }

    /// <summary>
    /// Scores each organization into one of three health bands, then orders critical → at_risk → healthy.
    ///
    /// <para>The band order is applied with a STABLE sort in both stacks, and the input order is the
    /// database's unordered <c>findMany</c>, so rows within a band are in an unspecified order that the
    /// two stacks can legitimately disagree on. That is a property of the procedure, recorded as a parity
    /// caveat rather than patched with an <c>ORDER BY</c> TS does not send.</para>
    /// </summary>
    public static IReadOnlyList<CustomerHealthItem> BuildCustomerHealth(IReadOnlyList<CustomerHealthOrgRow> rows, DateTime nowUtc)
    {
        var items = new List<CustomerHealthItem>(rows.Count);

        foreach (var row in rows)
        {
            var plan = row.SubscriptionPlan ?? DefaultPlan;
            var totalUsers = row.ActiveUsers;

            // `Math.round((recentLogins / totalUsers) * 100)`, and 0 when there are no active users at
            // all — the guard exists to avoid 0/0 = NaN, which would serialise as null.
            var loginRate = totalUsers > 0
                ? PlatformDashboardReadUseCase.JsRound((double)row.RecentLogins / totalUsers * 100)
                : 0;

            var daysSinceLastLogin = row.LastLoginAt is { } lastLogin
                ? (int)Math.Floor((nowUtc - lastLogin).TotalMilliseconds / PlatformDashboardReadUseCase.MillisecondsPerDay)
                : NeverLoggedInDays;

            // Only a TRIALING subscription with a trial end date gets a countdown; `Math.ceil` of a
            // negative remainder rounds toward zero, so an already-expired trial reports 0 or a negative
            // number rather than being clamped.
            int? trialDaysLeft = null;
            if (string.Equals(row.SubscriptionStatus, "trialing", StringComparison.Ordinal) && row.TrialEndsAt is { } trialEndsAt)
            {
                trialDaysLeft = (int)Math.Ceiling((trialEndsAt - nowUtc).TotalMilliseconds / PlatformDashboardReadUseCase.MillisecondsPerDay);
            }

            var health = row.OverdueInvoices > 0 || daysSinceLastLogin >= 14
                ? "critical"
                : loginRate < 30 || (trialDaysLeft is { } left && left < 5)
                    ? "at_risk"
                    : "healthy";

            items.Add(new CustomerHealthItem(
                row.OrgId,
                row.OrgName,
                plan,
                health,
                new CustomerHealthSignals(loginRate, row.OverdueInvoices, trialDaysLeft, daysSinceLastLogin)));
        }

        return items.OrderBy(HealthRank).ToList();
    }

    /// <summary><c>{ critical: 0, at_risk: 1, healthy: 2 }</c>. Unreachable default sorts last, same
    /// disposition as the attention kernel's severity rank.</summary>
    private static int HealthRank(CustomerHealthItem item) => item.Health switch
    {
        "critical" => 0,
        "at_risk" => 1,
        "healthy" => 2,
        _ => 3,
    };

    // ── getUpsellOpportunities ───────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The three <c>UPSELL_RULES</c>, IN DECLARATION ORDER (<c>Object.entries</c> order). The order is
    /// not observable today — the plans are mutually exclusive, so at most one rule can match an
    /// organization — but it is the order TS iterates and cost nothing to preserve.
    ///
    /// <para><c>MrrIncrease</c> uses <c>??</c> fallbacks in TS (<c>PLAN_PRICES.professional ?? 999</c>),
    /// NOT the <c>|| 0</c> used elsewhere in the cluster: a plan priced at zero would keep its zero here
    /// and fall back to the literal there. Both are dead while all four keys exist; both are reproduced
    /// distinctly, because the difference only shows up on the day a plan is repriced to 0.</para>
    /// </summary>
    private static readonly UpsellRule[] Rules =
    [
        new("starter", "professional", 8, 5, PriceOr("professional", 999) - PriceOr("starter", 499)),
        new("professional", "enterprise", 20, 8, PriceOr("enterprise", 2499) - PriceOr("professional", 999)),
        new("trial", "starter", 3, 2, PriceOr("starter", 499)),
    ];

    public async Task<UpsellOpportunitiesResult> GetUpsellOpportunitiesAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        var rows = await repository.GetUpsellRowsAsync(nowUtc.AddDays(-7), cancellationToken).ConfigureAwait(false);
        return BuildUpsellOpportunities(rows);
    }

    /// <summary>
    /// Scores every active organization against the three upgrade rules and keeps those above 40.
    ///
    /// <para><b>The score thresholds and the reason strings are one unit.</b> A reason is pushed exactly
    /// when its points are added, and the emitted <c>reason</c> field is <c>reasons[0]</c> — so the first
    /// SATISFIED condition wins, in condition order (users → features → active → vacancies), not the
    /// highest-scoring one. A score of at least 40 always implies at least one pushed reason (40 alone,
    /// or 30+20, or 30+10), so the index is total.</para>
    /// </summary>
    public static UpsellOpportunitiesResult BuildUpsellOpportunities(IReadOnlyList<UpsellOrgRow> rows)
    {
        var opportunities = new List<UpsellOpportunity>();

        foreach (var org in rows)
        {
            var plan = org.SubscriptionPlan ?? org.OrgPlan ?? DefaultPlan;

            // An org whose subscription is cancelled/past_due (or absent) is skipped entirely — note
            // TRIALING counts as active here, which is what makes the trial→starter rule reachable.
            var isActive = string.Equals(org.SubscriptionStatus, "active", StringComparison.Ordinal)
                || string.Equals(org.SubscriptionStatus, "trialing", StringComparison.Ordinal);
            if (!isActive)
            {
                continue;
            }

            foreach (var rule in Rules)
            {
                if (!string.Equals(plan, rule.CurrentPlan, StringComparison.Ordinal))
                {
                    continue;
                }

                var reasons = new List<string>(4);
                var score = 0;

                if (org.TotalUsers >= rule.MinUsers)
                {
                    reasons.Add($"{org.TotalUsers.ToString(CultureInfo.InvariantCulture)} users (threshold: {rule.MinUsers.ToString(CultureInfo.InvariantCulture)})");
                    score += 40;
                }

                if (org.Features >= rule.MinFeatures)
                {
                    reasons.Add($"{org.Features.ToString(CultureInfo.InvariantCulture)} features adopted (threshold: {rule.MinFeatures.ToString(CultureInfo.InvariantCulture)})");
                    score += 30;
                }

                if (org.ActiveRecentUsers >= ActiveUserThreshold(rule.MinUsers))
                {
                    reasons.Add($"{org.ActiveRecentUsers.ToString(CultureInfo.InvariantCulture)} active in last 7d");
                    score += 20;
                }

                if (org.Vacancies >= 3)
                {
                    reasons.Add($"{org.Vacancies.ToString(CultureInfo.InvariantCulture)} active vacancies");
                    score += 10;
                }

                if (score < 40)
                {
                    continue;
                }

                var confidence = score >= 70 ? "high" : score >= 50 ? "medium" : "low";

                opportunities.Add(new UpsellOpportunity(
                    org.OrgId,
                    org.OrgName,
                    plan,
                    rule.TargetPlan,
                    rule.MrrIncrease,
                    reasons[0],
                    new UpsellSignals(org.ActiveRecentUsers, org.TotalUsers, org.Features, org.Vacancies),
                    confidence));
            }
        }

        var sorted = opportunities.OrderByDescending(o => o.MrrIncrease).ToList();

        return new UpsellOpportunitiesResult(
            sorted,
            sorted.Sum(o => (long)o.MrrIncrease),
            sorted.Count(o => string.Equals(o.Confidence, "high", StringComparison.Ordinal)),
            sorted.Count(o => string.Equals(o.Confidence, "medium", StringComparison.Ordinal)));
    }

    /// <summary>
    /// <c>Math.ceil(rule.minUsers * 0.7)</c>.
    ///
    /// <para><b>Computed, not tabulated, because the arithmetic is IEEE-754 and one of the three inputs
    /// depends on it.</b> <c>3 * 0.7</c> is <c>2.0999999999999996</c> in double precision, so the
    /// threshold for the trial rule is 3 rather than the 2.1-rounds-to-2 a decimal reading suggests;
    /// <c>20 * 0.7</c> lands exactly on 14 and <c>8 * 0.7</c> on 5.6 → 6. C# evaluates the identical
    /// double multiplication, so reproducing the EXPRESSION is safer than hardcoding numbers a future
    /// threshold change would silently invalidate. Pinned at 6/14/3 by unit test.</para>
    /// </summary>
    public static int ActiveUserThreshold(int minUsers) => (int)Math.Ceiling(minUsers * 0.7);

    /// <summary><c>PLAN_PRICES[plan] ?? fallback</c> — nullish coalescing, so a plan priced at 0 keeps
    /// its 0 and only a MISSING key falls back. Distinct from <see cref="PlanPrices.For"/>, which is the
    /// <c>|| 0</c> form the other procedures use.</summary>
    private static int PriceOr(string plan, int fallback) =>
        PlanPrices.Table.TryGetValue(plan, out var price) ? price : fallback;

    private sealed record UpsellRule(string CurrentPlan, string TargetPlan, int MinUsers, int MinFeatures, int MrrIncrease);
}
