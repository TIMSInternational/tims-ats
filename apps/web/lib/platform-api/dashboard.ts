'use client';

// Platform dashboard FE data layer — Phase-5 slice 23 step 4 (issue #81), DARK.
//
// Every hook below returns the tRPC path UNLESS both of these are true:
//   1. NEXT_PUBLIC_TIMS_PLATFORM_API_URL is set (`isPlatformApiEnabled()`), and
//   2. NEXT_PUBLIC_DASHBOARD_READ_VIA_CSHARP === 'true'.
//
// The flag is UNSET everywhere today, so this file changes nothing in production: the flat
// `trpc.platform.*` dashboard procedures remain the single active reader. It exists so the cutover
// is a deploy env-var flip rather than a code change — the same dual-path shape monitoring still
// has today. (NOT billing/dei: an earlier draft cited all three, but those two have since gone
// C#-only — their TS fallbacks are deleted and dei's flag is dead. The panel counted the set.)
// The C# side is the thirteen `/platform/dashboard/*` endpoints behind
// Platform:PlatformDashboardReadEnabled (also dark), so a real cutover needs BOTH flags.
//
// TWELVE hooks for THIRTEEN ported reads, deliberately. `getUserGrowth` has ZERO consumers in
// apps/web (no user-growth chart exists), so a `useDashboardUserGrowth` hook would ship as an
// orphan — the exact defect class tests/platform/dashboard-fe-wiring.test.ts exists to catch
// ("a hook with no callers still compiles, still type-checks, and still has passing unit tests").
// The wiring test pins the exception by name; its raw-tRPC scan still covers all thirteen reads,
// so a future user-growth consumer is forced through a new hook here on the day it is written.
//
// `platformGetRaw`, NOT `platformGet`: every dashboard endpoint declares an untyped
// `.Produces(StatusCodes.Status200OK)` (no `<T>`), so the OpenAPI contract types the 200 with
// `content?: never` and the typed `GetPaths` union cannot accept these paths. That means the path
// strings below are NOT compile-checked — a typo'd path would compile and 404 at runtime — so the
// wiring test cross-checks every path literal against contracts/openapi/Tims.Api.json.
//
// NO invalidation helper, deliberately. This cluster is read-only: no dashboard write was ported,
// and no `utils.platform.*.invalidate()` call in apps/web targets any of the thirteen dashboard
// reads (35 such calls exist — all for OTHER platform procedures) — so there is no mutation whose
// onSuccess would need to reach the ['platform-api', 'dashboard'] cache family.
// (Contrast monitoring.ts, which needed one because configureAlertRules stayed a tRPC write.)
//
// ⚠️ Null-preserving numerics — `Number(null) === 0`, and for all three of these a fabricated 0
// is not just wrong but INVERTED:
//   - churn-risk `daysSinceLastLogin`: null means "no login EVER" (TS maps its 999 sentinel to
//     null at the wire); 0 means "logged in today" — the opposite end of the risk scale.
//   - customer-health `signals.trialDaysLeft`: null means "not on a trial"; 0 means "trial
//     expires today", which would light the at_risk branch for every non-trial org.
//   - ai-cost-anomalies `monthlyBudget`: null means "no budget configured"; 0 is a real budget —
//     and the TS anomaly rule treats them differently (`config.monthlyBudget && cost > budget`),
//     so collapsing null to 0 misrepresents which orgs CAN go over budget.
// customer-health `signals.daysSinceLastLogin` is NOT in this list: the TS procedure keeps the
// raw 999 no-login sentinel there (only churn-risk maps it to null), and this file reproduces
// each procedure's behavior exactly — reproduce, don't improve.

import { useQuery } from '@tanstack/react-query';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGetRaw } from './client';

const DASHBOARD_READ_VIA_CSHARP = process.env.NEXT_PUBLIC_DASHBOARD_READ_VIA_CSHARP === 'true';

function viaCSharp(): boolean {
  return isPlatformApiEnabled() && DASHBOARD_READ_VIA_CSHARP;
}

/**
 * Null-preserving numeric coercion — see the inversion warning above. Exported so the invariant
 * "a null wire value never becomes 0" is directly testable rather than only argued in a comment.
 */
