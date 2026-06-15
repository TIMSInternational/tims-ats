import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral test for compensation field-auth (slice 6 round 5, HIGH 1) ────
// getEmployeeComp / simulateAdjustment / listPendingAdjustments now build their
// Prisma select from selectFor(ctx.access.roles, …) and construct the returned DTO
// ONLY from selected fields. A leader/employee/hrbp caller with compensation:read
// must NOT receive compaRatio/variablePay (employeeCompensation) or previousSalary/
// newSalary (salaryAdjustment); super/hr must.
//
// We mock `../trpc` so permissionProcedure is a bare pass-through, mock `@tims/db`
// (tenantDb), no-op the scope/audit helpers, and keep the REAL selectFor so the
// role→field projection is exercised end-to-end.

const compFindFirst = vi.fn();
const bandFindUnique = vi.fn();
const adjFindMany = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    employeeCompensation: { findFirst: (...a: unknown[]) => compFindFirst(...a) },
    salaryBand: { findUnique: (...a: unknown[]) => bandFindUnique(...a) },
    salaryAdjustment: { findMany: (...a: unknown[]) => adjFindMany(...a) },
  },
}));

// Real selectFor + suppressBelowMin5; no-op the scope/audit helpers.
vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>(
    '../../packages/api/src/access',
  );
  return {
    ...actual,
    requireOrgScope: vi.fn(),
    assertScoped: vi.fn(),
    assertSubjectInScope: vi.fn(),
    scopeWhereFor: vi.fn(async () => ({})),
    logDataAccess: vi.fn(async () => undefined),
  };
});

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { organizationId: string; id: string; impersonatorId?: string }; access: { roles: string[] }; headers: Headers }>()
    .create();
  return {
    router: t.router,
    permissionProcedure: () => t.procedure,
  };
});

import { compensationRouter } from '../../packages/api/src/routers/compensation';

interface CompCaller {
  getEmployeeComp(input: { userId: string }): Promise<Record<string, unknown>>;
  simulateAdjustment(input: { userId: string; proposedSalary: number }): Promise<Record<string, unknown>>;
  listPendingAdjustments(): Promise<Array<Record<string, unknown>>>;
}

const t = initTRPC
  .context<{ user: { organizationId: string; id: string; impersonatorId?: string }; access: { roles: string[] }; headers: Headers }>()
  .create();
