import { describe, it, expect } from 'vitest';
import {
  CHECKOUT_PLANS,
  isBillingConfigured,
  planToPriceId,
  priceIdToPlan,
} from '../../packages/api/src/lib/stripe';

const FULL_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_abc',
  STRIPE_PRICE_STARTER: 'price_starter_1',
  STRIPE_PRICE_PROFESSIONAL: 'price_pro_1',
};

describe('CHECKOUT_PLANS', () => {
  it('is exactly the two self-serve plans (no trial, no enterprise)', () => {
    expect([...CHECKOUT_PLANS]).toEqual(['starter', 'professional']);
  });
});

describe('isBillingConfigured', () => {
  it('is true only when the secret key AND both prices are present', () => {
    expect(isBillingConfigured(FULL_ENV)).toBe(true);
  });
  it('is false when the secret key is missing (fail-closed)', () => {
    expect(isBillingConfigured({ ...FULL_ENV, STRIPE_SECRET_KEY: undefined })).toBe(false);
    expect(isBillingConfigured({ ...FULL_ENV, STRIPE_SECRET_KEY: '' })).toBe(false);
  });
  it('is false when a price id is missing', () => {
    expect(isBillingConfigured({ ...FULL_ENV, STRIPE_PRICE_STARTER: undefined })).toBe(false);
    expect(isBillingConfigured({ ...FULL_ENV, STRIPE_PRICE_PROFESSIONAL: '' })).toBe(false);
  });
  it('is false for a completely empty env', () => {
    expect(isBillingConfigured({})).toBe(false);
  });
});

describe('planToPriceId', () => {
  it('maps each checkout plan to its configured price id', () => {
    expect(planToPriceId('starter', FULL_ENV)).toBe('price_starter_1');
    expect(planToPriceId('professional', FULL_ENV)).toBe('price_pro_1');
  });
  it('returns null when the price id for that plan is not configured', () => {
    expect(planToPriceId('starter', { ...FULL_ENV, STRIPE_PRICE_STARTER: undefined })).toBeNull();
    expect(planToPriceId('professional', { ...FULL_ENV, STRIPE_PRICE_PROFESSIONAL: '' })).toBeNull();
  });
});

describe('priceIdToPlan (reverse map for webhook)', () => {
  it('maps a configured price id back to its OrgPlan', () => {
    expect(priceIdToPlan('price_starter_1', FULL_ENV)).toBe('starter');
    expect(priceIdToPlan('price_pro_1', FULL_ENV)).toBe('professional');
  });
  it('returns null for an unknown price id', () => {
    expect(priceIdToPlan('price_unknown', FULL_ENV)).toBeNull();
  });
  it('does not match an unconfigured (empty/undefined) price id to a plan', () => {
    // An empty configured price must never let an empty incoming id resolve to a plan.
    expect(priceIdToPlan('', FULL_ENV)).toBeNull();
    expect(priceIdToPlan('', { ...FULL_ENV, STRIPE_PRICE_STARTER: '' })).toBeNull();
  });
});
