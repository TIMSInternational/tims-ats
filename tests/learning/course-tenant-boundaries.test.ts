import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const findCourse = vi.fn();
const countCourses = vi.fn();
const createEnrollment = vi.fn();
const bulkEnroll = vi.fn();
const createPath = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    course: { findFirst: findCourse, count: countCourses },
    enrollment: { create: createEnrollment, createMany: bulkEnroll },
    learningPath: { create: createPath },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertSubjectInScope: vi.fn().mockResolvedValue(undefined),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { learningRouter } = await import('../../packages/api/src/routers/learning');
  return createCallerFactory(router({ learning: learningRouter }))({
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
  findCourse.mockResolvedValue(null);
  countCourses.mockResolvedValue(0);
});

describe('learning catalog tenant boundaries', () => {
  it('cannot enroll a user into a course outside the current organization', async () => {
    await expect((await caller()).learning.enrollUser({ userId: USER_ID, courseId: COURSE_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(findCourse).toHaveBeenCalledWith({ where: { id: COURSE_ID, organizationId: ORG_ID, isActive: true }, select: { id: true } });
    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it('cannot bulk enroll into a foreign course', async () => {
    await expect((await caller()).learning.bulkEnroll({ userIds: [USER_ID], courseId: COURSE_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(bulkEnroll).not.toHaveBeenCalled();
  });

  it('cannot attach a foreign course to a learning path', async () => {
    await expect((await caller()).learning.createPath({ name: 'QA path', courseIds: [COURSE_ID] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(countCourses).toHaveBeenCalledWith({ where: { id: { in: [COURSE_ID] }, organizationId: ORG_ID, isActive: true } });
    expect(createPath).not.toHaveBeenCalled();
  });
});
