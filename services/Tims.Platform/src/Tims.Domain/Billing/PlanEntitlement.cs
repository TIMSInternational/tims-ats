namespace Tims.Domain.Billing;

/// <summary>
/// Per-plan usage limits — a faithful port of the TS <c>PlanLimits</c> (packages/shared/src/constants).
/// <c>null</c> = unlimited (the enterprise tier). Golden-fixtured against the real TS values
/// (contracts/billing-fixtures/plan-entitlement.json).
/// </summary>
public sealed record PlanLimits(int? Employees, int? Vacancies, int? Assessments);

/// <summary>
/// The billing entitlement kernel — a faithful port of the pure TS <c>planLimits</c> / <c>entitledPlan</c>
/// (packages/shared/src/constants). Operates on the plan/status DB strings (the C# side reads the native
/// <c>OrgPlan</c>/<c>SubscriptionStatus</c> enums as strings). The load-bearing invariant: a CANCELLED
/// subscription (or a missing plan) loses paid entitlement and falls back to <c>trial</c> limits, never its
/// old paid/enterprise caps. Golden-fixtured BOTH stacks (plan-entitlement.json).
/// </summary>
public static class PlanEntitlement
{
    public const string TrialPlan = "trial";

    /// <summary>Per-plan usage limits (TS <c>PLAN_LIMITS</c>). Unknown plans are absent → the defensive
    /// <see cref="Limits"/> fallback returns trial.</summary>
    private static readonly IReadOnlyDictionary<string, PlanLimits> PlanLimitsByPlan =
        new Dictionary<string, PlanLimits>(StringComparer.Ordinal)
        {
            [TrialPlan] = new(Employees: 5, Vacancies: 3, Assessments: 20),
            ["starter"] = new(Employees: 25, Vacancies: 10, Assessments: 200),
            ["professional"] = new(Employees: 100, Vacancies: 50, Assessments: 2000),
            ["enterprise"] = new(Employees: null, Vacancies: null, Assessments: null),
        };

    /// <summary>
    /// Limits for a plan, defaulting to the most conservative (trial) for an unknown value — a faithful port
    /// of TS <c>planLimits(plan) = PLAN_LIMITS[plan] ?? PLAN_LIMITS.trial</c>.
    /// </summary>
    public static PlanLimits Limits(string? plan) =>
        plan is not null && PlanLimitsByPlan.TryGetValue(plan, out var limits)
            ? limits
            : PlanLimitsByPlan[TrialPlan];

    /// <summary>
    /// Effective entitlement plan for usage/limits — a faithful port of TS <c>entitledPlan(plan, status)</c>:
    /// a missing plan (<c>!plan</c> — null/empty) or a <c>cancelled</c> status falls back to <c>trial</c>;
    /// any other status keeps the plan string verbatim (including an unknown plan, which then defensively
    /// resolves to trial limits in <see cref="Limits"/>).
    /// </summary>
    public static string EntitledPlan(string? plan, string? status) =>
        string.IsNullOrEmpty(plan) || status == "cancelled" ? TrialPlan : plan;
}
