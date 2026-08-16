namespace Tims.Application.PlatformDashboard;

// Read models for getAiCostAnomalies (routers/platform/dashboard-upsell.ts:130) — Phase-5 slice 23,
// issue #81, the thirteenth and FINAL read of the platform dashboard cluster. It joins the three
// ai-agent tables (ai_agent_org_configs → ai_agents / organizations, plus a 30-day group-by over
// ai_agent_usage_logs) and classifies each ENABLED agent+org pair into zero or more anomalies.
//
// NOTE this payload carries NO datetime at all — every field is a string, a double or a count — so
// TRAP 6 (NodeIso DateTime serialisation) does not arise here, uniquely in this cluster.

/// <summary>
/// One anomaly row. <c>Type</c> is <c>"zero_usage" | "over_budget"</c> on the wire — the TS union
/// declares a third member, <c>'high_cost'</c>, that NO code path ever produces (dashboard-upsell.ts:162
/// declares it; nothing pushes it). Reproduced as the same absence: the C# kernel emits two literals and
/// no test should ever expect the third.
///
/// <para><c>MonthlyBudget</c> is <c>number | null</c> in TS and the key is ALWAYS written (both anomaly
/// branches copy <c>config.monthlyBudget</c> verbatim), so the null must reach the wire as
/// <c>"monthlyBudget": null</c> — no <c>JsonIgnore</c>, same disposition as
/// <see cref="CustomerHealthSignals.TrialDaysLeft"/>.</para>
/// </summary>
public sealed record AiCostAnomalyItem(
    string Type,
    string AgentName,
    string AgentSlug,
    string OrgName,
    string OrgId,
    string Detail,
    double MonthlyCost,
    double? MonthlyBudget,
    double PotentialSavings);

/// <summary>The whole <c>getAiCostAnomalies</c> payload. The two counts are derived from the SAME list
/// they accompany (<c>anomalies.filter(type === …).length</c>), so they always reconcile with it —
/// unlike <see cref="UpsellOpportunitiesResult"/>, whose confidence counts deliberately do not.</summary>
public sealed record AiCostAnomaliesResult(
    IReadOnlyList<AiCostAnomalyItem> Anomalies,
    double TotalPotentialSavings,
    int ZeroUsageCount,
    int OverBudgetCount);

/// <summary>
/// One ENABLED agent+org configuration — the flattened form of the TS select
/// (<c>agentId, organizationId, monthlyBudget, agent: { id, name, slug, costPerCall, status },
/// organization: { id, name }</c>). The nested <c>agent.id</c>/<c>organization.id</c> duplicate the two
/// FK columns and the TS procedure only ever reads <c>organization.id</c> (as <c>orgId</c>), so the row
/// carries each id once.
///
/// <para><c>AgentStatus</c> is a plain <c>text</c> column (Prisma <c>String @default("stub")</c>), NOT a
/// native Postgres enum — so TRAP 3 (EnableUnmappedTypes) and TRAP 8 (EF.Constant) do not arise for any
/// of the three ai-agent tables. The kernel compares it to the literal <c>"stub"</c> only.</para>
/// </summary>
public sealed record EnabledAgentConfigRow(
    Guid AgentId,
    Guid OrganizationId,
    double? MonthlyBudget,
    string AgentName,
    string AgentSlug,
    double AgentCostPerCall,
    string AgentStatus,
    string OrgName);

/// <summary>
/// One <c>groupBy(['agentId', 'organizationId'])</c> row over the last 30 days of usage.
/// <c>CostSum</c> is nullable because Prisma types <c>_sum.costUsd</c> as <c>number | null</c> and the
/// kernel reproduces the <c>?? 0</c> coalesce — even though a group with zero rows is never returned, so
/// the null arm is dead in both stacks. <c>Calls</c> is <c>_count</c>: the plain row count.
/// </summary>
public sealed record AgentUsageRow(
    Guid AgentId,
    Guid OrganizationId,
    double? CostSum,
    int Calls);
