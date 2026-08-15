using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Application.PlatformDashboard;

// Read models for the THREE FX-DERIVED platform dashboard reads (Phase-5 slice 23, issue #81, PR 3 of 3):
// getDashboardKpis (routers/platform/dashboard.ts:13), getRevenueByCustomer (:200) and getChurnRisk
// (routers/platform/dashboard-churn.ts:9). What separates them from the nine already ported is a single
// call each to `sumMoney` (lib/currency.ts) — on the TS side that resolves a LIVE Frankfurter rate; on this
// side it resolves the DB-pinned `fx_rates` row through FxMoneyConverter. TS IS STILL THE CONTRACT: every
// flag is dark, so these records must match the tRPC payloads key-for-key and byte-for-byte.
//
// WHAT PARITY DOES AND DOES NOT COVER HERE, stated once so no reader assumes more (Federico's call,
// 2026-08-15; recorded in docs/architecture/csharp-migration/phase-5-slice-23-pr3-dashboard-fx.md):
// the parity harness seeds USD-ONLY invoices, so BOTH stacks take the identity path (TS short-circuits
// getFxRate on base == quote and never calls the network; FxRateProvider returns Rate 1.0 without touching
// the DB). That compares every count, every score, every sort order and the whole round-then-sum-then-round
// kernel at rate 1 — but it does NOT and CANNOT compare RATE RESOLUTION, because the two stacks read
// different providers (ECB via Frankfurter live, versus exchangerate-api via the daily pin). Cross-currency
// arithmetic is covered instead by the Testcontainers payload tests, which seed a known pin and assert the
// exact converted wire value.

/// <summary>
/// The whole <c>getDashboardKpis</c> payload — thirteen keys, flat, no envelope.
///
/// <para><c>Mrr</c>/<c>MrrPrevMonth</c> are <see cref="long"/> for the same reason
/// <c>MrrTrendPoint.Mrr</c> is: they are SUMS over every active subscription on the platform, and a JS
/// number carries every integer below 2^53 exactly where <see cref="int"/> would wrap silently.</para>
///
/// <para><c>OutstandingAmount</c> is <see cref="double"/>, not <c>decimal</c> — it comes out of the shared
/// round-then-sum-then-round money kernel, whose rounding rule is JS half-up over IEEE-754 doubles. A
/// decimal round-trip would change the value at exactly the half-cent boundaries the kernel is pinned on.
/// </para>
///
/// <para><c>OutstandingRatesAsOf</c> is <c>string | null</c> in TS — <c>rateDates.sort()[0] ?? null</c>,
/// i.e. the EARLIEST non-identity pin date, and genuinely null whenever every invoice is already in the
/// display currency. The key is always WRITTEN, so it carries no <c>JsonIgnore</c>: superjson renders a
/// written-<c>undefined</c> as <c>null</c> anyway, and omitting the key would be the divergence.</para>
/// </summary>
public sealed record PlatformDashboardKpis(
    int TotalOrgs,
    int TotalOrgsChange,
    int TotalUsers,
    int TotalUsersChange,
    long Mrr,
    long MrrPrevMonth,
    int ActiveTrials,
    int TrialsExpiringThisWeek,
    int OverdueInvoices,
    double OutstandingAmount,
    string Currency,
    bool OutstandingConverted,
    string? OutstandingRatesAsOf);

/// <summary>
/// The non-money inputs <c>getDashboardKpis</c> needs, plus the overdue invoice rows the FX sum folds.
///
/// <para><b><c>ActivePlans</c> and <c>PrevMonthActivePlans</c> are GROUPED COUNTS, not row lists.</b> TS
/// issues <c>findMany({ select: { plan: true } })</c> and reduces in JavaScript, materialising one object
/// per active subscription on the platform. A <c>GROUP BY plan</c> returns at most four rows and sums to
/// the identical number, because <c>Σ PLAN_PRICES[planᵢ]</c> over rows equals
/// <c>Σ count(plan) × PLAN_PRICES[plan]</c> over groups. Same query-shape change, same justification, as
/// <c>PlatformDashboardAccountsRepository</c>'s aggregates — a semantic no-op that keeps a cross-tenant
/// read bounded.</para>
///
/// <para><c>OverdueInvoices</c> CANNOT be aggregated the same way: <c>sumMoney</c> rounds each row to two
/// decimals BEFORE summing, so a SQL <c>SUM(amount)</c> would round once at the end and disagree by cents.
/// The rows are carried individually and folded through the pure kernel.</para>
/// </summary>
public sealed record DashboardKpiInputs(
    int TotalOrgs,
    int NewOrgsThisMonth,
    int TotalUsers,
    int NewUsersThisMonth,
    IReadOnlyList<PlanCount> ActivePlans,
    int ActiveTrials,
    int TrialsExpiringSoon,
    IReadOnlyList<PlanCount> PrevMonthActivePlans,
    IReadOnlyList<DashboardMoneyRow> OverdueInvoices);

