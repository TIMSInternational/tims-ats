import { beforeEach, describe, expect, it, vi } from 'vitest';

// FIT v2 integrity: assessment.cancel used to check the status and then update by id with no status predicate, so a
// submission committing between the two left a 'cancelled' assignment holding a result. The write is now conditional
// on the status (assigned / in_progress) and refuses with CONFLICT when the assignment moved on.
vi.mock('../../packages/api/src/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/api/src/access')>();
  return {
    ...actual,
    buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['recruiter'] }),
    createAnchorLoader: vi.fn().mockReturnValue(null),
    assertScoped: vi.fn().mockResolvedValue(undefined),
    scopeWhereFor: vi.fn().mockResolvedValue({}),
  };
});
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));
vi.mock('@tims/db', () => ({
  db: { auditLog: { create: vi.fn().mockResolvedValue({}) } },
  tenantDb: {
    assessmentAssignment: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

import { tenantDb } from '@tims/db';

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const ASSIGNMENT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a09';

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { assessmentRouter } = await import('../../packages/api/src/routers/assessment');
  return createCallerFactory(router({ assessment: assessmentRouter }))({
    user: {
      id: 'staff-1',
      organizationId: ORG_ID,
      roles: ['recruiter'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'staff@example.com',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as {
    assessment: { cancel(input: { assignmentId: string }): Promise<{ id: string; status: string }> };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenantDb.assessmentAssignment.findFirst).mockResolvedValue({
    id: ASSIGNMENT_ID,
    organizationId: ORG_ID,
    status: 'in_progress',
  } as never);
});

describe('assessment.cancel', () => {
  it('cancels with ONE conditional write that carries the status predicate, never an unconditional update', async () => {
    vi.mocked(tenantDb.assessmentAssignment.updateMany).mockResolvedValue({ count: 1 } as never);

    const result = await (await makeCaller()).assessment.cancel({ assignmentId: ASSIGNMENT_ID });

    expect(result).toMatchObject({ id: ASSIGNMENT_ID, status: 'cancelled' });
    expect(tenantDb.assessmentAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: ASSIGNMENT_ID, organizationId: ORG_ID, status: { in: ['assigned', 'in_progress'] } },
      data: { status: 'cancelled' },
    });
    expect(tenantDb.assessmentAssignment.update).not.toHaveBeenCalled();
  });

  it('a submission that completed the assignment after the check wins: CONFLICT, nothing cancelled', async () => {
    // The check saw 'in_progress'; by the write the submission had committed 'completed', so 0 rows match.
    vi.mocked(tenantDb.assessmentAssignment.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect((await makeCaller()).assessment.cancel({ assignmentId: ASSIGNMENT_ID })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(tenantDb.assessmentAssignment.update).not.toHaveBeenCalled();
  });

  it('an assignment already completed or cancelled at the check is still NOT_FOUND', async () => {
    vi.mocked(tenantDb.assessmentAssignment.findFirst).mockResolvedValue(null);
    await expect((await makeCaller()).assessment.cancel({ assignmentId: ASSIGNMENT_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(tenantDb.assessmentAssignment.updateMany).not.toHaveBeenCalled();
  });
});
