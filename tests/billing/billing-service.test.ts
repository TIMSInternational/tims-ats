import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  billingService,
  blocksSelfServeCheckout,
} from '../../packages/api/src/services/billing.service';

// Guard that prevents a second subscription-creating checkout (double billing).
describe('blocksSelfServeCheckout', () => {
  it('blocks an org with a non-cancelled Stripe subscription', () => {
    expect(blocksSelfServeCheckout({ stripeSubscriptionId: 'sub_1', status: 'active', plan: 'starter' })).toBe(true);
    expect(blocksSelfServeCheckout({ stripeSubscriptionId: 'sub_1', status: 'trialing', plan: 'starter' })).toBe(true);
    expect(blocksSelfServeCheckout({ stripeSubscriptionId: 'sub_1', status: 'past_due', plan: 'professional' })).toBe(true);
  });
  it('blocks a paid local/manually-billed plan even with no Stripe subscription id', () => {
    // The TIMS case: paid plan invoiced externally, stripeSubscriptionId null.
    expect(blocksSelfServeCheckout({ stripeSubscriptionId: null, status: 'active', plan: 'professional' })).toBe(true);
    expect(blocksSelfServeCheckout({ stripeSubscriptionId: null, status: 'past_due', plan: 'starter' })).toBe(true);
  });
  it('allows checkout when the subscription is cancelled (re-subscribe)', () => {
    expect(blocksSelfServeCheckout({ stripeSubscriptionId: 'sub_1', status: 'cancelled', plan: 'starter' })).toBe(false);
    expect(blocksSelfServeCheckout({ stripeSubscriptionId: null, status: 'cancelled', plan: 'professional' })).toBe(false);
  });
  it('allows checkout for a trial with no Stripe subscription id', () => {
    expect(blocksSelfServeCheckout({ stripeSubscriptionId: null, status: 'trialing', plan: 'trial' })).toBe(false);
  });
  it('allows checkout for a missing subscription row', () => {
    expect(blocksSelfServeCheckout(null)).toBe(false);
    expect(blocksSelfServeCheckout(undefined)).toBe(false);
  });
});

// Fail-closed guarantee: with Stripe unconfigured, checkout must reject BEFORE any
// Stripe/DB call — no fabricated checkout URL, no customer creation (rule #4).
describe('billingService.createCheckoutSession — unconfigured', () => {
  const saved = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_STARTER: process.env.STRIPE_PRICE_STARTER,
    STRIPE_PRICE_PROFESSIONAL: process.env.STRIPE_PRICE_PROFESSIONAL,
  };

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_PROFESSIONAL;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('isConfigured() is false', () => {
    expect(billingService.isConfigured()).toBe(false);
  });

  it('rejects with PRECONDITION_FAILED and does not reach the network', async () => {
    await expect(
      billingService.createCheckoutSession('00000000-0000-0000-0000-000000000000', 'starter'),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('createPortalSession rejects with PRECONDITION_FAILED when unconfigured', async () => {
    await expect(
      billingService.createPortalSession('00000000-0000-0000-0000-000000000000', { id: 'actor-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('cancelSubscription rejects with PRECONDITION_FAILED when unconfigured', async () => {
    await expect(
      billingService.cancelSubscription('00000000-0000-0000-0000-000000000000', { id: 'actor-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
