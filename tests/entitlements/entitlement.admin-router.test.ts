/**
 * entitlement.admin-router.test.ts
 *
 * Router unit tests for the platform-owner entitlements admin router (Task 3).
 * Mocks the service layer (Task 2), the repository's organizationExists (IDOR
 * check), and db.auditLog.create (best-effort audit side-channel). Mirrors the
 * makeCaller pattern from tests/entitlements/entitlement.router.test.ts and
 * tests/access/ai-interview-router.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/services/entitlement.service', () => ({
  getOrgEntitlementsAdmin: vi.fn(),
  setOrgEntitlement: vi.fn(),
  assignPlan: vi.fn(),
  listPlansForAdmin: vi.fn(),
  listModulesForAdmin: vi.fn(),
}));

vi.mock('../../packages/api/src/repositories/entitlement.repository', () => ({
  organizationExists: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  db: {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
  // Platform-owner requests with no org row of their own skip runWithTenant
  // entirely (see withTenantContext in trpc.ts); non-owner requests DO call it,
  // so it must be a passthrough here for the FORBIDDEN test to reach the guard.
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

import {
  getOrgEntitlementsAdmin,
  setOrgEntitlement,
  assignPlan,
  listPlansForAdmin,
  listModulesForAdmin,
} from '../../packages/api/src/services/entitlement.service';
import { organizationExists } from '../../packages/api/src/repositories/entitlement.repository';
import { db } from '@tims/db';

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

async function makeCaller(overrideCtx?: Record<string, unknown>) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { entitlementsAdminRouter } = await import('../../packages/api/src/routers/platform/entitlements');

  const testRouter = router({ platform: entitlementsAdminRouter });
  const callerFactory = createCallerFactory(testRouter);

  const baseCtx = {
    // Platform-owner context has NO organizationId of its own — withTenantContext
    // short-circuits (return next()) without calling runWithTenant. A non-owner
    // context below sets organizationId so withTenantContext's runWithTenant path
    // is exercised (mocked as a passthrough above).
    user: {
      id: 'platform-user-1',
      email: 'owner@tims.co',
      supabaseUserId: 's-owner-1',
      roles: ['platform_owner'],
      isPlatformOwner: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
    ...overrideCtx,
  };

  return callerFactory(baseCtx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('entitlementsAdminRouter — platformProcedure gate', () => {
  it('non-platform-owner caller gets FORBIDDEN', async () => {
    const caller = await makeCaller({
      user: {
        id: 'staff-user-1',
        email: 'staff@tims.co',
        supabaseUserId: 's-staff-1',
        organizationId: ORG_ID,
        roles: ['hr_admin'],
        isPlatformOwner: false,
      },
    });

    await expect(caller.platform.getOrgEntitlements({ orgId: ORG_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('entitlementsAdminRouter — IDOR guard', () => {
  it('platform-owner caller with a missing org gets NOT_FOUND', async () => {
    vi.mocked(organizationExists).mockResolvedValue(false);

    const caller = await makeCaller();

    await expect(
      caller.platform.setOrgEntitlement({ orgId: ORG_ID, moduleCode: 'ai_screening', enabled: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(vi.mocked(setOrgEntitlement)).not.toHaveBeenCalled();
  });

  it('platform-owner caller with a missing org gets NOT_FOUND on assignPlan', async () => {
    vi.mocked(organizationExists).mockResolvedValue(false);

    const caller = await makeCaller();

    await expect(
      caller.platform.assignPlan({ orgId: ORG_ID, planCode: 'ats-base' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(vi.mocked(assignPlan)).not.toHaveBeenCalled();
  });
});

describe('entitlementsAdminRouter — setOrgEntitlement', () => {
  it('calls the service with the patch and returns ok', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(setOrgEntitlement).mockResolvedValue(undefined);

    const caller = await makeCaller();
    const result = await caller.platform.setOrgEntitlement({
      orgId: ORG_ID,
      moduleCode: 'ai_screening',
      enabled: true,
      limit: 100,
    });

    expect(result).toEqual({ ok: true });
    expect(vi.mocked(setOrgEntitlement)).toHaveBeenCalledWith(ORG_ID, 'ai_screening', {
      enabled: true,
      limit: 100,
    });
  });

  it('is best-effort on audit logging: an auditLog.create rejection does NOT fail the mutation', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(setOrgEntitlement).mockResolvedValue(undefined);
    vi.mocked(db.auditLog.create as unknown as (a: unknown) => Promise<unknown>).mockRejectedValue(
      new Error('audit db down'),
    );

    const caller = await makeCaller();
    const result = await caller.platform.setOrgEntitlement({
      orgId: ORG_ID,
      moduleCode: 'ai_screening',
      enabled: true,
    });

    expect(result).toEqual({ ok: true });
  });
});

describe('entitlementsAdminRouter — setOrgEntitlement input bounds', () => {
  it('rejects a limit above the Postgres Int32 max (2147483648)', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    const caller = await makeCaller();

    await expect(
      caller.platform.setOrgEntitlement({ orgId: ORG_ID, moduleCode: 'ai_screening', limit: 2147483648 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(vi.mocked(setOrgEntitlement)).not.toHaveBeenCalled();
  });

  it('accepts a limit at exactly the Postgres Int32 max (2147483647)', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(setOrgEntitlement).mockResolvedValue(undefined);
    const caller = await makeCaller();

    const result = await caller.platform.setOrgEntitlement({
      orgId: ORG_ID, moduleCode: 'ai_screening', limit: 2147483647,
    });

    expect(result).toEqual({ ok: true });
    expect(vi.mocked(setOrgEntitlement)).toHaveBeenCalledWith(ORG_ID, 'ai_screening', { limit: 2147483647 });
  });

  it('rejects a non-finite unitPrice (Infinity)', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    const caller = await makeCaller();

    await expect(
      caller.platform.setOrgEntitlement({ orgId: ORG_ID, moduleCode: 'ai_screening', unitPrice: Infinity }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(vi.mocked(setOrgEntitlement)).not.toHaveBeenCalled();
  });

  it('accepts a normal unitPrice (0.15)', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(setOrgEntitlement).mockResolvedValue(undefined);
    const caller = await makeCaller();

    const result = await caller.platform.setOrgEntitlement({
      orgId: ORG_ID, moduleCode: 'ai_screening', unitPrice: 0.15,
    });

    expect(result).toEqual({ ok: true });
    expect(vi.mocked(setOrgEntitlement)).toHaveBeenCalledWith(ORG_ID, 'ai_screening', { unitPrice: 0.15 });
  });
});

describe('entitlementsAdminRouter — audit action naming (snake_case, matches system.ts convention)', () => {
  it('setOrgEntitlement audit-logs action: entitlement_set', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(setOrgEntitlement).mockResolvedValue(undefined);
    const caller = await makeCaller();

    await caller.platform.setOrgEntitlement({ orgId: ORG_ID, moduleCode: 'ai_screening', enabled: true });

    expect(vi.mocked(db.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'entitlement_set' }) }),
    );
  });

  it('assignPlan audit-logs action: entitlement_plan_assigned', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(assignPlan).mockResolvedValue({ applied: 1 });
    const caller = await makeCaller();

    await caller.platform.assignPlan({ orgId: ORG_ID, planCode: 'ats-base' });

    expect(vi.mocked(db.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'entitlement_plan_assigned' }) }),
    );
  });
});

describe('entitlementsAdminRouter — assignPlan', () => {
  it('calls the service and returns its result', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(assignPlan).mockResolvedValue({ applied: 3 });

    const caller = await makeCaller();
    const result = await caller.platform.assignPlan({ orgId: ORG_ID, planCode: 'ats-base' });

    expect(result).toEqual({ applied: 3 });
    expect(vi.mocked(assignPlan)).toHaveBeenCalledWith(ORG_ID, 'ats-base');
  });

  it('is best-effort on audit logging: a rejection does NOT fail the mutation', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(assignPlan).mockResolvedValue({ applied: 1 });
    vi.mocked(db.auditLog.create as unknown as (a: unknown) => Promise<unknown>).mockRejectedValue(
      new Error('audit db down'),
    );

    const caller = await makeCaller();
    const result = await caller.platform.assignPlan({ orgId: ORG_ID, planCode: 'ats-base' });

    expect(result).toEqual({ applied: 1 });
  });
});

describe('entitlementsAdminRouter — read queries', () => {
  it('getOrgEntitlements delegates to the service', async () => {
    vi.mocked(getOrgEntitlementsAdmin).mockResolvedValue([
      {
        moduleCode: 'ai_screening',
        name: 'AI Screening',
        kind: 'core',
        metered: true,
        unit: 'call',
        enabled: true,
        source: 'plan',
        limit: 100,
        unitPrice: null,
        effectiveUnitPrice: 0.5,
      },
    ]);

    const caller = await makeCaller();
    const result = await caller.platform.getOrgEntitlements({ orgId: ORG_ID });

    expect(result).toHaveLength(1);
    expect(vi.mocked(getOrgEntitlementsAdmin)).toHaveBeenCalledWith(ORG_ID);
  });

  it('listPlans delegates to the service', async () => {
    vi.mocked(listPlansForAdmin).mockResolvedValue([{ code: 'ats-base', name: 'ATS Base', active: true }]);

    const caller = await makeCaller();
    const result = await caller.platform.listPlans();

    expect(result).toEqual([{ code: 'ats-base', name: 'ATS Base', active: true }]);
  });

  it('listModules delegates to the service', async () => {
    vi.mocked(listModulesForAdmin).mockResolvedValue([
      { code: 'ai_screening', name: 'AI Screening', kind: 'core', metered: true, unit: 'call', defaultUnitPrice: 0.5 },
    ]);

    const caller = await makeCaller();
    const result = await caller.platform.listModules();

    expect(result).toHaveLength(1);
  });
});
