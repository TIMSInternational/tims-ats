/**
 * setup-status.test.ts (Sprint 1.2 Task 2)
 *
 * Covers `organization.getSetupStatus` (5 derived checklist booleans +
 * allComplete + per-user dismissedAt with 7-day re-show logic) and
 * `organization.dismissSetupChecklist` (writes the CALLER's own
 * setupChecklistDismissedAt, never another user's — protectedProcedure, not
 * gated on organization:update, since hr_admin holds read-only org access
 * but must still be able to dismiss their own widget).
 *
 * Pattern mirrors tests/perf/kpi-cache.test.ts: vi.mock('@tims/db') +
 * permissionProcedure shim (buildAccessForUser always-allow) +
 * createCallerFactory. No cache mock — getSetupStatus's 5 booleans are
 * always read live (whole-branch review removed the original per-org
 * cache, see the "always reads ... live" test below).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock declarations — must be at module top level (vi.mock is hoisted)
// ---------------------------------------------------------------------------

const organizationFindUnique = vi.fn();
const companyCount = vi.fn();
const vacancyCount = vi.fn();
const userCount = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    organization: { findUnique: (...args: unknown[]) => organizationFindUnique(...args) },
    company: { count: (...args: unknown[]) => companyCount(...args) },
    vacancy: { count: (...args: unknown[]) => vacancyCount(...args) },
    user: {
      count: (...args: unknown[]) => userCount(...args),
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
  },
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

vi.mock('../../packages/api/src/access/build', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({
    allowed: true,
    scope: 'organization',
    roles: ['super_admin'],
  }),
}));

vi.mock('../../packages/api/src/access/anchors', () => ({
  createAnchorLoader: vi.fn().mockReturnValue(null),
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({
    allowed: true,
    scope: 'organization',
    roles: ['super_admin'],
  }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

const TEST_ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_USER_ID = 'b1ffcd00-0d1c-4f09-cc7e-7cc0ce491b22';
const OTHER_USER_ID = 'c2ffcd00-0d1c-4f09-cc7e-7cc0ce491b33';

function baseUser() {
  return {
    id: TEST_USER_ID,
    organizationId: TEST_ORG_ID,
    roles: ['super_admin'],
    isPlatformOwner: false,
    impersonatorId: null,
    email: 'admin@tims.co',
    isActive: true,
  };
}

function baseCtx() {
  return {
    user: baseUser(),
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  };
}

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { organizationRouter } = await import('../../packages/api/src/routers/organization');
  const testRouter = router({ organization: organizationRouter });
  const factory = createCallerFactory(testRouter);
  return factory(baseCtx() as never);
}

function setDefaults(overrides: {
  logo?: string | null;
  companyCount?: number;
  userCount?: number;
  vacancyCount?: number;
  publishedVacancyCount?: number;
  dismissedAt?: Date | null;
}) {
  organizationFindUnique.mockResolvedValue({ logo: overrides.logo ?? null });
  // Defaults to 1 (a fresh, Task-1-provisioned org always has a Company) —
  // tests that need to model a pre-Task-1 legacy org override this to 0.
  companyCount.mockResolvedValue(overrides.companyCount ?? 1);
  userCount.mockResolvedValue(overrides.userCount ?? 1);
  // vacancy.count is called twice: once for "any vacancy" and once for
  // "published vacancy" — resolve by call order.
  vacancyCount.mockReset();
  vacancyCount
    .mockResolvedValueOnce(overrides.vacancyCount ?? 0)
    .mockResolvedValueOnce(overrides.publishedVacancyCount ?? 0);
  userFindUnique.mockResolvedValue({ setupChecklistDismissedAt: overrides.dismissedAt ?? null });
  userUpdate.mockResolvedValue({ id: TEST_USER_ID, setupChecklistDismissedAt: new Date() });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('organization.getSetupStatus', () => {
  it('for a fresh org (only Task-1 auto-provisioned structure), returns companyStructureReady true and everything else false', async () => {
    setDefaults({});
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.items).toEqual({
      companyStructureReady: true,
      teamInvited: false,
      brandingSet: false,
      firstVacancyPosted: false,
      firstVacancyPublished: false,
    });
    expect(result.allComplete).toBe(false);
    expect(result.dismissedAt).toBeNull();
  });

  it('reports companyStructureReady false for a legacy pre-Task-1 org with zero Company rows (not a hardcoded true)', async () => {
    // Regression test: provisionOrgDefaults only guarantees a Company for
    // orgs created from this sprint onward. An org created before Task-1
    // shipped (or any hypothetical provisioning failure) must NOT be
    // misreported as "ready" — this is a live count, not a constant.
    setDefaults({ companyCount: 0 });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(companyCount).toHaveBeenCalledWith({ where: { organizationId: TEST_ORG_ID } });
    expect(result.items.companyStructureReady).toBe(false);
  });

  it('flips teamInvited true once the org has more than one user', async () => {
    setDefaults({ userCount: 2 });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.items.teamInvited).toBe(true);
  });

  it('flips brandingSet true once the organization has a non-null logo', async () => {
    setDefaults({ logo: 'https://cdn.example.com/logo.png' });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.items.brandingSet).toBe(true);
  });

  it('flips firstVacancyPosted true once any non-deleted vacancy exists', async () => {
    setDefaults({ vacancyCount: 1 });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.items.firstVacancyPosted).toBe(true);
    expect(result.items.firstVacancyPublished).toBe(false);
  });

  it('flips firstVacancyPublished true once a published vacancy exists', async () => {
    setDefaults({ vacancyCount: 1, publishedVacancyCount: 1 });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.items.firstVacancyPublished).toBe(true);
  });

  it('reports allComplete true only when all 5 items are true', async () => {
    setDefaults({
      userCount: 2,
      logo: 'https://cdn.example.com/logo.png',
      vacancyCount: 1,
      publishedVacancyCount: 1,
    });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.allComplete).toBe(true);
  });

  it('surfaces the caller own dismissedAt (ISO string) when set and still within 7 days, checklist incomplete', async () => {
    const recentDismiss = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    setDefaults({ dismissedAt: recentDismiss });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.dismissedAt).toBe(recentDismiss.toISOString());
  });

  it('re-shows the checklist (dismissedAt: null) once 7+ days have passed and the checklist is still incomplete', async () => {
    const staleDismiss = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
    setDefaults({ dismissedAt: staleDismiss });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.dismissedAt).toBeNull();
  });

  it('does NOT re-show past the 7-day mark if the checklist is already fully complete', async () => {
    const staleDismiss = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
    setDefaults({
      dismissedAt: staleDismiss,
      userCount: 2,
      logo: 'https://cdn.example.com/logo.png',
      vacancyCount: 1,
      publishedVacancyCount: 1,
    });
    const caller = await makeCaller();

    const result = await caller.organization.getSetupStatus();

    expect(result.dismissedAt).toBe(staleDismiss.toISOString());
    expect(result.allComplete).toBe(true);
  });

  it('always reads the 5 derived booleans live, never from a cache (whole-branch review: a server cache here had no invalidation on any write path, so a just-completed item could stay stale for up to 60s — removed entirely rather than wired up, since these are cheap indexed counts)', async () => {
    setDefaults({ vacancyCount: 1, publishedVacancyCount: 1 });
    const caller = await makeCaller();

    await caller.organization.getSetupStatus();
    await caller.organization.getSetupStatus();

    // Two calls -> the live queries run twice, not once-then-cached.
    expect(companyCount).toHaveBeenCalledTimes(2);
    expect(userCount).toHaveBeenCalledTimes(2);
    expect(vacancyCount).toHaveBeenCalledTimes(4); // 2 counts per call (any + published)
    expect(organizationFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe('organization.dismissSetupChecklist', () => {
  it("updates the CALLER's own setupChecklistDismissedAt, scoped to their own user id + org", async () => {
    setDefaults({});
    const caller = await makeCaller();

    await caller.organization.dismissSetupChecklist();

    expect(userUpdate).toHaveBeenCalledTimes(1);
    const args = userUpdate.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // Scoped to the CALLER's own id only — never input-driven, so it can
    // never target another user's row.
    expect(args.where).toEqual({ id: TEST_USER_ID });
    expect(args.data.setupChecklistDismissedAt).toBeInstanceOf(Date);
    expect(args.where.id).not.toBe(OTHER_USER_ID);
  });
});
