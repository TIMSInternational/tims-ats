import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  mapStripeStatus,
  mapStripeSubscriptionToFields,
  isDuplicateSubscription,
  shouldDropEvent,
  type StripeSubscriptionLike,
} from '../../packages/api/src/services/billing-webhook.service';
import { priceIdToPlan, type StripeBillingEnv } from '../../packages/api/src/lib/stripe';

// Phase-5 Slice 4: the SAME golden corpus asserted by the C# StripeWebhookKernel
// (contracts/billing-fixtures/stripe-webhook-kernel.json; Tims.UnitTests StripeWebhookKernelFixtureTests)
// is asserted HERE against the REAL webhook exports — so the fixture reflects true TS behavior (the #141
// honest-fixture rule), not a hand-rolled mirror. Each case is dispatched by its `fn`. A behavior change
// edits the JSON once; both stacks must agree. Regression corpus pins: unknown/paused/incomplete status
// NEVER maps to `active` (access-safety); the same-second un-cancel guard; unknown price -> plan null
// (no downgrade); a different non-cancelled subscription is a duplicate (double-bill prevention).

interface Fixture {
  env: { starterPriceId: string | null; professionalPriceId: string | null };
  cases: Array<{ fn: string; name: string; input: unknown; expected: unknown }>;
}

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/billing-fixtures/stripe-webhook-kernel.json', import.meta.url)), 'utf8'),
) as Fixture;

const ENV: StripeBillingEnv = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRICE_STARTER: data.env.starterPriceId ?? undefined,
  STRIPE_PRICE_PROFESSIONAL: data.env.professionalPriceId ?? undefined,
};

const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());

describe('stripe-webhook-kernel.json — pure webhook kernels (real exports, shared with C# StripeWebhookKernel)', () => {
  it.each(data.cases.map((c) => [`${c.fn}: ${c.name}`, c] as const))('%s', (_label, c) => {
    switch (c.fn) {
      case 'mapStripeStatus':
        expect(mapStripeStatus(c.input as string)).toBe(c.expected);
        break;

      case 'priceIdToPlan':
        expect(priceIdToPlan(c.input as string, ENV)).toBe(c.expected);
        break;

      case 'mapStripeSubscriptionToFields': {
        const f = mapStripeSubscriptionToFields(c.input as StripeSubscriptionLike, ENV);
        const wire = {
          stripeSubscriptionId: f.stripeSubscriptionId,
          plan: f.plan,
          status: f.status,
          currentPeriodStart: isoOrNull(f.currentPeriodStart),
          currentPeriodEnd: isoOrNull(f.currentPeriodEnd),
          cancelledAt: isoOrNull(f.cancelledAt),
        };
        expect(wire).toEqual(c.expected);
        break;
      }

      case 'isDuplicateSubscription': {
        const input = c.input as {
          existing: { stripeSubscriptionId: string | null; status: string } | null;
          incoming: string;
        };
        expect(isDuplicateSubscription(input.existing, input.incoming)).toBe(c.expected);
        break;
      }

      case 'shouldDropEvent': {
        const input = c.input as {
          current: { status: string; lastStripeEventAt: string } | null;
          incomingStatus: string;
          eventAt: string;
        };
        const current = input.current
          ? { status: input.current.status, lastStripeEventAt: new Date(input.current.lastStripeEventAt) }
          : input.current;
        expect(shouldDropEvent(current, input.incomingStatus, new Date(input.eventAt))).toBe(c.expected);
        break;
      }

      default:
        throw new Error(`unknown kernel fn: ${c.fn}`);
    }
  });
});