/// <summary>A <c>GROUP BY plan</c> row over active subscriptions.</summary>
public sealed record PlanCount(string Plan, int Count);

/// <summary>One <c>{ amount, currency }</c> invoice row on its way into <c>sumMoney</c>. <c>Currency</c> is
/// nullable to mirror the TS row type (<c>string | null | undefined</c>) even though the column is NOT NULL
/// with a <c>'USD'</c> default — the normalization fallback is reproduced rather than assumed away.</summary>
public sealed record DashboardMoneyRow(double Amount, string? Currency);

/// <summary>
/// One <c>getRevenueByCustomer</c> row.
///
/// <para><c>Converted</c> is <c>paidLast30d.converted || outstandingAmount.converted</c> — ONE flag over
/// BOTH sums, so an organization whose paid invoices are all USD but whose outstanding ones are not still
/// reports <c>true</c>. There is no <c>ratesAsOf</c> on this payload at all, unlike the KPI one; the dates
/// are resolved and discarded by the TS procedure.</para>
///
/// <para><c>LastActiveAt</c> is a <c>Date | null</c> on the TS side (the <c>reduce</c> that keeps the
/// latest <c>lastLoginAt</c>, seeded <c>null</c>), so it needs the nullable NodeIso converter — TRAP 6.
/// Without it Npgsql's <see cref="DateTimeKind.Unspecified"/> would serialise with no trailing <c>Z</c>
/// and drop <c>.000</c>, and this endpoint would fail parity on its first row.</para>
/// </summary>
public sealed record RevenueByCustomerRow(
    string OrgId,
    string OrgName,
    string Plan,
    int Mrr,
    double PaidLast30d,
    double OutstandingAmount,
    string Currency,
    bool Converted,
    int UserCount,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? LastActiveAt);

/// <summary>
/// The per-organization inputs <c>getRevenueByCustomer</c> shapes.
///
/// <para>The two invoice buckets are carried as separate row lists because the TS procedure filters the
/// same <c>org.invoices</c> array twice and calls <c>sumMoney</c> on each — <c>paid</c> AND
/// <c>paidAt &gt;= 30d ago</c> for one, <c>pending OR draft</c> for the other. A <c>void</c> invoice, and a
/// <c>paid</c> one older than thirty days, land in NEITHER bucket.</para>
/// </summary>
public sealed record RevenueOrgRow(
    string OrgId,
    string OrgName,
    string? SubscriptionPlan,
    string? SubscriptionStatus,
    IReadOnlyList<DashboardMoneyRow> PaidLast30d,
    IReadOnlyList<DashboardMoneyRow> Outstanding,
    int UserCount,
    DateTime? LastActiveAt);

/// <summary><c>getChurnRisk</c>'s <c>signals</c> object — the five component scores that sum to
/// <c>healthScore</c>. Emitted alongside the total, so a caller can see WHY an organization scored what it
/// did.</summary>
public sealed record ChurnRiskSignals(
    int LoginScore,
    int InvoiceScore,
    int RecencyScore,
    int AdoptionScore,
    int TenureScore);

