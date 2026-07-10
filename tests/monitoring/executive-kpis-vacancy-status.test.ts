import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  user: { count: vi.fn().mockResolvedValue(0) },
  vacancy: { count: vi.fn().mockResolvedValue(0) },
  salaryAdjustment: { count: vi.fn().mockResolvedValue(0) },
  survey: { count: vi.fn().mockResolvedValue(0) },
  alert: { count: vi.fn().mockResolvedValue(0) },
}));
vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  runWithTenant: <T,>(orgId: string | null, fn: () => T) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  suppressBelowMin5: (n: number) => (n > 0 && n < 5 ? { value: null, suppressed: true } : { value: n, suppressed: false }),
  buildAccessForUser: () => ({ allowed: true, roles: ['hr_admin'], scope: {} }),
  createAnchorLoader: () => null,
}));

beforeEach(() => vi.clearAllMocks());

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { monitoringRouter } = await import('../../packages/api/src/routers/monitoring');
  const testRouter = router({ monitoring: monitoringRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'exec-1', organizationId: '11111111-1111-1111-1111-111111111111', roles: ['hr_admin'],
      isPlatformOwner: false, impersonatorId: null, email: 'exec@tims.co', isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('monitoring.getExecutiveKpis — vacancy count', () => {
  it('counts approved+published vacancies, never the non-existent "open" status', async () => {
    const caller = await makeCaller();
    await caller.monitoring.getExecutiveKpis();

    const arg = mockDb.vacancy.count.mock.calls[0][0];
    expect(arg.where.status).toEqual({ in: ['approved', 'published'] });
  });

  it('excludes soft-deleted vacancies from the active-vacancy count', async () => {
    const caller = await makeCaller();
    await caller.monitoring.getExecutiveKpis();

    const arg = mockDb.vacancy.count.mock.calls[0][0];
    expect(arg.where.deletedAt).toBeNull();
  });
});