export function numberOrNull(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Optional-key numeric coercion. The tRPC client restores a written-`undefined` back to
 * `undefined` (superjson meta), while the C# wire emits `null` for it — and omits keys the TS
 * literal never wrote. Both must land as `undefined` so the two paths are indistinguishable.
 */
export function numberOrUndefined(value: number | string | null | undefined): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

/**
 * Date reconstruction. The C# contract emits ISO strings (NodeIsoDateTimeConverter), while the
 * tRPC path returns a real `Date` via superjson. Only TWO of the thirteen dashboard wires carry a
 * Date-typed field — recent-activity `timestamp` and revenue-by-customer `lastActiveAt`. (The one
 * near-miss: kpis' `outstandingRatesAsOf` is date-VALUED but string-TYPED on both paths —
 * `sumMoney` returns it as `string | null` — so it is deliberately passed through, never
 * reconstructed.) Shape copied from monitoring.ts:49.
 */
export const toDate = (v: unknown): Date => new Date(v as string);
export const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

// ── Wire shapes ───────────────────────────────────────────────────────────────────────────────
// Field-for-field identical to the tRPC outputs. Literal unions match the tRPC inferred types so
// a consumer seeing the union of both paths' data types can index/narrow exactly as before.

// Matches the tRPC-side Prisma `OrgPlan` enum. The C# records type `plan` as a plain string, so
// this narrowing is a claim about the DATABASE (the column is the native "OrgPlan" enum, which
// constrains every value both stacks can read), not about the C# wire's own type.
type OrgPlanName = 'trial' | 'starter' | 'professional' | 'enterprise';

export interface DashboardKpis {
  totalOrgs: number;
  totalOrgsChange: number;
  totalUsers: number;
  totalUsersChange: number;
  mrr: number;
  mrrPrevMonth: number;
  activeTrials: number;
  trialsExpiringThisWeek: number;
  overdueInvoices: number;
  outstandingAmount: number;
  currency: string;
  outstandingConverted: boolean;
  outstandingRatesAsOf: string | null;
}

export interface AttentionItem {
  id: string;
  type: 'overdue_invoice' | 'expiring_trial' | 'failed_payment' | 'pending_invitation' | 'suspended_org';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  orgId?: string;
  orgName?: string;
  actionUrl: string;
  actionLabel: string;
  amount?: number;
  currency?: string;
  daysUntil?: number;
}

export interface RevenueByCustomerRow {
  orgId: string;
  orgName: string;
  plan: OrgPlanName;
  mrr: number;
  paidLast30d: number;
  outstandingAmount: number;
  currency: string;
  converted: boolean;
  userCount: number;
  lastActiveAt: Date | null;
}

export interface CustomerHealthRow {
  orgId: string;
  orgName: string;
  plan: OrgPlanName;
  health: 'healthy' | 'at_risk' | 'critical';
  signals: {
    loginRate: number;
    overdueInvoices: number;
    trialDaysLeft: number | null;
    daysSinceLastLogin: number;
  };
}

export interface RecentActivityItem {
  id: string;
  type: string;
  title: string;
  timestamp: Date;
  meta?: string;
}

export interface PlanDistributionRow {
  plan: string;
  count: number;
  percentage: number;
}

export interface SearchResults {
  organizations: { id: string; name: string; slug: string; plan: OrgPlanName; isActive: boolean }[];
  users: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    isPlatformOwner: boolean;
    isActive: boolean;
    avatar: string | null;
    organization: { name: string } | null;
  }[];
  pages: { name: string; href: string; keywords: string }[];
}

export interface MrrTrendPoint {
  month: string;
  mrr: number;
}

export interface ChurnRiskOrg {
  orgId: string;
  orgName: string;
  plan: OrgPlanName;
  mrr: number;
  healthScore: number;
  tier: 'green' | 'yellow' | 'red';
  totalUsers: number;
  loginRate: number;
  daysSinceLastLogin: number | null;
  overdueInvoices: number;
  overdueAmount: number;
  currency: string;
  overdueAmountConverted: boolean;
  featureCount: number;
  primaryRisk: string;
  risks: string[];
  actions: string[];
  signals: {
    loginScore: number;
    invoiceScore: number;
    recencyScore: number;
    adoptionScore: number;
    tenureScore: number;
  };
}

export interface ChurnRisk {
  organizations: ChurnRiskOrg[];
  summary: { green: number; yellow: number; red: number; total: number; atRiskMrr: number };
}

