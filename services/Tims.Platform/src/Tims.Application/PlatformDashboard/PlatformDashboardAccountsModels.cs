namespace Tims.Application.PlatformDashboard;

// Read models for getCustomerHealth (routers/platform/dashboard.ts:268) and getUpsellOpportunities
// (routers/platform/dashboard-upsell.ts:31) — Phase-5 slice 23, issue #81, PR 2 of 3. Both are per-
// organization roll-ups over organizations + subscriptions + users, which is why they share a repository.
//
// NOTE getCustomerHealth is FX-FREE and getChurnRisk is not; an earlier version of the split had the two
// swapped. getCustomerHealth counts users and invoices and does no currency arithmetic at all; churn
// awaits sumMoney at dashboard-churn.ts:55 and ports in PR 3.

/// <summary>
/// <c>getCustomerHealth</c>'s <c>signals</c> object. <c>TrialDaysLeft</c> is <c>number | null</c> in TS —
/// declared as <c>let trialDaysLeft: number | null = null</c> and assigned only for a TRIALING
/// subscription that also has a <c>trial_ends_at</c> — so the key is ALWAYS present and the value is
/// genuinely null the rest of the time. It therefore carries no <c>JsonIgnore</c>: omitting it would be
/// the divergence.
/// </summary>
public sealed record CustomerHealthSignals(int LoginRate, int OverdueInvoices, int? TrialDaysLeft, int DaysSinceLastLogin);

/// <summary>One <c>getCustomerHealth</c> row — <c>{ orgId, orgName, plan, health, signals }</c> where
/// <c>health</c> is <c>"healthy" | "at_risk" | "critical"</c>.</summary>
public sealed record CustomerHealthItem(string OrgId, string OrgName, string Plan, string Health, CustomerHealthSignals Signals);

/// <summary>
/// The per-organization inputs <c>getCustomerHealth</c> derives its signals from.
///
/// <para>TS fetches the raw <c>users</c> rows and reduces them in JavaScript; this row carries the three
/// reductions instead (<c>ActiveUsers</c>, <c>RecentLogins</c>, <c>LastLoginAt</c>), computed by the same
/// predicates in SQL. The values are identical — a COUNT over <c>last_login_at &gt;= sevenDaysAgo</c> is
/// the same set as the JS <c>filter</c>, and both sides compare millisecond-resolution instants — and it
/// keeps a platform-wide read from materialising every active user of every tenant.</para>
///
/// <para><c>SubscriptionPlan</c>/<c>SubscriptionStatus</c>/<c>TrialEndsAt</c> are nullable because
/// <c>subscription</c> is an optional relation: an organization with no subscription row yields
/// <c>undefined</c> for all three, which the kernel turns into plan <c>"trial"</c> and no trial countdown.
/// </para>
/// </summary>
public sealed record CustomerHealthOrgRow(
    string OrgId,
    string OrgName,
    string? SubscriptionPlan,
    string? SubscriptionStatus,
    DateTime? TrialEndsAt,
    int OverdueInvoices,
    int ActiveUsers,
    int RecentLogins,
    DateTime? LastLoginAt);

/// <summary><c>getUpsellOpportunities</c>' <c>signals</c> object.</summary>
public sealed record UpsellSignals(int ActiveUsers, int TotalUsers, int Features, int Vacancies);

/// <summary>One upsell opportunity. <c>Reason</c> is <c>reasons[0]</c> — the FIRST matched reason only,
/// not the joined list; the others are computed and discarded by the TS procedure.</summary>
public sealed record UpsellOpportunity(
    string OrgId,
    string OrgName,
    string CurrentPlan,
    string TargetPlan,
    int MrrIncrease,
    string Reason,
    UpsellSignals Signals,
    string Confidence);

/// <summary>The whole <c>getUpsellOpportunities</c> payload. <c>LowConfidence</c> is deliberately ABSENT:
/// TS counts only high and medium even though <c>'low'</c> is a reachable confidence (a score of exactly
/// 40), so the totals do not reconcile with <c>opportunities.length</c>. Reproduced.</summary>
public sealed record UpsellOpportunitiesResult(
    IReadOnlyList<UpsellOpportunity> Opportunities,
    long TotalPotentialMrr,
    int HighConfidence,
    int MediumConfidence);

/// <summary>
/// The per-organization inputs <c>getUpsellOpportunities</c> scores.
///
/// <para><b><c>TotalUsers</c>, <c>Features</c> and <c>Vacancies</c> come from Prisma <c>_count</c>, which
/// counts EVERY related row</b> — inactive users, soft-deleted users, disabled feature flags and closed
/// vacancies all included. Only <c>ActiveRecentUsers</c> is filtered (<c>isActive</c> AND
/// <c>lastLoginAt &gt;= now-7d</c>), because that one is a sibling <c>users</c> selection with its own
/// <c>where</c> rather than part of the <c>_count</c>. The asymmetry is real and is reproduced: the same
/// organization contributes a different number to <c>totalUsers</c> and <c>activeUsers</c> for two
/// different reasons.</para>
///
/// <para><c>OrgPlan</c> is <c>organizations.plan</c>, the fallback in <c>subscription?.plan ?? org.plan ??
/// 'trial'</c>. The column is NOT NULL, so the second <c>??</c> is dead — reproduced anyway.</para>
/// </summary>
public sealed record UpsellOrgRow(
    string OrgId,
    string OrgName,
    string OrgPlan,
    string? SubscriptionPlan,
    string? SubscriptionStatus,
    int TotalUsers,
    int ActiveRecentUsers,
    int Features,
    int Vacancies);
