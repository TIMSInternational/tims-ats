using System.Globalization;

namespace Tims.Application.PlatformDashboard;

/// <summary>One organization's churn inputs with its overdue total ALREADY converted. The FX call is the
/// only impure step in <c>getChurnRisk</c>; splitting it out here is what lets the scoring below be a pure
/// function of its arguments and therefore unit-testable without a rate provider.</summary>
public sealed record ChurnOrgConverted(ChurnOrgRow Row, double OverdueAmount, bool OverdueConverted);

/// <summary>
/// The pure <c>getChurnRisk</c> scoring kernel (<c>routers/platform/dashboard-churn.ts:36-179</c>) —
/// Phase-5 slice 23, issue #81, PR 3 of 3.
///
/// <para>Extracted into its own class purely for FILE SIZE; it plays the same role as
/// <c>PlatformDashboardAccountsUseCase.BuildCustomerHealth</c> and would sit beside the orchestration if it
/// were smaller. Nothing here touches the clock, the database or an FX rate: <c>nowUtc</c> and the already
/// converted totals are arguments.</para>
///
/// <para><b>Five signals summing to 0-100, then a three-way band.</b> The bands and the risk STRINGS are
/// independent: a score can be <c>green</c> while still emitting risks (an org with one overdue invoice
/// loses 15 points and keeps 85), and the emitted <c>primaryRisk</c> is <c>risks[0]</c> — the first
/// condition in SOURCE order, not the most damaging one.</para>
/// </summary>
public static class ChurnRiskKernel
{
    /// <summary>The sentinel days-since-last-login for an organization where no active user has ever logged
    /// in. Scored as 999 (worst recency band) and reported as <c>null</c> — which means a real 999-day
    /// silence is indistinguishable on the wire from never having logged in. Reproduced, not corrected.
    /// The same constant as <c>PlatformDashboardAccountsUseCase.NeverLoggedInDays</c>, restated rather than
    /// shared because the two procedures could diverge without either being wrong.</summary>
    public const int NeverLoggedInDays = 999;

    public static ChurnRiskResult Build(IReadOnlyList<ChurnOrgConverted> orgs, DateTime nowUtc)
    {
        var results = new List<ChurnRiskOrganization>(orgs.Count);

        foreach (var org in orgs)
        {
            results.Add(Score(org, nowUtc));
        }

        // `results.sort((a, b) => a.healthScore - b.healthScore)` — ASCENDING, worst first. Stable in both
        // stacks (JS Array.prototype.sort is stable per spec; LINQ OrderBy is documented stable), so a tie
        // preserves the input order — which is an unordered findMany, hence unspecified. Parity caveat, not
        // a bug to patch with an ORDER BY TS does not send.
        var sorted = results.OrderBy(r => r.HealthScore).ToList();

        return new ChurnRiskResult(
            sorted,
            new ChurnRiskSummary(
                sorted.Count(r => string.Equals(r.Tier, "green", StringComparison.Ordinal)),
                sorted.Count(r => string.Equals(r.Tier, "yellow", StringComparison.Ordinal)),
                sorted.Count(r => string.Equals(r.Tier, "red", StringComparison.Ordinal)),
                sorted.Count,
                sorted.Where(r => string.Equals(r.Tier, "red", StringComparison.Ordinal)).Sum(r => (long)r.Mrr)));
    }

    private static ChurnRiskOrganization Score(ChurnOrgConverted org, DateTime nowUtc)
    {
        var row = org.Row;
        var plan = row.SubscriptionPlan ?? PlatformDashboardAccountsUseCase.DefaultPlan;

        // MRR counts only for an ACTIVE subscription — a trialing or past_due tenant contributes 0 even
        // though its plan name still appears on the row.
        var mrr = string.Equals(row.SubscriptionStatus, "active", StringComparison.Ordinal)
            ? PlanPrices.For(plan)
            : 0;

        var totalUsers = row.ActiveUsers;

        // Signal 1 — login rate (0-30). A FRACTION here; the wire field is the same value as a percentage,
        // rounded separately. Both roundings are JS half-up.
        var loginRate = totalUsers > 0 ? (double)row.RecentLogins / totalUsers : 0;
        var loginScore = PlatformDashboardReadUseCase.JsRound(loginRate * 30);

        // Signal 2 — invoice health (0-25). Note it is the COUNT that scores, not the amount: a single
        // enormous overdue invoice costs 15 points and two trivial ones cost 25.
        var overdueCount = row.OverdueInvoices.Count;
        var invoiceScore = overdueCount == 0 ? 25 : overdueCount == 1 ? 10 : 0;

        // Signal 3 — recency (0-20), off the LATEST login across active users.
        var daysSinceLastLogin = row.LastLoginAt is { } lastLogin
            ? (int)Math.Floor((nowUtc - lastLogin).TotalMilliseconds / PlatformDashboardReadUseCase.MillisecondsPerDay)
            : NeverLoggedInDays;
        var recencyScore = daysSinceLastLogin <= 1 ? 20
            : daysSinceLastLogin <= 3 ? 16
            : daysSinceLastLogin <= 7 ? 12
            : daysSinceLastLogin <= 14 ? 6
            : 0;

        // Signal 4 — feature adoption (0-15) over EVERY feature-flag row, enabled or not.
        var featureCount = row.FeatureCount;
        var adoptionScore = featureCount >= 8 ? 15
            : featureCount >= 5 ? 12
            : featureCount >= 3 ? 8
            : featureCount >= 1 ? 4
            : 0;

        // Signal 5 — tenure (0-10). The floor is 2, not 0: a brand-new organization is never scored as if
        // it had no tenure at all.
        var daysSinceCreation = (int)Math.Floor((nowUtc - row.CreatedAt).TotalMilliseconds / PlatformDashboardReadUseCase.MillisecondsPerDay);
        var tenureScore = daysSinceCreation >= 180 ? 10
            : daysSinceCreation >= 90 ? 8
            : daysSinceCreation >= 30 ? 5
            : 2;

        var healthScore = loginScore + invoiceScore + recencyScore + adoptionScore + tenureScore;
        var tier = healthScore >= 70 ? "green" : healthScore >= 40 ? "yellow" : "red";

        var (risks, actions) = BuildRisks(org, loginRate, totalUsers, daysSinceLastLogin, overdueCount, featureCount, nowUtc);

        return new ChurnRiskOrganization(
            row.OrgId,
            row.OrgName,
            plan,
            mrr,
            healthScore,
            tier,
            totalUsers,
            PlatformDashboardReadUseCase.JsRound(loginRate * 100),
            daysSinceLastLogin == NeverLoggedInDays ? null : daysSinceLastLogin,
            overdueCount,
            org.OverdueAmount,
            PlatformDashboardFxUseCase.DisplayCurrency,
            org.OverdueConverted,
            featureCount,
            risks.Count > 0 ? risks[0] : "Healthy",
            risks,
            actions,
            new ChurnRiskSignals(loginScore, invoiceScore, recencyScore, adoptionScore, tenureScore));
    }