export interface MrrForecast {
  historical: { month: string; mrr: number; type: 'historical' }[];
  projected: { month: string; mrr: number; type: 'projected' }[];
  currentMrr: number;
  projectedMrr12m: number;
  projectedArr: number;
  monthlyGrowthPct: number;
  planBreakdown: Record<string, { count: number; mrr: number }>;
  pendingTrials: number;
  potentialMrrFromTrials: number;
}

export interface UpsellOpportunity {
  orgId: string;
  orgName: string;
  currentPlan: string;
  targetPlan: string;
  mrrIncrease: number;
  reason: string;
  signals: { activeUsers: number; totalUsers: number; features: number; vacancies: number };
  confidence: 'high' | 'medium' | 'low';
}

export interface UpsellOpportunities {
  opportunities: UpsellOpportunity[];
  totalPotentialMrr: number;
  highConfidence: number;
  mediumConfidence: number;
}

export interface AiCostAnomaly {
  type: 'zero_usage' | 'over_budget' | 'high_cost';
  agentName: string;
  agentSlug: string;
  orgName: string;
  orgId: string;
  detail: string;
  monthlyCost: number;
  monthlyBudget: number | null;
  potentialSavings: number;
}

export interface AiCostAnomalies {
  anomalies: AiCostAnomaly[];
  totalPotentialSavings: number;
  zeroUsageCount: number;
  overBudgetCount: number;
}

// ── Row mappers ───────────────────────────────────────────────────────────────────────────────
// Exported for the same reason monitoring's are: an invariant argued only in a comment is not
// enforced, and the hooks' inline mapping is unreachable from a unit test. Numeric wire fields
// are typed `number | string` (the contract convention for the C# minimal API), which also makes
// tsc reject a hook that skips its mapper — `number | string` does not widen into `number`.

export function mapDashboardKpis(raw: {
  totalOrgs: number | string;
  totalOrgsChange: number | string;
  totalUsers: number | string;
  totalUsersChange: number | string;
  mrr: number | string;
  mrrPrevMonth: number | string;
  activeTrials: number | string;
  trialsExpiringThisWeek: number | string;
  overdueInvoices: number | string;
  outstandingAmount: number | string;
  currency: string;
  outstandingConverted: boolean;
  outstandingRatesAsOf: string | null;
}): DashboardKpis {
  return {
    totalOrgs: Number(raw.totalOrgs),
    totalOrgsChange: Number(raw.totalOrgsChange),
    totalUsers: Number(raw.totalUsers),
    totalUsersChange: Number(raw.totalUsersChange),
    mrr: Number(raw.mrr),
    mrrPrevMonth: Number(raw.mrrPrevMonth),
    activeTrials: Number(raw.activeTrials),
    trialsExpiringThisWeek: Number(raw.trialsExpiringThisWeek),
    overdueInvoices: Number(raw.overdueInvoices),
    outstandingAmount: Number(raw.outstandingAmount),
    currency: raw.currency,
    outstandingConverted: raw.outstandingConverted,
    // A string | null passthrough, NOT a date reconstruction: the tRPC path also serves a string
    // here (fx `ratesAsOf`), so turning it into a Date would DIVERGE from the TS shape.
    outstandingRatesAsOf: raw.outstandingRatesAsOf ?? null,
  };
}

export function mapAttentionItem(raw: {
  id: string;
  type: AttentionItem['type'];
  severity: AttentionItem['severity'];
  title: string;
  description: string;
  orgId?: string | null;
  orgName?: string | null;
  actionUrl: string;
  actionLabel: string;
  amount?: number | string | null;
  currency?: string | null;
  daysUntil?: number | string | null;
}): AttentionItem {
  return {
    id: raw.id,
    type: raw.type,
    severity: raw.severity,
    title: raw.title,
    description: raw.description,
    // `?? undefined`, not passthrough: C# emits null for a written-undefined key (the TS literal
    // writes `orgId: inv.organization?.id`), while superjson hands the tRPC consumer `undefined`.
    orgId: raw.orgId ?? undefined,
    orgName: raw.orgName ?? undefined,
    actionUrl: raw.actionUrl,
    actionLabel: raw.actionLabel,
    amount: numberOrUndefined(raw.amount),
    currency: raw.currency ?? undefined,
    daysUntil: numberOrUndefined(raw.daysUntil),
  };
}

