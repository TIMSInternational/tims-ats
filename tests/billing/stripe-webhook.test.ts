import { describe, it, expect } from 'vitest';
import {
  mapStripeStatus,
  mapStripeSubscriptionToFields,
  isDuplicateSubscription,
  shouldDropEvent,
  type StripeSubscriptionLike,
} from '../../packages/api/src/services/billing-webhook.service';

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_PROFESSIONAL: 'price_pro',
};

// 2021-01-01T00:00:00Z and +30d in unix seconds.
const START = 1609459200;
const END = 1612137600;

function sub(overrides: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike {
  return {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    items: { data: [{ price: { id: 'price_pro' }, current_period_start: START, current_period_end: END }] },
    ...overrides,
  };
}

describe('mapStripeStatus', () => {
  it('maps Stripe statuses to our enum, defaulting unknown/risky to past_due (never active)', () => {
    expect(mapStripeStatus('active')).toBe('active');
    expect(mapStripeStatus('trialing')).toBe('trialing');
    expect(mapStripeStatus('past_due')).toBe('past_due');
    expect(mapStripeStatus('unpaid')).toBe('past_due');
    expect(mapStripeStatus('incomplete')).toBe('past_due');
    expect(mapStripeStatus('paused')).toBe('past_due');
    expect(mapStripeStatus('canceled')).toBe('cancelled');
    expect(mapStripeStatus('incomplete_expired')).toBe('cancelled');
    expect(mapStripeStatus('something_new')).toBe('past_due');
  });
});

describe('mapStripeSubscriptionToFields', () => {
  it('reads period from the subscription ITEM (not the subscription) and price→plan', () => {
    const f = mapStripeSubscriptionToFields(sub(), ENV);
    expect(f.stripeSubscriptionId).toBe('sub_1');
    expect(f.plan).toBe('professional');
    expect(f.status).toBe('active');
    expect(f.currentPeriodStart?.toISOString()).toBe('2021-01-01T00:00:00.000Z');
    expect(f.currentPeriodEnd?.toISOString()).toBe('2021-02-01T00:00:00.000Z');
    expect(f.cancelledAt).toBeNull();
  });

  it('returns plan=null for an unknown price (so the repo never downgrades on unknown)', () => {
    const f = mapStripeSubscriptionToFields(
      sub({ items: { data: [{ price: { id: 'price_???' }, current_period_start: START, current_period_end: END }] } }),
      ENV,
    );
    expect(f.plan).toBeNull();
  });

  it('sets cancelledAt to canceled_at when present', () => {
    const f = mapStripeSubscriptionToFields(sub({ status: 'canceled', canceled_at: START }), ENV);
    expect(f.status).toBe('cancelled');
    expect(f.cancelledAt?.toISOString()).toBe('2021-01-01T00:00:00.000Z');
  });

  it('uses cancel_at when cancel_at_period_end is set and canceled_at is absent', () => {
    const f = mapStripeSubscriptionToFields(sub({ cancel_at_period_end: true, cancel_at: END }), ENV);
    expect(f.cancelledAt?.toISOString()).toBe('2021-02-01T00:00:00.000Z');
  });

  it('handles a subscription with no items defensively (null periods, null plan)', () => {
    const f = mapStripeSubscriptionToFields(sub({ items: { data: [] } }), ENV);
    expect(f.plan).toBeNull();
    expect(f.currentPeriodStart).toBeNull();
    expect(f.currentPeriodEnd).toBeNull();
  });
});

describe('isDuplicateSubscription', () => {
  it('is true when the org already has a different, non-cancelled subscription', () => {
    expect(isDuplicateSubscription({ stripeSubscriptionId: 'sub_old', status: 'active' }, 'sub_new')).toBe(true);
  });
  it('is false for the same subscription id (idempotent re-delivery)', () => {
    expect(isDuplicateSubscription({ stripeSubscriptionId: 'sub_1', status: 'active' }, 'sub_1')).toBe(false);
  });
  it('is false when the existing one is cancelled (re-subscribe is fine)', () => {
    expect(isDuplicateSubscription({ stripeSubscriptionId: 'sub_old', status: 'cancelled' }, 'sub_new')).toBe(false);
  });
  it('is false when there is no existing subscription', () => {
    expect(isDuplicateSubscription(null, 'sub_new')).toBe(false);
    expect(isDuplicateSubscription({ stripeSubscriptionId: null, status: 'trialing' }, 'sub_new')).toBe(false);
  });

  it('also gates LATER events for a cancelled duplicate (followup updated/deleted ignored)', () => {
    // Org keeps sub_good; a stale updated/deleted for the cancelled duplicate sub_dup
    // must be treated as a non-current subscription and ignored.
    const existing = { stripeSubscriptionId: 'sub_good', status: 'active' };
    expect(isDuplicateSubscription(existing, 'sub_dup')).toBe(true);
    expect(isDuplicateSubscription(existing, 'sub_good')).toBe(false);
  });
});

describe('shouldDropEvent', () => {
  const t0 = new Date('2021-01-01T00:00:00Z'); // same second as t0b
  const t0b = new Date('2021-01-01T00:00:00Z');
  const t1 = new Date('2021-01-02T00:00:00Z');
  const active = { status: 'active', lastStripeEventAt: t1 };
  const cancelled = { status: 'cancelled', lastStripeEventAt: t1 };

  it('applies when nothing was applied yet', () => {
    expect(shouldDropEvent(null, 'active', t0)).toBe(false);
    expect(shouldDropEvent(undefined, 'active', t0)).toBe(false);
  });
  it('drops a strictly older event', () => {
    expect(shouldDropEvent(active, 'active', t0)).toBe(true);
  });
  it('applies a strictly newer event', () => {
    expect(shouldDropEvent({ status: 'active', lastStripeEventAt: t0 }, 'cancelled', t1)).toBe(false);
  });
  it('applies a DISTINCT same-second event (e.g. created→updated), not dropped as a tie', () => {
    expect(shouldDropEvent({ status: 'active', lastStripeEventAt: t0 }, 'active', t0b)).toBe(false);
  });
  it('applies a same-second transition TO cancelled (updated→deleted)', () => {
    expect(shouldDropEvent({ status: 'active', lastStripeEventAt: t0 }, 'cancelled', t0b)).toBe(false);
  });
  it('drops a same-second event that would UN-cancel a terminal state (deleted→updated out of order)', () => {
    expect(shouldDropEvent({ status: 'cancelled', lastStripeEventAt: t0 }, 'active', t0b)).toBe(true);
  });
  it('drops a strictly older un-cancel and keeps cancelled', () => {
    expect(shouldDropEvent(cancelled, 'active', t0)).toBe(true);
  });
});
