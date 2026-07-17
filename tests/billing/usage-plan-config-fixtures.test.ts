import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildUsageView,
  entitledPlan,
  planLimits,
  type Plan,
  type UsageView,
} from '../../packages/shared/src/constants';
import { isBillingConfigured, type StripeBillingEnv } from '../../packages/api/src/lib/stripe';

// Phase-5 Slice 3b: the SAME golden fixtures asserted by the C# billing kernels
// (contracts/billing-fixtures/{plan-entitlement,usage-view,billing-config}.json; Tims.UnitTests
// PlanEntitlementFixtureTests / UsageViewFixtureTests / BillingConfigFixtureTests) are asserted here by
// the REAL TS exports — entitledPlan/planLimits (the getUsage kernel), buildUsageView (the exact envelope
// billing.getUsage now returns), and isBillingConfigured (the getBillingConfig predicate). A behavior change
// edits the JSON once; either stack disagreeing turns its CI red.

function load<T>(file: string): { cases: Array<{ name: string } & T> } {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../contracts/billing-fixtures/${file}`, import.meta.url)), 'utf8'),
  );
}

describe('plan-entitlement.json — entitledPlan + planLimits kernel', () => {
  const data = load<{
    input: { plan: string | null; status: string | null };
    expected: { entitledPlan: string; limits: { employees: number | null; vacancies: number | null; assessments: number | null } };
  }>('plan-entitlement.json');

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const plan = c.input.plan as Plan | null;
    const resolved = entitledPlan(plan, c.input.status);
    expect(resolved).toBe(c.expected.entitledPlan);
    expect(planLimits(resolved)).toEqual(c.expected.limits);
  });
});

describe('usage-view.json — buildUsageView envelope (the real billing.getUsage shape)', () => {
  const data = load<{
    input: {
      employees: number;
      vacancies: number;
      assessments: number;
      plan: string | null;
      status: string | null;
      periodStart: string | null;
      periodEnd: string | null;
    };
    expected: UsageView;
  }>('usage-view.json');

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const view = buildUsageView({
      employees: c.input.employees,
      vacancies: c.input.vacancies,
      assessments: c.input.assessments,
      plan: c.input.plan as Plan | null,
      status: c.input.status,
      periodStart: c.input.periodStart === null ? null : new Date(c.input.periodStart),
      periodEnd: c.input.periodEnd === null ? null : new Date(c.input.periodEnd),
    });
    expect(view).toEqual(c.expected);
    // Pin the exact key set (a dropped/added envelope field the value-compare could miss).
    expect(Object.keys(view).sort()).toEqual(Object.keys(c.expected).sort());
    // storage/apiCalls are ALWAYS null objects (no metering source) — pin explicitly.
    expect(view.storage).toEqual({ usedMb: null, limitMb: null });
    expect(view.apiCalls).toEqual({ used: null, limit: null });
  });
});

describe('billing-config.json — isBillingConfigured predicate', () => {
  const data = load<{
    input: { secretKey: string | null; priceStarter: string | null; priceProfessional: string | null };
    expected: boolean;
  }>('billing-config.json');

  const toEnv = (i: { secretKey: string | null; priceStarter: string | null; priceProfessional: string | null }): StripeBillingEnv => ({
    STRIPE_SECRET_KEY: i.secretKey ?? undefined,
    STRIPE_PRICE_STARTER: i.priceStarter ?? undefined,
    STRIPE_PRICE_PROFESSIONAL: i.priceProfessional ?? undefined,
  });

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(isBillingConfigured(toEnv(c.input))).toBe(c.expected);
  });
});