export function mapRevenueByCustomerRow(raw: {
  orgId: string;
  orgName: string;
  plan: OrgPlanName;
  mrr: number | string;
  paidLast30d: number | string;
  outstandingAmount: number | string;
  currency: string;
  converted: boolean;
  userCount: number | string;
  lastActiveAt?: string | null;
}): RevenueByCustomerRow {
  return {
    orgId: raw.orgId,
    orgName: raw.orgName,
    plan: raw.plan,
    mrr: Number(raw.mrr),
    paidLast30d: Number(raw.paidLast30d),
    outstandingAmount: Number(raw.outstandingAmount),
    currency: raw.currency,
    converted: raw.converted,
    userCount: Number(raw.userCount),
    // toDateOrNull, NOT toDate: `new Date(null)` is epoch 1970, which would render every
    // never-logged-in org as "last active 56 years ago" instead of blank.
    lastActiveAt: toDateOrNull(raw.lastActiveAt),
  };
}

export function mapCustomerHealthRow(raw: {
  orgId: string;
  orgName: string;
  plan: OrgPlanName;
  health: CustomerHealthRow['health'];
  signals: {
    loginRate: number | string;
    overdueInvoices: number | string;
    trialDaysLeft: number | string | null;
    daysSinceLastLogin: number | string;
  };
}): CustomerHealthRow {
  return {
    orgId: raw.orgId,
    orgName: raw.orgName,
    plan: raw.plan,
    health: raw.health,
    signals: {
      loginRate: Number(raw.signals.loginRate),
      overdueInvoices: Number(raw.signals.overdueInvoices),
      // numberOrNull, NOT Number: null means "not on a trial"; 0 means "trial expires TODAY".
      trialDaysLeft: numberOrNull(raw.signals.trialDaysLeft),
      // Number, faithfully: the TS procedure keeps the 999 no-login sentinel on THIS wire
      // (only churn-risk maps it to null). Reproduce, don't improve.
      daysSinceLastLogin: Number(raw.signals.daysSinceLastLogin),
    },
  };
}

export function mapRecentActivityItem(raw: {
  id: string;
  type: string;
  title: string;
  timestamp: string;
  meta?: string | null;
}): RecentActivityItem {
  return {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    timestamp: toDate(raw.timestamp),
    // The one optional key on this wire: absent for org rows' plan-less events is impossible
    // (org rows always write meta), but user rows write `meta: user.email` and the C# converter
    // mirrors the TS literal's key set — normalize null and absent both to undefined.
    meta: raw.meta ?? undefined,
  };
}

export function mapPlanDistributionRow(raw: {
  plan: string;
  count: number | string;
  percentage: number | string;
}): PlanDistributionRow {
  return { plan: raw.plan, count: Number(raw.count), percentage: Number(raw.percentage) };
}

export function mapSearchResults(raw: {
  organizations: { id: string; name: string; slug: string; plan: OrgPlanName; isActive: boolean }[];
  users: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    isPlatformOwner: boolean;
    isActive: boolean;
    avatar?: string | null;
    organization?: { name: string } | null;
  }[];
  pages: { name: string; href: string; keywords: string }[];
}): SearchResults {
  return {
    organizations: raw.organizations.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      plan: o.plan,
      isActive: o.isActive,
    })),
    users: raw.users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      isPlatformOwner: u.isPlatformOwner,
      isActive: u.isActive,
      // string | null on the tRPC side (nullable column / org-less platform owner) — keep null,
      // these are NOT the optional-key case.
      avatar: u.avatar ?? null,
      organization: u.organization ? { name: u.organization.name } : null,
    })),
    pages: raw.pages.map((p) => ({ name: p.name, href: p.href, keywords: p.keywords })),
  };
}

export function mapMrrTrendPoint(raw: { month: string; mrr: number | string }): MrrTrendPoint {
  return { month: raw.month, mrr: Number(raw.mrr) };
}

