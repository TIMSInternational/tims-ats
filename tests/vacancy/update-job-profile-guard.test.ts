import { describe, it, expect, vi, beforeEach } from 'vitest';

// Codex round 9 on #421 (P2): vacancy.updateJobProfile must not change the scorecard rubric (competencies)
// while an approval is pending or the vacancy is closed. It now routes competencies through the same
// guarded, audited write as vacancy.update (vacancyLifecycleRepository.updateContent).

const jobProfileUpsert = vi.fn();
vi.mock('@tims/db', () => ({
  tenantDb: { jobProfile: { upsert: (...a: unknown[]) => jobProfileUpsert(...a) } },
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));
const updateContent = vi.hoisted(() => vi.fn());
vi.mock('../../packages/api/src/repositories/vacancy-lifecycle.repository', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/repositories/vacancy-lifecycle.repository')>(
    '../../packages/api/src/repositories/vacancy-lifecycle.repository',
  );
  return { ...actual, vacancyLifecycleRepository: { ...actual.vacancyLifecycleRepository, updateContent } };
});
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
  const callerFactory = createCallerFactory(router({ vacancy: vacancyRouter }));
  return callerFactory({
    user: { id: 'user-1', organizationId: ORG_ID, roles: ['hr_admin'], isPlatformOwner: false, impersonatorId: null, email: 'hr@tims.co', isActive: true },
    headers: new Headers(), supabaseAuth: null, externalAuth: null,
  } as never) as unknown as {
    vacancy: { updateJobProfile(input: Record<string, unknown>): Promise<unknown> };
  };
}

beforeEach(() => vi.clearAllMocks());

describe('vacancy.updateJobProfile competencies guard', () => {
  it('refuses a competencies change when the guarded write says the vacancy is not editable', async () => {
    updateContent.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(
      caller.vacancy.updateJobProfile({ vacancyId: VACANCY_ID, competencies: [{ name: 'Liderazgo', level: 3 }] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(updateContent).toHaveBeenCalledWith(ORG_ID, VACANCY_ID, {}, ['competencies'], expect.anything(), expect.anything());
    expect(jobProfileUpsert).not.toHaveBeenCalled();
  });

  it('never writes competencies through the bare upsert', async () => {
    updateContent.mockResolvedValue({ id: VACANCY_ID });
    jobProfileUpsert.mockResolvedValue({ id: 'jp-1' });
    const caller = await makeCaller();
    await caller.vacancy.updateJobProfile({ vacancyId: VACANCY_ID, competencies: [{ name: 'Liderazgo', level: 3 }] });
    const args = jobProfileUpsert.mock.calls[0]?.[0] as { update: Record<string, unknown> } | undefined;
    expect(args?.update.competencies).toBeUndefined();
  });

  it('leaves other job-profile fields on the existing path when no competencies are sent', async () => {
    jobProfileUpsert.mockResolvedValue({ id: 'jp-1' });
    const caller = await makeCaller();
    await caller.vacancy.updateJobProfile({ vacancyId: VACANCY_ID, kpis: [] });
    expect(updateContent).not.toHaveBeenCalled();
    expect(jobProfileUpsert).toHaveBeenCalledTimes(1);
  });
});
