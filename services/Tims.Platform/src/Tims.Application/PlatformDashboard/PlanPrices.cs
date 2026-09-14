using System.Collections.ObjectModel;

namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The C# port of <c>packages/api/src/lib/plan-prices.ts</c> — monthly USD list price per
/// <c>OrgPlan</c>. Six of the platform dashboard's procedures derive every MRR figure from this table
/// alone, which is exactly what makes them the FX-FREE tier: no <c>sumMoney</c>, no Frankfurter call, no
/// live rate. (The three that DO call <c>sumMoney</c> — <c>getDashboardKpis</c>,
/// <c>getRevenueByCustomer</c>, <c>getChurnRisk</c> — port last, in PR 3.)
///
/// <para><b>Pinned cross-stack.</b> These four numbers are duplicated source-of-truth, so both stacks
/// assert them against <c>planPrices</c> in <c>contracts/dashboard-fixtures/dashboard-kernels.json</c> —
/// the TS side against the real <c>PLAN_PRICES</c> import, the C# side against this table. A repricing
/// that lands on one side only is then a red build rather than a silent MRR divergence on every
/// dashboard endpoint at once.</para>
///
/// <para><b>Lookups are <c>PLAN_PRICES[plan] || 0</c> in TS</b> — an unknown plan contributes zero rather
/// than throwing. <see cref="For"/> reproduces that. It is not dead code even though the column is the
/// four-label <c>OrgPlan</c> enum: <c>getUpsellOpportunities</c> reads <c>org.plan</c> through a
/// <c>?? 'trial'</c> chain, and reproducing the fallback keeps the port total.</para>
/// </summary>
public static class PlanPrices
{
    public static readonly ReadOnlyDictionary<string, int> Table = new(new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["trial"] = 0,
        ["starter"] = 499,
        ["professional"] = 999,
        ["enterprise"] = 2499,
    });

    /// <summary><c>PLAN_PRICES[plan] || 0</c>.</summary>
    public static int For(string plan) => Table.TryGetValue(plan, out var price) ? price : 0;
}