export function mapChurnRiskOrg(raw: {
  orgId: string;
  orgName: string;
  plan: OrgPlanName;
  mrr: number | string;
  healthScore: number | string;
  tier: ChurnRiskOrg['tier'];
  totalUsers: number | string;
  loginRate: number | string;
  daysSinceLastLogin: number | string | null;
  overdueInvoices: number | string;
  overdueAmount: number | string;
  currency: string;
  overdueAmountConverted: boolean;
  featureCount: number | string;
  primaryRisk: string;
  risks: string[];
  actions: string[];
  signals: {
    loginScore: number | string;
    invoiceScore: number | string;
    recencyScore: number | string;
    adoptionScore: number | string;
    tenureScore: number | string;
  };
}): ChurnRiskOrg {
  return {
    orgId: raw.orgId,
    orgName: raw.orgName,
    plan: raw.plan,
    mrr: Number(raw.mrr),
    healthScore: Number(raw.healthScore),
    tier: raw.tier,
    totalUsers: Number(raw.totalUsers),
    loginRate: Number(raw.loginRate),
    // numberOrNull, NOT Number: null means "no login EVER"; 0 means "logged in TODAY" — a bare
    // Number() would move an org from one end of the risk scale to the other.
    daysSinceLastLogin: numberOrNull(raw.daysSinceLastLogin),
    overdueInvoices: Number(raw.overdueInvoices),
    overdueAmount: Number(raw.overdueAmount),
    currency: raw.currency,
    overdueAmountConverted: raw.overdueAmountConverted,
    featureCount: Number(raw.featureCount),
    primaryRisk: raw.primaryRisk,
    risks: raw.risks,
    actions: raw.actions,
    signals: {
      loginScore: Number(raw.signals.loginScore),
      invoiceScore: Number(raw.signals.invoiceScore),
      recencyScore: Number(raw.signals.recencyScore),
      adoptionScore: Number(raw.signals.adoptionScore),
      tenureScore: Number(raw.signals.tenureScore),
    },
  };
}

/**
 * Whole-payload churn mapper, extracted so the SUMMARY coercions are testable. The panel found the
 * summary block living inline in the hook's queryFn — reachable by neither the coercion test (which
 * imports mappers) nor tsc (the raw comes off an `as` cast) — so `total: Number(raw.summary.red)`
 * would have compiled and passed the whole suite. "Unreachable from a unit test" is an argument for
 * extracting the mapping, not for leaving it inline.
 */
export function mapChurnRisk(raw: {
  organizations: Parameters<typeof mapChurnRiskOrg>[0][];
  summary: {
    green: number | string;
    yellow: number | string;
    red: number | string;
    total: number | string;
    atRiskMrr: number | string;
  };
}): ChurnRisk {
  return {
    organizations: raw.organizations.map(mapChurnRiskOrg),
    summary: {
      green: Number(raw.summary.green),
      yellow: Number(raw.summary.yellow),
      red: Number(raw.summary.red),
      total: Number(raw.summary.total),
      atRiskMrr: Number(raw.summary.atRiskMrr),
    },
  };
}

export function mapMrrForecast(raw: {
  historical: { month: string; mrr: number | string; type: 'historical' }[];
  projected: { month: string; mrr: number | string; type: 'projected' }[];
  currentMrr: number | string;
  projectedMrr12m: number | string;
  projectedArr: number | string;
  monthlyGrowthPct: number | string;
  planBreakdown: Record<string, { count: number | string; mrr: number | string }>;
  pendingTrials: number | string;
  potentialMrrFromTrials: number | string;
}): MrrForecast {
  return {
    historical: raw.historical.map((h) => ({ month: h.month, mrr: Number(h.mrr), type: h.type })),
    projected: raw.projected.map((p) => ({ month: p.month, mrr: Number(p.mrr), type: p.type })),
    currentMrr: Number(raw.currentMrr),
    projectedMrr12m: Number(raw.projectedMrr12m),
    projectedArr: Number(raw.projectedArr),
    monthlyGrowthPct: Number(raw.monthlyGrowthPct),
    planBreakdown: Object.fromEntries(
      Object.entries(raw.planBreakdown).map(([plan, v]) => [plan, { count: Number(v.count), mrr: Number(v.mrr) }]),
    ),
    pendingTrials: Number(raw.pendingTrials),
    potentialMrrFromTrials: Number(raw.potentialMrrFromTrials),
  };
}

