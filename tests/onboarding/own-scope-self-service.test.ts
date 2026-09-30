import { beforeEach, describe, expect, it, vi } from 'vitest';

// Server-side enforcement of the "hire toggles only their own tasks" rule.
// The `employee` role holds onboarding read+update @own and the own-scope
// fragment includes buddyId, so assertScoped alone lets a hire OR buddy reach
// the plan. These tests pin what an own-scoped caller may then DO with it.

const orgId = '11111111-1111-1111-1111-111111111111';
const hireId = '22222222-2222-2222-2222-222222222222';
const buddyId = '33333333-3333-3333-3333-333333333333';
const leaderId = '44444444-4444-4444-4444-444444444444';
const planId = '55555555-5555-5555-5555-555555555555';
const taskId = '66666666-6666-6666-6666-666666666666';
const checkInId = '77777777-7777-7777-7777-777777777777';
const otherPlanId = '88888888-8888-8888-8888-888888888888';

const h = vi.hoisted(() => ({
  scope: 'own' as string,
  taskFindFirst: vi.fn(),
  taskUpdate: vi.fn(),
  planUpdate: vi.fn(),
  planFindMany: vi.fn(),
  checkInFindFirst: vi.fn(),
  checkInUpdate: vi.fn(),
  assertScoped: vi.fn(),
  txPlanFindFirst: vi.fn(),
  txPlanUpdate: vi.fn(),
  txExecuteRaw: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    user: { count: vi.fn().mockResolvedValue(1) },
    onboardingTask: { findFirst: h.taskFindFirst, update: h.taskUpdate },
    onboardingPlan: { update: h.planUpdate, findMany: h.planFindMany },
    onboardingCheckIn: { findFirst: h.checkInFindFirst, update: h.checkInUpdate },
  },
  runTenantTransaction: (_org: string, fn: (tx: unknown) => unknown) =>
    fn({
      $executeRaw: h.txExecuteRaw,
      onboardingPlan: { findFirst: h.txPlanFindFirst, update: h.txPlanUpdate },
    }),
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn(async () => ({ allowed: true, scope: h.scope, roles: ['employee'] })),
  createAnchorLoader: vi.fn().mockReturnValue({}),
  assertScoped: h.assertScoped,
  scopeWhereFor: vi.fn().mockResolvedValue({ OR: [{ userId: hireId }, { buddyId: hireId }] }),
  assertSubjectInScope: vi.fn().mockResolvedValue(undefined),
  requireOrgScope: vi.fn(),
}));

