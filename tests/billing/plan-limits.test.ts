import { describe, it, expect } from 'vitest';
import { planLimits, PLAN_LIMITS, entitledPlan } from '../../packages/shared/src/constants';

describe('planLimits', () => {
  it('returns the configured limits for each plan', () => {
    expect(planLimits('trial')).toEqual(PLAN_LIMITS.trial);
    expect(planLimits('starter')).toEqual(PLAN_LIMITS.starter);
    expect(planLimits('professional')).toEqual(PLAN_LIMITS.professional);
    expect(planLimits('enterprise')).toEqual(PLAN_LIMITS.enterprise);
  });

  it('enterprise is unlimited (null) on every metric', () => {
    expect(planLimits('enterprise')).toEqual({ employees: null, vacancies: null, assessments: null });
  });

  it('paid tiers are strictly larger than trial', () => {
    expect(planLimits('starter').employees!).toBeGreaterThan(planLimits('trial').employees!);
    expect(planLimits('professional').vacancies!).toBeGreaterThan(planLimits('starter').vacancies!);
  });

  it('falls back to the conservative trial limits for an unknown plan', () => {
    // @ts-expect-error — exercising the runtime fallback for an out-of-union value
    expect(planLimits('mystery')).toEqual(PLAN_LIMITS.trial);
  });
});

describe('entitledPlan', () => {
  it('keeps the plan for a non-cancelled subscription', () => {
    expect(entitledPlan('professional', 'active')).toBe('professional');
    expect(entitledPlan('enterprise', 'active')).toBe('enterprise');
    expect(entitledPlan('starter', 'trialing')).toBe('starter');
    expect(entitledPlan('professional', 'past_due')).toBe('professional');
  });
  it('falls back to trial for a CANCELLED subscription (no paid entitlement)', () => {
    expect(entitledPlan('enterprise', 'cancelled')).toBe('trial');
    expect(entitledPlan('professional', 'cancelled')).toBe('trial');
  });
  it('falls back to trial for a missing plan/status', () => {
    expect(entitledPlan(null, null)).toBe('trial');
    expect(entitledPlan(undefined, undefined)).toBe('trial');
  });

  it('a cancelled enterprise sub gets trial limits, not unlimited', () => {
    expect(planLimits(entitledPlan('enterprise', 'cancelled'))).toEqual(PLAN_LIMITS.trial);
  });
});