export function mapUpsellOpportunities(raw: {
  opportunities: {
    orgId: string;
    orgName: string;
    currentPlan: string;
    targetPlan: string;
    mrrIncrease: number | string;
    reason: string;
    signals: {
      activeUsers: number | string;
      totalUsers: number | string;
      features: number | string;
      vacancies: number | string;
    };
    confidence: UpsellOpportunity['confidence'];
  }[];
  totalPotentialMrr: number | string;
  highConfidence: number | string;
  mediumConfidence: number | string;
}): UpsellOpportunities {
  return {
    opportunities: raw.opportunities.map((o) => ({
      orgId: o.orgId,
      orgName: o.orgName,
      currentPlan: o.currentPlan,
      targetPlan: o.targetPlan,
      mrrIncrease: Number(o.mrrIncrease),
      reason: o.reason,
      signals: {
        activeUsers: Number(o.signals.activeUsers),
        totalUsers: Number(o.signals.totalUsers),
        features: Number(o.signals.features),
        vacancies: Number(o.signals.vacancies),
      },
      confidence: o.confidence,
    })),
    totalPotentialMrr: Number(raw.totalPotentialMrr),
    highConfidence: Number(raw.highConfidence),
    mediumConfidence: Number(raw.mediumConfidence),
  };
}

