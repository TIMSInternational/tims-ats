import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedEntitlementCatalog, provisionInvu, MODULES } from '../../packages/db/prisma/seed-entitlements';

// ---------------------------------------------------------------------------
// Mock-based (no real DB). `provisionInvu`/`seedEntitlementCatalog` take a
// PrismaClient-shaped object as a parameter (dependency injection), so we
// hand-build a minimal mock covering only the delegates they call, including
// `$transaction` (both array and interactive-callback forms are exercised by
// the two functions respectively). The mock is cast to the functions'
// declared parameter type at the call site — no direct `@prisma/client`
// import needed here.
// ---------------------------------------------------------------------------

type UpsertArgs = {
  where: { organizationId_moduleCode?: { organizationId: string; moduleCode: string }; code?: string };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
};

function findUpsertArgsByModuleCode(calls: unknown[][], moduleCode: string): UpsertArgs {
  const call = calls.find((c) => (c[0] as UpsertArgs).where.organizationId_moduleCode?.moduleCode === moduleCode);
  if (!call) throw new Error(`no orgEntitlement.upsert call found for moduleCode=${moduleCode}`);
  return call[0] as UpsertArgs;
}

function findUpsertArgsByCode(calls: unknown[][], code: string): UpsertArgs {
  const call = calls.find((c) => (c[0] as UpsertArgs).where.code === code);
  if (!call) throw new Error(`no module.upsert call found for code=${code}`);
  return call[0] as UpsertArgs;
}

const ATS_BASE_PLAN_MODULES = [
  { planCode: 'ats-base', moduleCode: 'vacancies', limit: null },
  { planCode: 'ats-base', moduleCode: 'candidate_portal', limit: null },
  { planCode: 'ats-base', moduleCode: 'ai_screening', limit: null },
  { planCode: 'ats-base', moduleCode: 'compliance_matrix', limit: null },
  { planCode: 'ats-base', moduleCode: 'assessments', limit: null },
  { planCode: 'ats-base', moduleCode: 'interviews', limit: null },
  { planCode: 'ats-base', moduleCode: 'validations', limit: null },
];

function createMockDb() {
  const mock = {
    module: { upsert: vi.fn().mockResolvedValue({}) },
    plan: { upsert: vi.fn().mockResolvedValue({}) },
    planModule: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue(ATS_BASE_PLAN_MODULES),
    },
    organization: { upsert: vi.fn().mockResolvedValue({ id: 'org-invu-id' }) },
    orgEntitlement: { upsert: vi.fn().mockResolvedValue({}) },
    // Support both `$transaction([...])` (array of pending operations) and the
    // interactive `$transaction(async (tx) => ...)` form, mirroring real Prisma.
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(mock);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
  return mock;
}

type MockDb = ReturnType<typeof createMockDb>;
type SeedDb = Parameters<typeof provisionInvu>[0];

describe('provisionInvu', () => {
  let mockDb: MockDb;
  let orgId: string;

  beforeEach(async () => {
    mockDb = createMockDb();
    ({ orgId } = await provisionInvu(mockDb as unknown as SeedDb));
  });

  it('gives INVU the ai_voice_interview add-on enabled', () => {
    const args = findUpsertArgsByModuleCode(mockDb.orgEntitlement.upsert.mock.calls, 'ai_voice_interview');
    expect(args.create.enabled).toBe(true);
    expect(args.create.source).toBe('addon');
    expect(args.where.organizationId_moduleCode?.organizationId).toBe(orgId);
  });

  it('caps ai_screening at 5000', () => {
    const args = findUpsertArgsByModuleCode(mockDb.orgEntitlement.upsert.mock.calls, 'ai_screening');
    expect(args.create.limit).toBe(5000);
  });

  it('wraps provisioning writes in a transaction', () => {
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it('re-run does NOT clobber an operator override: base-plan rows have an empty update: clause', () => {
    // Per-org OrgEntitlement rows are operator-tunable (platform-owner console),
    // unlike the code-owned Module/Plan/PlanModule catalog. Re-running the seed
    // must leave an existing row exactly as the operator left it — e.g. an
    // operator who disabled ai_screening must not have it silently re-enabled.
    for (const pm of ATS_BASE_PLAN_MODULES) {
      const args = findUpsertArgsByModuleCode(mockDb.orgEntitlement.upsert.mock.calls, pm.moduleCode);
      expect(args.update).toEqual({});
    }
  });

  it('re-run does NOT clobber an operator override: the ai_voice_interview addon row has an empty update: clause', () => {
    const args = findUpsertArgsByModuleCode(mockDb.orgEntitlement.upsert.mock.calls, 'ai_voice_interview');
    // Specifically: a pre-existing row with enabled:false must not be forced back
    // to enabled:true by a re-run — the update clause must not set `enabled` at all.
    expect(args.update).not.toHaveProperty('enabled');
    expect(args.update).toEqual({});
  });
});

describe('seedEntitlementCatalog', () => {
  let mockDb: MockDb;

  beforeEach(async () => {
    mockDb = createMockDb();
    await seedEntitlementCatalog(mockDb as unknown as SeedDb);
  });

  it('wraps catalog seeding writes in a transaction', () => {
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps the code-owned Module catalog overwriting on re-run (update: full module payload)', () => {
    const args = findUpsertArgsByCode(mockDb.module.upsert.mock.calls, 'ai_screening');
    // Catalog rows ARE code-owned source of truth — update must still overwrite.
    expect(args.update).toMatchObject({ code: 'ai_screening', kind: 'core', metered: true });
  });

  it('upserts every module in the catalog', () => {
    expect(mockDb.module.upsert).toHaveBeenCalledTimes(MODULES.length);
    for (const m of MODULES) {
      expect(() => findUpsertArgsByCode(mockDb.module.upsert.mock.calls, m.code)).not.toThrow();
    }
  });

  it('creates ats-base with its 7 core planModules', () => {
    expect(mockDb.plan.upsert).toHaveBeenCalledTimes(1);
    const planArgs = mockDb.plan.upsert.mock.calls[0][0] as UpsertArgs;
    expect(planArgs.where.code).toBe('ats-base');
    expect(mockDb.planModule.upsert).toHaveBeenCalledTimes(7);
  });
});
