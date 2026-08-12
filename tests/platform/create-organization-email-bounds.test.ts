/**
 * create-organization-email-bounds.test.ts — issue #207.
 *
 * `platform.createOrganization` bounded `name` and `slug` but left `adminEmail` and `billingEmail`
 * UNBOUNDED, which violates `.claude/rules/api-security.md` ("no unbounded z.string()"). The C# port
 * (Phase-5 slice 21) reproduced the omission faithfully, so BOTH stacks had to change together to stay
 * in parity.
 *
 * THE BOUND IS 254, from RFC 5321 §4.5.3.1.3: a Path (`<address>`) is at most 256 octets INCLUDING the
 * angle brackets, so a deliverable address itself is at most 254. Not 320 — that is the sum of the
 * local-part (64) and domain (255) component maxima plus the `@`, and no standard guarantees an address
 * of that length is deliverable.
 *
 * THIS IS A TS BEHAVIOUR CHANGE, not a no-op tightening: an address longer than 254 was previously
 * ACCEPTED and written to `organizations.billing_email`, and is now rejected with a 400. Blast radius is
 * one caller (`create-org-modal.tsx`, which never sends `billingEmail`), and existing rows are untouched
 * because this is an input bound and `updateOrganization` does not accept `billingEmail`.
 *
 * Before this file there was ZERO vitest coverage of this schema — the only file mentioning
 * `createOrganization` was a route-string allow-list — so the behaviour change would have shipped
 * untested.
 *
 * The C# half is pinned separately, in PlatformOrganizationsCreateUseCaseTests (unit) and
 * PlatformOrganizationsCreateEndpointAuthTests (integration); both had assertions that INVERTED here.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ZodTypeAny } from 'zod';

vi.mock('@tims/db', () => ({
  db: {},
  tenantDb: {},
  SubscriptionStatus: { trialing: 'trialing' },
  OrgPlan: { trial: 'trial', starter: 'starter', professional: 'professional', enterprise: 'enterprise' },
  InvitationStatus: { pending: 'pending', sent: 'sent' },
  InvoiceStatus: { pending: 'pending' },
  runWithTenant: (_orgId: string | null, fn: () => unknown) => fn(),
}));

import { organizationsRouter } from '../../packages/api/src/routers/platform/organizations';

// tRPC v11 introspection, same shape as tests/dei/residual-procedures.test.ts: router._def.procedures
// is the flat Record<string, Procedure>. A procedure's Zod input schemas live at _def.inputs.
const procedures = (
  organizationsRouter as unknown as {
    _def: { procedures: Record<string, { _def: { inputs?: ZodTypeAny[] } }> };
  }
)._def.procedures;

const createInput = procedures['createOrganization']?._def?.inputs?.[0];

const LONG_LOCAL = (n: number) => 'a'.repeat(n) + '@example.com'; // "@example.com" is 12 chars
const AT_254 = LONG_LOCAL(242);
const AT_255 = LONG_LOCAL(243);

const base = {
  name: 'Parity Org',
  slug: 'parity-org',
  plan: 'trial' as const,
  adminEmail: 'admin@tims.test',
};

describe('platform.createOrganization input schema — email bounds (#207)', () => {
  it('exposes an input schema at all (guards the introspection itself)', () => {
    // Without this, every assertion below would silently pass on `undefined?.safeParse` being skipped.
    expect(createInput, 'createOrganization has no introspectable input schema').toBeDefined();
    expect(typeof createInput!.safeParse).toBe('function');
  });

  it('fixture lengths are what the boundary claims they are', () => {
    expect(AT_254).toHaveLength(254);
    expect(AT_255).toHaveLength(255);
  });

  it('accepts an adminEmail of exactly 254 characters', () => {
    expect(createInput!.safeParse({ ...base, adminEmail: AT_254 }).success).toBe(true);
  });

  it('rejects an adminEmail of 255 characters', () => {
    expect(createInput!.safeParse({ ...base, adminEmail: AT_255 }).success).toBe(false);
  });

  it('accepts a billingEmail of exactly 254 characters', () => {
    expect(createInput!.safeParse({ ...base, billingEmail: AT_254 }).success).toBe(true);
  });

  it('rejects a billingEmail of 255 characters', () => {
    expect(createInput!.safeParse({ ...base, billingEmail: AT_255 }).success).toBe(false);
  });

  it('still rejects a malformed email regardless of length (the .email() check survives .max())', () => {
    expect(createInput!.safeParse({ ...base, adminEmail: 'nope' }).success).toBe(false);
    expect(createInput!.safeParse({ ...base, billingEmail: 'nope' }).success).toBe(false);
  });

  it('billingEmail remains OPTIONAL — absent is valid, and .max() did not make it required', () => {
    expect(createInput!.safeParse(base).success).toBe(true);
  });

  // Non-vacuity: if a future edit replaced the schema with something permissive, every "rejects" test
  // above could still pass for the wrong reason while these bounds silently disappeared.
  it('leaves the pre-existing name and slug bounds unchanged', () => {
    expect(createInput!.safeParse({ ...base, name: 'a'.repeat(100) }).success).toBe(true);
    expect(createInput!.safeParse({ ...base, name: 'a'.repeat(101) }).success).toBe(false);
    expect(createInput!.safeParse({ ...base, slug: 'a'.repeat(50) }).success).toBe(true);
    expect(createInput!.safeParse({ ...base, slug: 'a'.repeat(51) }).success).toBe(false);
    // The slug regex is part of that same schema and must not have been relaxed either.
    expect(createInput!.safeParse({ ...base, slug: 'Not A Slug' }).success).toBe(false);
  });
});
