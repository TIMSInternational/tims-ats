import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-23: the onboarding KPIs count overdue TASKS (due day passed in the organization's zone, not completed)
// instead of a risk score nothing computes. B-08: assigning a buddy goes through updatePlan, which refuses
// the hire as their own buddy. B-23: the plan list now carries each task's due date.

const h = vi.hoisted(() => ({
  orgFindFirst: vi.fn(),
  planCount: vi.fn(),
  taskCount: vi.fn(),
  checkInCount: vi.fn(),
  planAggregate: vi.fn(),
  planFindFirst: vi.fn(),
  planFindMany: vi.fn(),
  planUpdate: vi.fn(),
  userCount: vi.fn(),
  assertScoped: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    organization: { findFirst: h.orgFindFirst },
    onboardingPlan: {
      count: h.planCount,
      aggregate: h.planAggregate,
      findFirst: h.planFindFirst,
      findMany: h.planFindMany,
      update: h.planUpdate,
    },
    onboardingTask: { count: h.taskCount },
    onboardingCheckIn: { count: h.checkInCount },
    user: { count: h.userCount },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: h.assertScoped,
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertSubjectInScope: vi.fn().mockResolvedValue(undefined),
  requireOrgScope: vi.fn(),
}));

const orgId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const hireId = '44444444-4444-4444-8444-444444444444';
const buddyId = '55555555-5555-4555-8555-555555555555';

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { onboardingRouter } = await import('../../packages/api/src/routers/onboarding');
  return createCallerFactory(router({ onboarding: onboardingRouter }))({
    user: {
      id: userId,
      organizationId: orgId,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@example.com',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  h.planCount.mockResolvedValue(1);
  h.taskCount.mockResolvedValue(4);
  h.checkInCount.mockResolvedValue(0);
  h.planAggregate.mockResolvedValue({ _avg: { riskScore: null } });
  h.assertScoped.mockResolvedValue(undefined);
  h.userCount.mockReset().mockResolvedValue(1);
  h.planUpdate.mockResolvedValue({ id: planId });
});

describe('onboarding.getDashboardKpis', () => {
  it('counts overdue tasks of active plans from the start of today in the organization zone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-11-05 10:00 in Costa Rica (UTC-6) = 16:00Z; local midnight = 06:00Z.
    vi.setSystemTime(new Date('2026-11-05T16:00:00.000Z'));
    h.orgFindFirst.mockResolvedValue({ settings: { timezone: 'America/Costa_Rica' } });
    const kpis = await (await caller()).onboarding.getDashboardKpis();
    const overdueCall = h.taskCount.mock.calls.find(
      ([args]) => (args as { where: { dueDate?: unknown } }).where.dueDate !== undefined,
    );
    expect(overdueCall?.[0]).toEqual({
      where: {
        organizationId: orgId,
        completed: false,
        dueDate: { lt: new Date('2026-11-05T06:00:00.000Z') },
        plan: { status: 'active' },
      },
    });
    expect(kpis).toHaveProperty('overdueTasks', 4);
    vi.useRealTimers();
  });

  it('uses UTC midnight when the organization has no zone configured', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T16:00:00.000Z'));
    h.orgFindFirst.mockResolvedValue({ settings: {} });
    await (await caller()).onboarding.getDashboardKpis();
    const overdueCall = h.taskCount.mock.calls.find(
      ([args]) => (args as { where: { dueDate?: unknown } }).where.dueDate !== undefined,
    );
    expect((overdueCall?.[0] as { where: { dueDate: { lt: Date } } }).where.dueDate.lt).toEqual(
      new Date('2026-11-05T00:00:00.000Z'),
    );
    vi.useRealTimers();
  });
});

describe('onboarding.updatePlan buddy', () => {
  it('saves a buddy from the same organization who can read onboarding', async () => {
    h.planFindFirst.mockResolvedValue({ userId: hireId });
    await (await caller()).onboarding.updatePlan({ id: planId, buddyId });
    expect(h.userCount).toHaveBeenCalledWith({ where: { id: { in: [buddyId] }, organizationId: orgId } });
    expect(h.userCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: buddyId,
        organizationId: orgId,
        isActive: true,
        userRoles: {
          some: {
            role: {
              organizationId: orgId,
              isActive: true,
              rolePermissions: { some: { permission: { module: 'onboarding', action: 'read' } } },
            },
          },
        },
      }),
    });
    expect(h.planUpdate).toHaveBeenCalledWith({ where: { id: planId }, data: { buddyId } });
  });

  it('refuses a buddy who could not open the plan (no onboarding access), with a clear reason', async () => {
    h.planFindFirst.mockResolvedValue({ userId: hireId });
    h.userCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect((await caller()).onboarding.updatePlan({ id: planId, buddyId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('no tiene acceso a Onboarding'),
    });
    expect(h.planUpdate).not.toHaveBeenCalled();
  });

  it('refuses the hire as their own buddy', async () => {
    h.planFindFirst.mockResolvedValue({ userId: hireId });
    await expect((await caller()).onboarding.updatePlan({ id: planId, buddyId: hireId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(h.planUpdate).not.toHaveBeenCalled();
  });
});

describe('onboarding.list phase tabs', () => {
  it.each([
    ['day1_30', { gte: new Date('2026-10-06T06:00:00.000Z') }],
    ['day31_60', { gte: new Date('2026-09-06T06:00:00.000Z'), lt: new Date('2026-10-06T06:00:00.000Z') }],
    ['day61_90', { lt: new Date('2026-09-06T06:00:00.000Z') }],
  ] as const)('%s filters on the start date in the organization zone, before paging', async (startPhase, startDate) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T16:00:00.000Z'));
    h.orgFindFirst.mockResolvedValue({ settings: { timezone: 'America/Costa_Rica' } });
    h.planFindMany.mockResolvedValue([]);
    await (await caller()).onboarding.list({ limit: 10, status: 'active', startPhase });
    const where = (h.planFindMany.mock.calls[0]![0] as { where: { AND: Array<Record<string, unknown>> } }).where;
    expect(where.AND[2]).toMatchObject({ status: 'active', startDate });
    vi.useRealTimers();
  });
});

describe('onboarding.list', () => {
  it('returns each task with its due date, in checklist order', async () => {
    h.planFindMany.mockResolvedValue([]);
    await (await caller()).onboarding.list({ limit: 10, status: 'active' });
    const args = h.planFindMany.mock.calls[0]![0] as {
      include: { tasks: { select: Record<string, boolean>; orderBy: unknown } };
    };
    expect(args.include.tasks.select).toMatchObject({ dueDate: true, title: true, completed: true });
    expect(args.include.tasks.orderBy).toEqual([{ order: 'asc' }, { id: 'asc' }]);
  });
});
