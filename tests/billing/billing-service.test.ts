import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  billingService,
  blocksSelfServeCheckout,
} from '../../packages/api/src/services/billing.service';

// Guard that prevents a second subscription-creating checkout (double billing). The SAME golden corpus
// asserted by the C# BillingSelfServeKernel (contracts/billing-fixtures/blocks-self-serve-checkout.json;
// Tims.UnitTests BillingSelfServeKernelFixtureTests) is asserted here against the REAL export (#141
// honest-fixture rule). A behavior change edits the JSON once; both stacks must agree.
interface BlocksFixture {
  cases: Array<{
    name: string;
    input: { stripeSubscriptionId: string | null; status: string; plan: string } | null;
    expected: boolean;
  }>;
}

const blocksData = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/billing-fixtures/blocks-self-serve-checkout.json', import.meta.url)), 'utf8'),
) as BlocksFixture;

describe('blocks-self-serve-checkout.json — blocksSelfServeCheckout (real export, shared with C#)', () => {
  it.each(blocksData.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(blocksSelfServeCheckout(c.input)).toBe(c.expected);
  });
  // undefined collapses to the same branch as the null case (current?.stripeSubscriptionId ?? ...).
  it('treats undefined like a missing subscription row', () => {
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
