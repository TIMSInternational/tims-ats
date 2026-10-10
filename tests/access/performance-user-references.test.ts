import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const COLLEAGUE_ID = '33333333-3333-4333-8333-333333333333';
const FOREIGN_ID = '44444444-4444-4444-8444-444444444444';
const MISSING_ID = '55555555-5555-4555-8555-555555555555';

const userCount = vi.fn();
const createFeedback = vi.fn();
const createRecognition = vi.fn();
const createCoachingSession = vi.fn();
const assertSubjectInScope = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    user: { count: userCount },
    feedback: { create: createFeedback },
    recognition: { create: createRecognition },
    coachingSession: { create: createCoachingSession },
  },
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

vi.mock('../../packages/api/src/access', async () => {
  const { assertUsersInOrg } = await import('../../packages/api/src/access/org-user-reference');
  return {
    assertUsersInOrg,
    buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
    createAnchorLoader: vi.fn().mockReturnValue(null),
    assertSubjectInScope,
    assertScoped: vi.fn().mockResolvedValue(undefined),
    scopeWhereFor: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

async function makeCaller() {
  const { createCallerFactory, mergeRouters, router } = await import('../../packages/api/src/trpc');
  const { performanceFeedbackRouter } = await import('../../packages/api/src/routers/performance/feedback');
  const { performanceCoachingRouter } = await import('../../packages/api/src/routers/performance/coaching');
  return createCallerFactory(
    router({ performance: mergeRouters(performanceFeedbackRouter, performanceCoachingRouter) }),
  )({
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
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
  userCount.mockImplementation(
    async ({ where }: { where: { id: { in: string[] }; organizationId: string } }) =>
      where.id.in.filter((id) => [USER_ID, COLLEAGUE_ID].includes(id) && where.organizationId === ORG_ID).length,
  );
  createFeedback.mockResolvedValue({ id: 'feedback' });
  createRecognition.mockResolvedValue({ id: 'recognition' });
  createCoachingSession.mockResolvedValue({ id: 'coaching' });
  assertSubjectInScope.mockResolvedValue(undefined);
});

describe('performance mutation user references', () => {
  it.each([FOREIGN_ID, MISSING_ID])('rejects feedback to a foreign or nonexistent user (%s)', async (toUserId) => {
    const caller = await makeCaller();
    await expect(
      caller.performance.submitFeedback({ toUserId, type: 'peer', message: 'Thank you' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(createFeedback).not.toHaveBeenCalled();
  });

  it.each([FOREIGN_ID, MISSING_ID])('rejects recognition to a foreign or nonexistent user (%s)', async (toUserId) => {
    const caller = await makeCaller();
    await expect(
      caller.performance.giveRecognition({ toUserId, category: 'teamwork', message: 'Thank you' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(createRecognition).not.toHaveBeenCalled();
  });

  it.each([FOREIGN_ID, MISSING_ID])('rejects a foreign or nonexistent coaching leader (%s)', async (leaderId) => {
    const caller = await makeCaller();
    await expect(
      caller.performance.createCoachingSession({
        employeeId: COLLEAGUE_ID,
        leaderId,
        scheduledAt: new Date('2026-10-12T15:00:00Z'),
        topic: 'Goals',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(assertSubjectInScope).not.toHaveBeenCalled();
    expect(createCoachingSession).not.toHaveBeenCalled();
  });

  it('rejects a foreign coaching employee even when the leader belongs to the organization', async () => {
    const caller = await makeCaller();
    await expect(
      caller.performance.createCoachingSession({
        employeeId: FOREIGN_ID,
        leaderId: USER_ID,
        scheduledAt: new Date('2026-10-12T15:00:00Z'),
        topic: 'Goals',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(createCoachingSession).not.toHaveBeenCalled();
  });

  it('allows same-organization colleagues and checks both coaching references before writing', async () => {
    const caller = await makeCaller();
    await caller.performance.submitFeedback({ toUserId: COLLEAGUE_ID, type: 'peer', message: 'Thanks' });
    await caller.performance.giveRecognition({ toUserId: COLLEAGUE_ID, category: 'teamwork', message: 'Thanks' });
    await caller.performance.createCoachingSession({
      employeeId: COLLEAGUE_ID,
      leaderId: USER_ID,
      scheduledAt: new Date('2026-10-12T15:00:00Z'),
      topic: 'Goals',
    });
    expect(userCount).toHaveBeenCalledWith({
      where: { id: { in: [COLLEAGUE_ID, USER_ID] }, organizationId: ORG_ID, isActive: true, deletedAt: null },
    });
    expect(createFeedback).toHaveBeenCalledOnce();
    expect(createRecognition).toHaveBeenCalledOnce();
    expect(createCoachingSession).toHaveBeenCalledOnce();
  });

  it('does not let a disabled or deleted member be referenced', async () => {
    userCount.mockResolvedValue(0);
    await expect(
      (await makeCaller()).performance.giveRecognition({
        toUserId: COLLEAGUE_ID,
        category: 'teamwork',
        message: 'Thanks',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(userCount).toHaveBeenCalledWith({
      where: { id: { in: [COLLEAGUE_ID] }, organizationId: ORG_ID, isActive: true, deletedAt: null },
    });
    expect(createRecognition).not.toHaveBeenCalled();
  });
});
