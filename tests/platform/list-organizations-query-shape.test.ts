/**
 * list-organizations-query-shape.test.ts — issue #211.
 *
 * WHY THIS FILE EXISTS: the #211 change added `orderBy: { id: 'asc' }` to the `invoices` include of
 * `platform.listOrganizations`, and the C# read repository added a matching ordinal-string `OrderBy` over
 * the same ids. Both sides were changed; NEITHER side was pinned. Deleting the TS `orderBy` left the full
 * 3144-test vitest suite green, and deleting the C# `.OrderBy(...)` left the full 998/1241 dotnet suite
 * green — so the "fixed on both sides" claim rested on two guards that did not exist.
 *
 * That matters more than an ordinary missing test, for a reason specific to this surface. The parity
 * harness compares payloads LITERALLY and `scripts/parity/normalize.ts` is deliberately NOT configured
 * with `sortArraysBy` here (doing so would sort the top-level `organizations[]` too and silently retire
 * this surface's pagination check). So array ORDER is load-bearing: an org with two or more pending
 * invoices diffs on row order alone. And `verify organization` cannot be run today — both
 * platform-organizations flags are dark — so a unit-level pin is the only executable check that exists.
 *
 * WHAT THIS PINS AND WHAT IT DOES NOT. It asserts the Prisma query ARGUMENTS the procedure actually
 * builds, by mocking `@tims/db` and reading what `findMany` was called with. That is the running layer,
 * not source text: a grep-style pin would tick green against a call that never runs. It cannot prove
 * Postgres honours the ordering, and it pins the TS side only — the C# counterpart is pinned separately
 * in services/Tims.Platform/tests/Tims.IntegrationTests/PlatformOrganizations/
 * PlatformOrganizationsReadRepositoryListTests.cs (a Testcontainers test, so it DOES run against a real
 * Postgres). That name read `PlatformOrganizationsReadRepositoryOrderingTests` until 2026-08-11; no such
 * file has ever existed, so the pointer resolved to nothing.
 *
 * Mock strategy is lifted from tests/platform/data-requests-dsar-audit.test.ts: mock `../trpc` so
 * `protectedProcedure` is a pass-through while the REAL `platformProcedure` owner gate still runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

const organizationFindMany = vi.fn();
const organizationCount = vi.fn();

vi.mock('@tims/db', () => ({
  db: {
    organization: {
      findMany: (...a: unknown[]) => organizationFindMany(...a),
      count: (...a: unknown[]) => organizationCount(...a),
    },
  },
  tenantDb: {},
  InvitationStatus: { pending: 'pending', sent: 'sent' },
  InvoiceStatus: { pending: 'pending' },
  SubscriptionStatus: { trialing: 'trialing' },
  OrgPlan: { trial: 'trial', starter: 'starter', professional: 'professional', enterprise: 'enterprise' },
  runWithTenant: (_orgId: string | null, fn: () => unknown) => fn(),
}));

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
    .create();
  return { router: t.router, protectedProcedure: t.procedure };
});

import { organizationsRouter } from '../../packages/api/src/routers/platform/organizations';

const t = initTRPC
  .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
  .create();
const createCaller = t.createCallerFactory(
  organizationsRouter as unknown as Parameters<typeof t.createCallerFactory>[0],
);

interface ListCaller {
  listOrganizations(input: Record<string, unknown>): Promise<{ organizations: unknown[]; total: number }>;
}

const caller = (isPlatformOwner = true) =>
  createCaller({
    user: { id: 'owner-1', organizationId: '99999999-9999-4999-8999-999999999999', isPlatformOwner },
    headers: new Headers(),
  }) as unknown as ListCaller;

/** The `include` the procedure actually passed to Prisma on the single findMany call. */
async function capturedInclude(): Promise<Record<string, Record<string, unknown>>> {
  await caller().listOrganizations({});
  // Non-vacuity: every assertion below reads args[0], so a procedure that stopped calling findMany
  // would otherwise throw a confusing TypeError instead of failing this explicitly.
  expect(organizationFindMany, 'listOrganizations no longer calls organization.findMany').toHaveBeenCalledTimes(1);
  const args = organizationFindMany.mock.calls[0][0] as { include: Record<string, Record<string, unknown>> };
  return args.include;
}

beforeEach(() => {
  vi.clearAllMocks();
  organizationFindMany.mockResolvedValue([]);
  organizationCount.mockResolvedValue(0);
});

describe('platform.listOrganizations Prisma query shape (#211)', () => {
  it('orders the pending-invoices include by id ascending', async () => {
    const include = await capturedInclude();

    // THE #211 FIX. Without it, an org with 2+ pending invoices diffs against C# on row order alone.
    expect(include.invoices.orderBy).toEqual({ id: 'asc' });
  });

  it('keeps the invoices include filtered to pending and narrowly selected', async () => {
    const include = await capturedInclude();

    // Non-vacuity for the assertion above: if a future edit replaced this include wholesale, the
    // orderBy could survive on an include that no longer means the same thing.
    expect(include.invoices.where).toEqual({ status: 'pending' });
    expect(include.invoices.select).toEqual({ id: true, dueDate: true });
  });

  it('takes exactly ONE user row — the C# side must emit an ARRAY of 0 or 1, not a scalar', async () => {
    const include = await capturedInclude();

    // `take: 1` CAPS the relation, it does not flatten it: TS emits `users: [{ lastLoginAt }]` or `[]`.
    // The C# port originally projected a scalar `lastLoginAt`, which is a shape divergence the harness
    // cannot normalize away. This is the TS half of that contract.
    expect(include.users.take).toBe(1);
    expect(include.users.select).toEqual({ lastLoginAt: true });
    expect(include.users.where).toEqual({ lastLoginAt: { not: null } });
    expect(include.users.orderBy).toEqual({ lastLoginAt: 'desc' });
  });

  it('requests relation counts under the `_count` key the C# read model renames to', async () => {
    const include = await capturedInclude();

    expect(include._count).toEqual({ select: { users: true, vacancies: true, invoices: true } });
  });

  it('orders organizations by createdAt desc by default — the ordering sortArraysBy would have retired', async () => {
    // Stated in the #211 comment as the reason NOT to reach for `sortArraysBy: 'id'` on this surface.
    // Pinned so that justification stays true.
    await caller().listOrganizations({});
    const args = organizationFindMany.mock.calls[0][0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('still refuses a non-platform-owner — the real platformProcedure gate is in the path', async () => {
    // Guards the premise of every test above: if the gate had been mocked away too, these would be
    // exercising an unprotected procedure and proving nothing about the deployed one.
    await expect(caller(false).listOrganizations({})).rejects.toThrow(/plataforma/i);
    expect(organizationFindMany).not.toHaveBeenCalled();
  });
});