/// <summary>
/// One <c>getChurnRisk</c> organization row.
///
/// <para><c>DaysSinceLastLogin</c> is <c>daysSinceLastLogin === 999 ? null : daysSinceLastLogin</c> — the
/// never-logged-in SENTINEL is scored as 999 (landing in the worst recency band) but reported as
/// <c>null</c>. Note the collapse this creates: an organization whose last login really was 999 days ago
/// also reports <c>null</c>. Reproduced, not corrected.</para>
///
/// <para><c>OverdueAmount</c> is the converted total and <c>OverdueAmountConverted</c> its flag; there is
/// no <c>ratesAsOf</c> key on this payload. <c>Risks</c> and <c>Actions</c> are parallel arrays built in
/// the same order, and <c>PrimaryRisk</c> is <c>risks[0] ?? 'Healthy'</c> — the FIRST matched reason, not
/// the most severe.</para>
/// </summary>
public sealed record ChurnRiskOrganization(
    string OrgId,
    string OrgName,
    string Plan,
    int Mrr,
    int HealthScore,
    string Tier,
    int TotalUsers,
    int LoginRate,
    int? DaysSinceLastLogin,
    int OverdueInvoices,
    double OverdueAmount,
    string Currency,
    bool OverdueAmountConverted,
    int FeatureCount,
    string PrimaryRisk,
    IReadOnlyList<string> Risks,
    IReadOnlyList<string> Actions,
    ChurnRiskSignals Signals);

/// <summary><c>getChurnRisk</c>'s summary block. <c>AtRiskMrr</c> sums the MRR of the <c>red</c> tier only,
/// and is <see cref="long"/> for the same overflow reason as the KPI sums.</summary>
public sealed record ChurnRiskSummary(int Green, int Yellow, int Red, int Total, long AtRiskMrr);

/// <summary>The whole <c>getChurnRisk</c> payload — <c>{ organizations, summary }</c>.</summary>
public sealed record ChurnRiskResult(
    IReadOnlyList<ChurnRiskOrganization> Organizations,
    ChurnRiskSummary Summary);

/// <summary>
/// The per-organization inputs <c>getChurnRisk</c> scores.
///
/// <para><c>OverdueInvoices</c> is carried as ROWS rather than a count because the procedure needs both:
/// <c>org.invoices.length</c> feeds the invoice-health band, and the same rows feed <c>sumMoney</c>.
/// Deriving the count from the row list keeps the two from ever disagreeing.</para>
///
/// <para><c>CreatedAt</c> is the ORGANIZATION's creation instant, which is the tenure signal — the only
/// place in the whole dashboard cluster where an organization's age is scored rather than displayed.</para>
/// </summary>
public sealed record ChurnOrgRow(
    string OrgId,
    string OrgName,
    DateTime CreatedAt,
    string? SubscriptionPlan,
    string? SubscriptionStatus,
    DateTime? TrialEndsAt,
    IReadOnlyList<DashboardMoneyRow> OverdueInvoices,
    int ActiveUsers,
    int RecentLogins,
    DateTime? LastLoginAt,
    int FeatureCount);

/// <summary>
/// Whether an FX-derived read produced a payload or hit an unresolvable rate.
///
/// <para><b><c>FxUnavailable</c> is a 503, never a best-effort payload.</b> That is the point of the kind:
/// TS's <c>getFxRate</c> THROWS (<c>fx_rate_unavailable:BASE:QUOTE:status</c>) when it cannot resolve a
/// rate, so the tRPC procedure fails the whole request — it never emits a partially-converted total. The
/// C# FX plane is otherwise FAIL-SOFT (a missing pin returns <c>null</c> and the caller SUPPRESSES the
/// field), and that disposition is right for a k-anonymised DEI rollup where the surrounding payload still
/// means something. It is wrong here: <c>outstandingAmount</c>, <c>paidLast30d</c> and <c>overdueAmount</c>
/// are non-nullable numbers on the TS wire, so suppressing one would require a response SHAPE that TS has
/// no way to produce. Federico's call, 2026-08-15. The precedent is
/// <c>SimulateAdjustmentResultKind.FxUnavailable</c>, which draws the same line for a REQUIRED cross-rate.
/// </para>
/// </summary>
public enum PlatformDashboardFxResultKind
{
    Ok,
    FxUnavailable,
}

/// <summary>An FX-derived read's outcome. <c>Value</c> is non-null exactly when
/// <c>Kind == <see cref="PlatformDashboardFxResultKind.Ok"/></c>.</summary>
public sealed record PlatformDashboardFxResult<T>(PlatformDashboardFxResultKind Kind, T? Value)
    where T : class
{
    public static PlatformDashboardFxResult<T> Ok(T value) => new(PlatformDashboardFxResultKind.Ok, value);

    public static PlatformDashboardFxResult<T> FxUnavailable() => new(PlatformDashboardFxResultKind.FxUnavailable, null);
}