    /// <summary>
    /// The risk/action pair lists, in SOURCE order — the order decides <c>primaryRisk</c>.
    ///
    /// <para><b>The two pluralizations are deliberately different and are reproduced as written.</b> The
    /// invoice string uses <c>count &gt; 1 ? 's' : ''</c> and the trial string uses
    /// <c>days !== 1 ? 's' : ''</c>. They agree everywhere except at zero and below — unreachable for
    /// invoices (guarded by <c>&gt; 0</c>) but perfectly reachable for a trial that has already expired,
    /// where <c>0</c> and <c>-3</c> both take the plural. Collapsing them to one rule would change output.
    /// </para>
    ///
    /// <para>The converted overdue TOTAL is interpolated with <c>toLocaleString()</c> and no locale
    /// argument, so the deployed Node process's default ICU locale is part of this string on the wire —
    /// the same environmental dependency <c>getAttentionItems</c> carries, and the reason
    /// <see cref="PlatformDashboardReadUseCase.JsToLocaleString"/> exists.</para>
    /// </summary>
    private static (List<string> Risks, List<string> Actions) BuildRisks(
        ChurnOrgConverted org,
        double loginRate,
        int totalUsers,
        int daysSinceLastLogin,
        int overdueCount,
        int featureCount,
        DateTime nowUtc)
    {
        var risks = new List<string>(5);
        var actions = new List<string>(5);

        if (overdueCount > 0)
        {
            var plural = overdueCount > 1 ? "s" : string.Empty;
            risks.Add(
                $"{Int(overdueCount)} overdue invoice{plural} ({PlatformDashboardFxUseCase.DisplayCurrency} " +
                $"{PlatformDashboardReadUseCase.JsToLocaleString(org.OverdueAmount)})");
            actions.Add("send_dunning");
        }

        if (daysSinceLastLogin >= 14)
        {
            risks.Add($"No login in {Int(daysSinceLastLogin)} days");
            actions.Add("reactivation_email");
        }
        else if (daysSinceLastLogin >= 7)
        {
            risks.Add($"Last login {Int(daysSinceLastLogin)} days ago");
            actions.Add("check_in");
        }

        // `totalUsers > 1` — a single-user organization never trips the adoption risk however dormant it
        // is, because one dormant user is a 0% rate and would flag every solo tenant.
        if (loginRate < 0.3 && totalUsers > 1)
        {
            var percent = PlatformDashboardReadUseCase.JsRound(loginRate * 100);
            risks.Add($"Only {Int(percent)}% login rate ({Int(org.Row.RecentLogins)}/{Int(totalUsers)} users)");
            actions.Add("adoption_call");
        }

        if (featureCount < 3)
        {
            risks.Add($"Only {Int(featureCount)} features adopted");
            actions.Add("onboarding_session");
        }

        if (string.Equals(org.Row.SubscriptionStatus, "trialing", StringComparison.Ordinal))
        {
            // `Math.ceil` of a negative remainder rounds TOWARD ZERO, so an expired trial reports 0 or a
            // negative count rather than being clamped — and still trips the `<= 7` guard, which is how a
            // long-expired trial keeps emitting a "expires in -40 days" risk. Reproduced.
            int? trialDaysLeft = org.Row.TrialEndsAt is { } trialEndsAt
                ? (int)Math.Ceiling((trialEndsAt - nowUtc).TotalMilliseconds / PlatformDashboardReadUseCase.MillisecondsPerDay)
                : null;

            if (trialDaysLeft is { } left && left <= 7)
            {
                var plural = left != 1 ? "s" : string.Empty;
                risks.Add($"Trial expires in {Int(left)} day{plural}");
                actions.Add("conversion_call");
            }
        }

        return (risks, actions);
    }

    /// <summary>JS integer interpolation — <c>`${n}`</c> is culture-INDEPENDENT and never groups. A bare
    /// <c>ToString()</c> would take the ambient culture, which is how a Spanish-locale host would start
    /// emitting decimal commas inside these strings.</summary>
    private static string Int(int value) => value.ToString(CultureInfo.InvariantCulture);
}