async function callerAs(userId: string, scope: string) {
  h.scope = scope;
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { onboardingRouter } = await import('../../packages/api/src/routers/onboarding');
  return createCallerFactory(router({ onboarding: onboardingRouter }))({
    user: {
      id: userId,
      organizationId: orgId,
      roles: ['employee'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'e@example.com',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

function taskOwnedBy(responsible: string) {
  h.taskFindFirst.mockResolvedValue({ id: taskId, planId, responsible, plan: { userId: hireId, buddyId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertScoped.mockResolvedValue(undefined);
  h.taskUpdate.mockResolvedValue({ id: taskId });
  h.planUpdate.mockResolvedValue({ id: planId });
  h.planFindMany.mockResolvedValue([]);
  h.checkInFindFirst.mockResolvedValue({ id: checkInId, planId, status: 'pending' });
});

describe('updateTask — own-scoped caller', () => {
  it('lets the hire toggle their own employee task (positive control)', async () => {
    taskOwnedBy('employee');
    await (await callerAs(hireId, 'own')).onboarding.updateTask({ id: taskId, completed: true });
    expect(h.taskUpdate).toHaveBeenCalledWith({
      where: { id: taskId },
      data: expect.objectContaining({ completed: true, completedById: hireId }),
    });
  });

  it.each(['hr', 'it', 'manager', 'buddy'])('FORBIDs the hire toggling a %s task', async (owner) => {
    taskOwnedBy(owner);
    await expect(
      (await callerAs(hireId, 'own')).onboarding.updateTask({ id: taskId, completed: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.taskUpdate).not.toHaveBeenCalled();
  });

  it('lets the buddy toggle the buddy task on the plan they support', async () => {
    taskOwnedBy('buddy');
    await (await callerAs(buddyId, 'own')).onboarding.updateTask({ id: taskId, completed: true });
    expect(h.taskUpdate).toHaveBeenCalledTimes(1);
  });

  it.each(['employee', 'hr', 'it', 'manager'])('FORBIDs the buddy toggling a %s task', async (owner) => {
    taskOwnedBy(owner);
    await expect(
      (await callerAs(buddyId, 'own')).onboarding.updateTask({ id: taskId, completed: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.taskUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['title', { title: 'Renamed' }],
    ['responsible', { responsible: 'hr' }],
    ['phase', { phase: 'day61_90' }],
    ['order', { order: 9 }],
    ['description', { description: 'x' }],
    ['dueDate (null counts as sent)', { dueDate: null }],
  ])('FORBIDs the hire editing %s, even on their own task and alongside completed', async (_label, extra) => {
    taskOwnedBy('employee');
    await expect(
      (await callerAs(hireId, 'own')).onboarding.updateTask({ id: taskId, completed: true, ...extra }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.taskUpdate).not.toHaveBeenCalled();
  });

  it('still lets a team-scoped leader edit any task field (the rule is own-scope only)', async () => {
    taskOwnedBy('hr');
    await (await callerAs(leaderId, 'team')).onboarding.updateTask({ id: taskId, completed: true, title: 'Renamed' });
    expect(h.taskUpdate).toHaveBeenCalledWith({
      where: { id: taskId },
      data: expect.objectContaining({ title: 'Renamed', completed: true }),
    });
  });
});

describe('updatePlan / completeCheckIn — own-scoped caller', () => {
  it('FORBIDs the hire updating their own plan', async () => {
    await expect(
      (await callerAs(hireId, 'own')).onboarding.updatePlan({ id: planId, status: 'completed' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.planUpdate).not.toHaveBeenCalled();
    expect(h.txPlanUpdate).not.toHaveBeenCalled();
  });

  it('FORBIDs the buddy completing a check-in', async () => {
    await expect(
      (await callerAs(buddyId, 'own')).onboarding.completeCheckIn({ id: checkInId, score: 9 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.checkInUpdate).not.toHaveBeenCalled();
  });

  it('FORBIDs the hire completing their own check-in', async () => {
    await expect((await callerAs(hireId, 'own')).onboarding.completeCheckIn({ id: checkInId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(h.checkInUpdate).not.toHaveBeenCalled();
  });

  it('still lets a team-scoped caller update a plan and complete a check-in', async () => {
    const leader = await callerAs(leaderId, 'team');
    await leader.onboarding.updatePlan({ id: planId, phase: 'day31_60' });
    await leader.onboarding.completeCheckIn({ id: checkInId });
    expect(h.planUpdate).toHaveBeenCalledTimes(1);
    expect(h.checkInUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('updatePlan re-activation keeps one active plan per hire', () => {
  it('refuses to re-activate when the hire already has a different active plan', async () => {
    h.txPlanFindFirst
      .mockResolvedValueOnce({ userId: hireId }) // the plan being re-activated
      .mockResolvedValueOnce({ id: otherPlanId }); // the hire's other active plan
    await expect(
      (await callerAs(leaderId, 'organization')).onboarding.updatePlan({ id: planId, status: 'active' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(h.txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(h.txPlanUpdate).not.toHaveBeenCalled();
    expect(h.txPlanFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { organizationId: orgId, userId: hireId, status: 'active', id: { not: planId } },
      }),
    );
  });

  it('re-activates under the lock when no other active plan exists', async () => {
    h.txPlanFindFirst.mockResolvedValueOnce({ userId: hireId }).mockResolvedValueOnce(null);
    h.txPlanUpdate.mockResolvedValue({ id: planId, status: 'active' });
    await (await callerAs(leaderId, 'organization')).onboarding.updatePlan({ id: planId, status: 'active' });
    expect(h.txPlanUpdate).toHaveBeenCalledWith({ where: { id: planId }, data: { status: 'active' } });
    expect(h.planUpdate).not.toHaveBeenCalled();
  });
});

describe('list — mine filter (Mi Onboarding)', () => {
  it('restricts to plans where the caller is the hire, on top of the scope fragment', async () => {
    await (await callerAs(hireId, 'own')).onboarding.list({ limit: 1, status: 'active', mine: true });
    const where = h.planFindMany.mock.calls[0]![0].where;
    expect(where.AND[1]).toEqual({ OR: [{ userId: hireId }, { buddyId: hireId }] });
    expect(where.AND[2]).toEqual({ userId: hireId, status: 'active' });
  });

  it('does not add the filter when mine is omitted', async () => {
    await (await callerAs(hireId, 'own')).onboarding.list({ limit: 25 });
    const where = h.planFindMany.mock.calls[0]![0].where;
    expect(where.AND[2]).toEqual({});
  });
});
