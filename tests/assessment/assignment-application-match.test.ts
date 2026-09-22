import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const findType = vi.fn();
const findCandidate = vi.fn();
const findApplication = vi.fn();
const createAssignment = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    assessmentType: { findFirst: findType },
    candidate: { findFirst: findCandidate },
    application: { findFirst: findApplication },
    assessmentAssignment: { create: createAssignment },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { assessmentRouter } = await import('../../packages/api/src/routers/assessment');
  return createCallerFactory(router({ assessment: assessmentRouter }))({
    user: {
      id: '22222222-2222-2222-2222-222222222222', organizationId: ORG_ID,
      roles: ['hr_admin'], isPlatformOwner: false, impersonatorId: null,
      email: 'hr@example.com', isActive: true,
    },
    headers: new Headers(), supabaseAuth: null, externalAuth: null,
  } as never);
}

const input = {
  candidateId: '33333333-3333-3333-3333-333333333333',
  vacancyId: '44444444-4444-4444-4444-444444444444',
  assessmentTypeId: '55555555-5555-5555-5555-555555555555',
};

beforeEach(() => {
  vi.clearAllMocks();
  findType.mockResolvedValue({ id: input.assessmentTypeId });
  findCandidate.mockResolvedValue({ id: input.candidateId });
  findApplication.mockResolvedValue(null);
  createAssignment.mockResolvedValue({ id: 'assignment-1' });
});

describe('assessment assignment vacancy linkage', () => {
  it('rejects assignment when the candidate has no active application to the vacancy', async () => {
    await expect((await caller()).assessment.assign(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(createAssignment).not.toHaveBeenCalled();
  });

  it('creates an assignment for a candidate actively applying to the vacancy', async () => {
    findApplication.mockResolvedValue({ id: 'application-1' });
    await (await caller()).assessment.assign(input);
    expect(createAssignment).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: input.candidateId, vacancyId: input.vacancyId, assessmentTypeId: input.assessmentTypeId, organizationId: ORG_ID }),
    }));
  });
});