const createCaller = t.createCallerFactory(compensationRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

// getEmployeeComp/simulateAdjustment inputs are z.string().uuid() — use a real UUID.
const TARGET_UUID = '11111111-1111-4111-8111-111111111111';

const callerFor = (roles: string[]) =>
  createCaller({
    user: { organizationId: 'org-1', id: 'u-1' },
    access: { roles },
    headers: new Headers(),
  }) as unknown as CompCaller;

// A full comp row — Prisma `select` is mocked, so the resolver receives whatever we
// return here. We return all fields and rely on the resolver to project the DTO from
// the role-derived select (which is what selectFor governs).
const COMP_ROW = {
  id: 'comp-1',
  userId: 'target-1',
  currentSalary: 5_000_000,
  variablePay: 1_000_000,
  compaRatio: 1.05,
  band: { level: 'L3', title: 'Senior', minSalary: 4_000_000, midSalary: 5_000_000, maxSalary: 6_000_000 },
};

beforeEach(() => {
  vi.clearAllMocks();
  compFindFirst.mockResolvedValue({ ...COMP_ROW });
  bandFindUnique.mockResolvedValue({ minSalary: 4_000_000, midSalary: 5_000_000, maxSalary: 6_000_000 });
});

describe('getEmployeeComp field-auth (HIGH 1)', () => {
  it('super_admin receives currentSalary + variablePay + compaRatio + band', async () => {
    const r = await callerFor(['super_admin']).getEmployeeComp({ userId: TARGET_UUID });
    expect(r.currentSalary).toBe(5_000_000);
    expect(r.variablePay).toBe(1_000_000);
    expect(r.compaRatio).toBe(1.05);
    expect(r.band).not.toBeUndefined();
  });

  it('hr_admin receives compaRatio + variablePay', async () => {
    const r = await callerFor(['hr_admin']).getEmployeeComp({ userId: TARGET_UUID });
    expect(r.compaRatio).toBe(1.05);
    expect(r.variablePay).toBe(1_000_000);
  });

  it('leader receives currentSalary but NOT compaRatio/variablePay/band', async () => {
    const r = await callerFor(['leader']).getEmployeeComp({ userId: TARGET_UUID });
    expect(r.currentSalary).toBe(5_000_000);
    expect('compaRatio' in r).toBe(false);
    expect('variablePay' in r).toBe(false);
    expect('band' in r).toBe(false);
  });

  it('employee receives currentSalary but NOT compaRatio/variablePay/band', async () => {
    const r = await callerFor(['employee']).getEmployeeComp({ userId: TARGET_UUID });
    expect(r.currentSalary).toBe(5_000_000);
    expect('compaRatio' in r).toBe(false);
    expect('variablePay' in r).toBe(false);
    expect('band' in r).toBe(false);
  });

  it('the Prisma select itself omits compaRatio/variablePay/bandId for a leader (never leaves the DB)', async () => {
    await callerFor(['leader']).getEmployeeComp({ userId: TARGET_UUID });
    const arg = compFindFirst.mock.calls[0]![0] as { select: Record<string, unknown> };
    expect(arg.select.currentSalary).toBe(true);
    expect(arg.select.compaRatio).toBeUndefined();
    expect(arg.select.variablePay).toBeUndefined();
    expect(arg.select.band).toBeUndefined();
  });
});

describe('simulateAdjustment field-auth (HIGH 1)', () => {
  it('super/hr/hrbp receive currentCompaRatio + band bounds', async () => {
    for (const role of ['super_admin', 'hr_admin', 'hrbp']) {
      const r = await callerFor([role]).simulateAdjustment({ userId: TARGET_UUID, proposedSalary: 5_500_000 });
      expect('currentCompaRatio' in r).toBe(true);
      expect('newCompaRatio' in r).toBe(true);
      expect('bandMin' in r).toBe(true);
      expect(r.proposedSalary).toBe(5_500_000);
    }
  });

  it('leader/employee receive the projected salary + %change but NOT compa-ratio/band internals', async () => {
    for (const role of ['leader', 'employee']) {
      const r = await callerFor([role]).simulateAdjustment({ userId: TARGET_UUID, proposedSalary: 5_500_000 });
      expect(r.currentSalary).toBe(5_000_000);
      expect(r.proposedSalary).toBe(5_500_000);
      expect('percentageChange' in r).toBe(true);
      expect('currentCompaRatio' in r).toBe(false);
      expect('newCompaRatio' in r).toBe(false);
      expect('bandMin' in r).toBe(false);
      expect('bandMax' in r).toBe(false);
      expect('withinBand' in r).toBe(false);
    }
    // The band lookup must not even run for an unentitled caller.
    expect(bandFindUnique).not.toHaveBeenCalled();
  });
});

describe('listPendingAdjustments field-auth (HIGH 1)', () => {
  const ADJ_ROW = {
    id: 'adj-1',
    createdAt: new Date(),
    previousSalary: 4_000_000,
    newSalary: 5_000_000,
    reason: 'merit cycle',
    type: 'merit',
    status: 'pending',
    user: { id: 'target-1', firstName: 'Ana', lastName: 'Gomez', jobTitle: 'Dev' },
    requester: { id: 'r-1', firstName: 'Boss', lastName: 'Lady' },
  };

  it('the Prisma select carries previousSalary/newSalary/reason ONLY for super/hr', async () => {
    adjFindMany.mockResolvedValue([{ ...ADJ_ROW }]);
    for (const role of ['super_admin', 'hr_admin']) {
      vi.clearAllMocks();
      adjFindMany.mockResolvedValue([{ ...ADJ_ROW }]);
      await callerFor([role]).listPendingAdjustments();
      const sel = (adjFindMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
      expect(sel.previousSalary).toBe(true);
      expect(sel.newSalary).toBe(true);
      expect(sel.reason).toBe(true);
      expect(sel.user).not.toBeUndefined();
    }
  });

  it('the Prisma select OMITS previousSalary/newSalary/reason for a leader/hrbp', async () => {
    for (const role of ['hrbp', 'leader']) {
      vi.clearAllMocks();
      adjFindMany.mockResolvedValue([{ ...ADJ_ROW }]);
      await callerFor([role]).listPendingAdjustments();
      const sel = (adjFindMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
      expect(sel.previousSalary).toBeUndefined();
      expect(sel.newSalary).toBeUndefined();
      expect(sel.reason).toBeUndefined();
      // The related user/requester name fields are NOT classified salary fields → kept.
      expect(sel.user).not.toBeUndefined();
      expect(sel.requester).not.toBeUndefined();
    }
  });
});