export function mapAiCostAnomalies(raw: {
  anomalies: {
    type: AiCostAnomaly['type'];
    agentName: string;
    agentSlug: string;
    orgName: string;
    orgId: string;
    detail: string;
    monthlyCost: number | string;
    monthlyBudget: number | string | null;
    potentialSavings: number | string;
  }[];
  totalPotentialSavings: number | string;
  zeroUsageCount: number | string;
  overBudgetCount: number | string;
}): AiCostAnomalies {
  return {
    anomalies: raw.anomalies.map((a) => ({
      type: a.type,
      agentName: a.agentName,
      agentSlug: a.agentSlug,
      orgName: a.orgName,
      orgId: a.orgId,
      detail: a.detail,
      monthlyCost: Number(a.monthlyCost),
      // numberOrNull, NOT Number: null means "no budget configured", 0 is a real budget, and the
      // anomaly rule (`monthlyBudget && cost > monthlyBudget`) treats those differently.
      monthlyBudget: numberOrNull(a.monthlyBudget),
      potentialSavings: Number(a.potentialSavings),
    })),
    totalPotentialSavings: Number(raw.totalPotentialSavings),
    zeroUsageCount: Number(raw.zeroUsageCount),
    overBudgetCount: Number(raw.overBudgetCount),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────────────────────
// Each calls BOTH paths' hooks unconditionally (React rules of hooks) and returns the selected
// one; the unselected query is `enabled: false` so it never fires a request.

/** KPI tiles. GET /platform/dashboard/kpis. */
export function useDashboardKpis() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getDashboardKpis.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<DashboardKpis>({
    queryKey: ['platform-api', 'dashboard', 'kpis'],
    queryFn: async () =>
      mapDashboardKpis((await platformGetRaw('/platform/dashboard/kpis')) as Parameters<typeof mapDashboardKpis>[0]),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Needs-attention banner items. GET /platform/dashboard/attention-items. */
export function useDashboardAttentionItems() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getAttentionItems.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<AttentionItem[]>({
    queryKey: ['platform-api', 'dashboard', 'attention-items'],
    queryFn: async () =>
      ((await platformGetRaw('/platform/dashboard/attention-items')) as Parameters<typeof mapAttentionItem>[0][]).map(
        mapAttentionItem,
      ),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Per-org revenue table rows. GET /platform/dashboard/revenue-by-customer. */
export function useDashboardRevenueByCustomer() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getRevenueByCustomer.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<RevenueByCustomerRow[]>({
    queryKey: ['platform-api', 'dashboard', 'revenue-by-customer'],
    queryFn: async () =>
      (
        (await platformGetRaw('/platform/dashboard/revenue-by-customer')) as Parameters<
          typeof mapRevenueByCustomerRow
        >[0][]
      ).map(mapRevenueByCustomerRow),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Health grid rows. GET /platform/dashboard/customer-health. */
export function useDashboardCustomerHealth() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getCustomerHealth.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<CustomerHealthRow[]>({
    queryKey: ['platform-api', 'dashboard', 'customer-health'],
    queryFn: async () =>
      (
        (await platformGetRaw('/platform/dashboard/customer-health')) as Parameters<typeof mapCustomerHealthRow>[0][]
      ).map(mapCustomerHealthRow),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Recent orgs + users feed. GET /platform/dashboard/recent-activity. */
export function useDashboardRecentActivity() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getRecentActivity.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<RecentActivityItem[]>({
    queryKey: ['platform-api', 'dashboard', 'recent-activity'],
    queryFn: async () =>
      (
        (await platformGetRaw('/platform/dashboard/recent-activity')) as Parameters<typeof mapRecentActivityItem>[0][]
      ).map(mapRecentActivityItem),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Plan distribution donut. GET /platform/dashboard/plan-distribution. */
export function useDashboardPlanDistribution() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getPlanDistribution.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<PlanDistributionRow[]>({
    queryKey: ['platform-api', 'dashboard', 'plan-distribution'],
    queryFn: async () =>
      (
        (await platformGetRaw('/platform/dashboard/plan-distribution')) as Parameters<
          typeof mapPlanDistributionRow
        >[0][]
      ).map(mapPlanDistributionRow),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/**
 * Global ⌘K search. GET /platform/dashboard/search?query=…
 * The one input-bearing read; the caller gates firing (debounce + focus), so the hook accepts
 * `opts.enabled` and BOTH paths AND it with the flag branch.
 */
export function useDashboardSearch(input: { query: string }, opts?: { enabled?: boolean }) {
  const enabled = viaCSharp();
  const callerEnabled = opts?.enabled ?? true;
  const trpcQuery = trpc.platform.search.useQuery(input, { enabled: !enabled && callerEnabled });
  const csharpQuery = useQuery<SearchResults>({
    queryKey: ['platform-api', 'dashboard', 'search', input.query],
    queryFn: async () =>
      mapSearchResults(
        (await platformGetRaw('/platform/dashboard/search', { query: input.query })) as Parameters<
          typeof mapSearchResults
        >[0],
      ),
    enabled: enabled && callerEnabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** 12-month MRR series. GET /platform/dashboard/mrr-trend. */
export function useDashboardMrrTrend() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getMrrTrend.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<MrrTrendPoint[]>({
    queryKey: ['platform-api', 'dashboard', 'mrr-trend'],
    queryFn: async () =>
      ((await platformGetRaw('/platform/dashboard/mrr-trend')) as Parameters<typeof mapMrrTrendPoint>[0][]).map(
        mapMrrTrendPoint,
      ),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Churn-risk panel. GET /platform/dashboard/churn-risk. */
export function useDashboardChurnRisk() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getChurnRisk.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<ChurnRisk>({
    queryKey: ['platform-api', 'dashboard', 'churn-risk'],
    queryFn: async () =>
      mapChurnRisk((await platformGetRaw('/platform/dashboard/churn-risk')) as Parameters<typeof mapChurnRisk>[0]),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** MRR forecast chart. GET /platform/dashboard/mrr-forecast. */
export function useDashboardMrrForecast() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getMrrForecast.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<MrrForecast>({
    queryKey: ['platform-api', 'dashboard', 'mrr-forecast'],
    queryFn: async () =>
      mapMrrForecast(
        (await platformGetRaw('/platform/dashboard/mrr-forecast')) as Parameters<typeof mapMrrForecast>[0],
      ),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Upsell panel. GET /platform/dashboard/upsell-opportunities. */
export function useDashboardUpsellOpportunities() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getUpsellOpportunities.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<UpsellOpportunities>({
    queryKey: ['platform-api', 'dashboard', 'upsell-opportunities'],
    queryFn: async () =>
      mapUpsellOpportunities(
        (await platformGetRaw('/platform/dashboard/upsell-opportunities')) as Parameters<
          typeof mapUpsellOpportunities
        >[0],
      ),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** AI cost anomaly panel. GET /platform/dashboard/ai-cost-anomalies. */
export function useDashboardAiCostAnomalies() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.platform.getAiCostAnomalies.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<AiCostAnomalies>({
    queryKey: ['platform-api', 'dashboard', 'ai-cost-anomalies'],
    queryFn: async () =>
      mapAiCostAnomalies(
        (await platformGetRaw('/platform/dashboard/ai-cost-anomalies')) as Parameters<typeof mapAiCostAnomalies>[0],
      ),
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}
