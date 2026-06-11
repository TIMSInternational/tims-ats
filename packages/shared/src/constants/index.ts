export const APP_NAME = 'TIMS Platform';
export const APP_DOMAIN = 'tims.com';
export const SUPPORT_EMAIL = 'soporte@tims.com';

export const PLANS = ['trial', 'starter', 'professional', 'enterprise'] as const;
export type Plan = typeof PLANS[number];

// ── Per-plan usage limits (Wave 2) ──────────────────────────────────────────
// null = unlimited. Surfaced by billing.getUsage so usage reads as used/limit.
// storage/apiCalls have NO metering source yet → stay null in getUsage regardless
// of plan (honest, rule #4). These numbers are a product/pricing decision and are
// not enforced (no blocking at the cap) — that's a follow-up.
export interface PlanLimits {
  employees: number | null;
  vacancies: number | null;
  assessments: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  trial: { employees: 5, vacancies: 3, assessments: 20 },
  starter: { employees: 25, vacancies: 10, assessments: 200 },
  professional: { employees: 100, vacancies: 50, assessments: 2000 },
  enterprise: { employees: null, vacancies: null, assessments: null },
};

// Limits for a plan, defaulting to the most conservative (trial) for an unknown value.
export function planLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.trial;
}

// Effective entitlement plan for usage/limits. A cancelled subscription keeps its
// plan NAME but loses paid entitlement, so it falls back to trial limits; a missing
// plan also defaults to trial. Any other status keeps the plan.
export function entitledPlan(plan: Plan | null | undefined, status: string | null | undefined): Plan {
  if (!plan || status === 'cancelled') return 'trial';
  return plan;
}

export const LOCALES = ['es', 'en'] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'es';

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const SESSION_EXPIRY_HOURS = 24;
export const MFA_REQUIRED_ROLES = ['super_admin', 'hr_admin', 'hrbp'] as const;

// ── Alert-rule metric registry ──────────────────────────────────────────────
// The shared contract between the rule-config UI (metric dropdown) and the cron
// evaluation engine (per-org queries). A rule's condition.metric MUST be one of
// these keys; the engine skips any rule whose metric isn't recognized. Every key
// here maps to a REAL, org-scoped query in alert-evaluation.repository.ts — no
// fabricated metrics. (failed-login thresholds are a documented follow-up: no
// org-attributable failed-login record exists yet.)
export const ALERT_METRIC_KEYS = [
  'vacancies_open_60d',
  'sla_active_breaches',
  'pending_salary_adjustments',
  'active_surveys',
  'headcount',
  'active_alerts',
] as const;
export type AlertMetricKey = (typeof ALERT_METRIC_KEYS)[number];

// Canonical module each metric belongs to (used as the Alert.module when a rule
// fires, and to group metrics in the config UI).
export const ALERT_METRIC_MODULE: Record<AlertMetricKey, string> = {
  vacancies_open_60d: 'recruitment',
  sla_active_breaches: 'recruitment',
  pending_salary_adjustments: 'compensation',
  active_surveys: 'engagement',
  headcount: 'people',
  active_alerts: 'monitoring',
};

export const ALERT_OPERATORS = ['gt', 'lt', 'eq', 'gte', 'lte'] as const;
export type AlertOperator = (typeof ALERT_OPERATORS)[number];
