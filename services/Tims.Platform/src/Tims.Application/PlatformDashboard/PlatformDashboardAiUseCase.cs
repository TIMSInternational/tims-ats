using System.Globalization;

namespace Tims.Application.PlatformDashboard;

/// <summary>
/// <c>getAiCostAnomalies</c> (Phase-5 slice 23 / issue #81 — the thirteenth and FINAL read of the
/// platform dashboard cluster, routers/platform/dashboard-upsell.ts:130). Classifies every ENABLED,
/// non-stub agent+org configuration against its last-30-days usage into zero, one or TWO anomalies.
///
/// <para><b>The two anomaly branches are independent <c>if</c>s, not an <c>else if</c>, and that is
/// reachable:</b> a config with NO usage and a NEGATIVE budget produces BOTH a <c>zero_usage</c> anomaly
/// (calls == 0) and an <c>over_budget</c> one (<c>0 &gt; budget</c> holds for a negative budget, and a
/// negative number is truthy in JS). Pinned by unit and integration tests, because collapsing the two
/// into an <c>else if</c> is the natural-looking refactor that changes the payload.</para>
/// </summary>
public sealed class PlatformDashboardAiUseCase(IPlatformDashboardAiRepository repository)
{
    /// <summary><c>`Enabled but 0 calls in 30 days`</c> — a constant template literal in TS (the
    /// backticks carry no interpolation).</summary>
    public const string ZeroUsageDetail = "Enabled but 0 calls in 30 days";

    /// <summary><c>costPerCall * 10</c> — "Assume min 10 calls expected", dashboard-upsell.ts:186.</summary>
    public const int ExpectedMinimumCalls = 10;

    public async Task<AiCostAnomaliesResult> GetAiCostAnomaliesAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        // TS: `new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)` — a flat 30-day millisecond subtraction
        // from the request instant, not a calendar operation. AddDays on a JsNow()-derived value is the
        // identical arithmetic.
        var thirtyDaysAgo = nowUtc.AddDays(-30);

        var configs = await repository.GetEnabledAgentConfigsAsync(cancellationToken).ConfigureAwait(false);
        var usage = await repository.GetUsageSinceAsync(thirtyDaysAgo, cancellationToken).ConfigureAwait(false);

