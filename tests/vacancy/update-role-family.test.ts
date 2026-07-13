import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 1.5 Task 9 — vacancy.updateRoleFamily. Assigns a vacancy to a named
// role-family weight profile (or clears it back to Default) so its FIT scores
// use the corresponding weights from Task 3's fitEngineRouter.

const vacancyUpdate = vi.fn();
vi.mock('@tims/db', () => ({
  tenantDb: { vacancy: { update: (...a: unknown[]) => vacancyUpdate(...a) } },
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));

const buildAccessForUserMock = vi.hoisted(() => vi.fn(async () => ({ allowed: true, scope: 'organization', roles: ['hr_admin'] })));
vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>('../../packages/api/src/access');
  return { ...actual, buildAccessForUser: buildAccessForUserMock, assertScoped: vi.fn().mockResolvedValue(undefined), scopeWhereFor: vi.fn().mockResolvedValue({}) };
});

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyRouter } = await import('../../packages/api/src/routers/vacancy');
  const testRouter = router({ vacancy: vacancyRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: { id: 'user-1', organizationId: ORG_ID, roles: ['hr_admin'], isPlatformOwner: false, impersonatorId: null, email: 'hr@tims.co', isActive: true },
    headers: new Headers(), supabaseAuth: null, externalAuth: null,
  } as never) as unknown as { vacancy: { updateRoleFamily(input: { vacancyId: string; roleFamily: string | null }): Promise<{ id: string; roleFamily: string | null }> } };
}

beforeEach(() => vi.clearAllMocks());

describe('vacancy.updateRoleFamily', () => {
  it('updates roleFamily scoped to the org', async () => {
    vacancyUpdate.mockResolvedValue({ id: VACANCY_ID, roleFamily: 'sales' });
    const caller = await makeCaller();
    const result = await caller.vacancy.updateRoleFamily({ vacancyId: VACANCY_ID, roleFamily: 'sales' });
    expect(result).toEqual({ id: VACANCY_ID, roleFamily: 'sales' });
    expect(vacancyUpdate).toHaveBeenCalledWith({
      where: { id: VACANCY_ID, organizationId: ORG_ID },
      data: { roleFamily: 'sales' },
      select: { id: true, roleFamily: true },
    });
  });

  it('allows clearing roleFamily by passing null', async () => {
    vacancyUpdate.mockResolvedValue({ id: VACANCY_ID, roleFamily: null });
    const caller = await makeCaller();
    const result = await caller.vacancy.updateRoleFamily({ vacancyId: VACANCY_ID, roleFamily: null });
    expect(result.roleFamily).toBeNull();
  });
});
