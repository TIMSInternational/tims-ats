import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ONBOARDING_TASKS, defaultOnboardingTasks } from '../../packages/api/src/services/onboarding-defaults';

const orgId = '11111111-1111-1111-1111-111111111111';
const hrId = '22222222-2222-2222-2222-222222222222';
const hireId = '33333333-3333-3333-3333-333333333333';

const { userCount, planFindFirst, planCreate } = vi.hoisted(() => ({
  userCount: vi.fn(),
  planFindFirst: vi.fn(),
  planCreate: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    user: { count: userCount },
    onboardingPlan: { findFirst: planFindFirst, create: planCreate },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertSubjectInScope: vi.fn().mockResolvedValue(undefined),
  requireOrgScope: vi.fn(),
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { onboardingRouter } = await import('../../packages/api/src/routers/onboarding');
  return createCallerFactory(router({ onboarding: onboardingRouter }))({
    user: {
      id: hrId,
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
  userCount.mockResolvedValue(1);
  planFindFirst.mockResolvedValue(null);
  planCreate.mockResolvedValue({ id: 'plan-1' });
});

describe('default onboarding task template', () => {
  it('covers every owner role and the core day-1 to 90-day checklist', () => {
    const owners = new Set(DEFAULT_ONBOARDING_TASKS.map((task) => task.responsible));
    expect([...owners].sort()).toEqual(['buddy', 'employee', 'hr', 'it', 'manager']);
    const titles = DEFAULT_ONBOARDING_TASKS.map((task) => task.title.toLowerCase()).join(' | ');
    for (const needle of ['contrato', 'accesos de ti', 'políticas', 'buddy', 'beneficios', '1:1', '30/60/90']) {
      expect(titles).toContain(needle);
    }
  });

  it('dates every task relative to the start date and derives a matching phase', () => {
    const start = new Date('2026-10-01T00:00:00.000Z');
    const tasks = defaultOnboardingTasks(start, orgId);
    expect(tasks).toHaveLength(DEFAULT_ONBOARDING_TASKS.length);
    tasks.forEach((task, index) => {
      const offset = DEFAULT_ONBOARDING_TASKS[index]!.dueOffsetDays;
      expect(task.dueDate.getTime() - start.getTime()).toBe(offset * 86_400_000);
      expect(task.phase).toBe(offset <= 30 ? 'day1_30' : offset <= 60 ? 'day31_60' : 'day61_90');
      expect(task.order).toBe(index);
      expect(task.organizationId).toBe(orgId);
    });
    const contract = tasks.find((task) => task.title.includes('contrato'));
    expect(contract).toMatchObject({ responsible: 'hr', dueDate: new Date('2026-09-28T00:00:00.000Z') });
    const closing = tasks[tasks.length - 1]!;
    expect(closing).toMatchObject({ phase: 'day61_90', dueDate: new Date('2026-12-30T00:00:00.000Z') });
  });
});

describe('onboarding.create (manual HR path)', () => {
  it('seeds the default checklist in the same nested write as the plan', async () => {
    const startDate = new Date('2026-10-01T00:00:00.000Z');
    await (await caller()).onboarding.create({ userId: hireId, startDate });

    expect(planCreate).toHaveBeenCalledTimes(1);
    const { data } = planCreate.mock.calls[0]![0];
    expect(data.organizationId).toBe(orgId);
    expect(data.tasks?.create).toEqual(defaultOnboardingTasks(startDate, orgId));
    expect(data.checkIns.create.map((item: { type: string }) => item.type)).toEqual(['day1', 'day30', 'day60']);
  });

  it('refuses a second active plan for the same hire instead of duplicating tasks', async () => {
    planFindFirst.mockResolvedValue({ id: 'existing-plan' });
    await expect(
      (await caller()).onboarding.create({ userId: hireId, startDate: new Date('2026-10-01') }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(planCreate).not.toHaveBeenCalled();
  });
});