        return BuildAiCostAnomalies(configs, usage);
    }

    /// <summary>
    /// The pure kernel. Scan order is the CONFIG row order (an unordered <c>findMany</c> in both stacks),
    /// and it is observable twice: ties in the final <c>potentialSavings</c> sort keep scan order (both
    /// stacks sort stably), and <c>totalPotentialSavings</c> accumulates floating-point additions in scan
    /// order — which is why it is summed IN the loop rather than recomputed from the sorted list; double
    /// addition is not associative and the TS total is the pre-sort accumulation.
    /// </summary>
    public static AiCostAnomaliesResult BuildAiCostAnomalies(
        IReadOnlyList<EnabledAgentConfigRow> configs,
        IReadOnlyList<AgentUsageRow> usage)
    {
        // `usageMap` keyed `${agentId}:${organizationId}` — a value-tuple key is the same identity.
        var usageByPair = new Dictionary<(Guid AgentId, Guid OrganizationId), (double Cost, int Calls)>(usage.Count);
        foreach (var row in usage)
        {
            // `_sum.costUsd ?? 0` — the null arm is dead (a group always has rows and cost_usd is NOT
            // NULL), reproduced anyway; see AgentUsageRow.
            usageByPair[(row.AgentId, row.OrganizationId)] = (row.CostSum ?? 0, row.Calls);
        }

        var anomalies = new List<AiCostAnomalyItem>();
        var totalPotentialSavings = 0d;

        foreach (var config in configs)
        {
            // `if (config.agent.status === 'stub') continue` — the ONLY status the kernel treats
            // specially. Anything else ('active', 'beta', …) participates; a `=== 'active'` filter here
            // would be an improvement, and improvements make parity uninterpretable.
            if (string.Equals(config.AgentStatus, "stub", StringComparison.Ordinal))
            {
                continue;
            }

            var hasUsage = usageByPair.TryGetValue((config.AgentId, config.OrganizationId), out var pairUsage);
            var monthlyCost = hasUsage ? pairUsage.Cost : 0;
            var calls = hasUsage ? pairUsage.Calls : 0;

            if (calls == 0)
            {
                var estimatedWaste = config.AgentCostPerCall * ExpectedMinimumCalls;
                anomalies.Add(new AiCostAnomalyItem(
                    "zero_usage",
                    config.AgentName,
                    config.AgentSlug,
                    config.OrgName,
                    config.OrganizationId.ToString(),
                    ZeroUsageDetail,
                    MonthlyCost: 0,
                    config.MonthlyBudget,
                    estimatedWaste));
                totalPotentialSavings += estimatedWaste;
            }

            // `config.monthlyBudget && monthlyCost > config.monthlyBudget` — JS TRUTHINESS on a
            // number|null: null and 0 are falsy, so a ZERO budget can never be exceeded (deliberate or
            // not, it is the TS behaviour), while a NEGATIVE budget is truthy and IS exceeded by a zero
            // spend. (NaN is falsy in JS; here `monthlyCost > NaN` is false, so a NaN budget yields no
            // anomaly through either guard and no separate check is needed.)
            if (config.MonthlyBudget is { } budget && budget != 0 && monthlyCost > budget)
            {
                var overage = monthlyCost - budget;
                anomalies.Add(new AiCostAnomalyItem(
                    "over_budget",
                    config.AgentName,
                    config.AgentSlug,
                    config.OrgName,
                    config.OrganizationId.ToString(),
                    $"${JsToFixed2(monthlyCost)} spent vs ${JsToFixed2(budget)} budget",
                    monthlyCost,
                    config.MonthlyBudget,
                    overage));
                totalPotentialSavings += overage;
            }
        }

        // `sort((a, b) => b.potentialSavings - a.potentialSavings)` — stable in both stacks, so equal
        // savings keep config scan order.
        var sorted = anomalies.OrderByDescending(a => a.PotentialSavings).ToList();

        return new AiCostAnomaliesResult(
            sorted,
            totalPotentialSavings,
            sorted.Count(a => string.Equals(a.Type, "zero_usage", StringComparison.Ordinal)),
            sorted.Count(a => string.Equals(a.Type, "over_budget", StringComparison.Ordinal)));
    }

    /// <summary>
    /// <c>Number.prototype.toFixed(2)</c>, exactly — used for the over-budget detail string.
    ///
    /// <para><b><c>value.ToString("F2")</c> is NOT this function.</b> ECMAScript picks the integer
    /// <c>n</c> minimising <c>|n/100 − x|</c> over the EXACT binary value and resolves a tie to the
    /// LARGER <c>n</c> — half-up on the exact expansion — while .NET Core 3.0+ "F2" resolves the same tie
    /// to EVEN. The observable split: JS <c>(0.125).toFixed(2) === "0.13"</c>, .NET
    /// <c>(0.125).ToString("F2") == "0.12"</c>. And BOTH differ from naive decimal reading:
    /// <c>(1.005).toFixed(2) === "1.00"</c> because the double is 1.00499999999999989…. This
    /// implementation reads the exact decimal expansion (.NET Core 3.0+ fixed-format is exact) and
    /// rounds on its third fractional digit, which is precisely the ECMAScript rule; every doubtful case
    /// in the unit tests is pinned against values verified in Node.</para>
    ///
    /// <para>A negative value formats as <c>"-" + toFixed(-x)</c> per spec — the magnitude rounds half
    /// AWAY from zero — and negative zero is not <c>&lt; 0</c>, so <c>-0</c> formats as <c>"0.00"</c>,
    /// as in JS. Magnitudes ≥ 1e21 fall back to exponential notation in JS; unreachable for money and
    /// deliberately not reproduced (this method would emit the plain expansion).</para>
    /// </summary>
    public static string JsToFixed2(double value)
    {
        if (double.IsNaN(value))
        {
            return "NaN";
        }

        var negative = value < 0;
        // `+ 0d` normalises NEGATIVE ZERO to positive zero (−0 + 0 = +0 in IEEE-754): −0 is not < 0, so
        // it takes this branch, but ToString would still print its sign and emit "-0.00" where JS says
        // "0.00".
        var magnitude = negative ? -value : value + 0d;

        // F99 must be the EXACT expansion, not a rounded one — a small precision like F4 ROUNDS, so the
        // double just below the tie (exact expansion 0.00499999999999999924…) would format as "0.0050"
        // and the digit rule below would read it as ≥ half and round UP where Node says "0.00". At F99
        // no rounding occurs for any magnitude that matters: a double ≥ 1e-10 has an exact expansion
        // terminating well inside 99 fractional digits (it ends at the mantissa's last binary place),
        // and anything smaller has zeros in every digit this method inspects.
        var exact = magnitude.ToString("F99", CultureInfo.InvariantCulture);
        var dot = exact.IndexOf('.', StringComparison.Ordinal);

        // Everything the result keeps, as one digit string: the integer part plus two fraction digits.
        // The THIRD fraction digit of the exact expansion decides alone: '5'-or-above means the
        // remainder is at least half of the last kept place (== '5' with a zero tail is the exact tie,
        // which ECMAScript resolves UP; any non-zero tail is above half), below '5' can never reach it.
        var digits = (exact[..dot] + exact.Substring(dot + 1, 2)).ToCharArray();
        if (exact[dot + 3] >= '5')
        {
            // Increment by one with carry, as strings — no numeric type reintroduces a rounding step
            // or an overflow bound ("9.995" → "9.99" needs no carry, "99.999" → "100.00" carries out).
            var i = digits.Length - 1;
            while (i >= 0 && digits[i] == '9')
            {
                digits[i] = '0';
                i--;
            }

            if (i >= 0)
            {
                digits[i]++;
            }
            else
            {
                digits = ['1', .. digits];
            }
        }

        var text = new string(digits);
        return $"{(negative ? "-" : string.Empty)}{text[..^2]}.{text[^2..]}";
    }
}
