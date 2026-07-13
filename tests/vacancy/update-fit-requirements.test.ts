import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 1.5 Codex-review fix (Finding 1) — vacancy.updateFitRequirements.
// Writes a NEW, dedicated structured requirements field for the FIT Engine
// (jobProfile.fitRequirements: { minYearsExperience?, requiredEducationLevel?,
// requiredLanguages? }), separate from JobProfile.requirements (the existing
// free-text HR checklist array edited via vacancy.updateJobProfile). Before
// this fix, fitEngineService.computeFitScore read the free-text field and
// could never recognize it, so experience/education/languages were always
// null for any real vacancy.

const jobProfileUpsert = vi.fn();
vi.mock('@tims/db', () => ({
  tenantDb: { jobProfile: { upsert: (...a: unknown[]) => jobProfileUpsert(...a) } },
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
  } as never) as unknown as {
    vacancy: {
      updateFitRequirements(input: {
        vacancyId: string;
        minYearsExperience?: number;
        requiredEducationLevel?: string;
        requiredLanguages?: string[];
      }): Promise<{ id: string; vacancyId: string; fitRequirements: unknown }>;
    };
  };
}

beforeEach(() => vi.clearAllMocks());

describe('vacancy.updateFitRequirements', () => {
  it('upserts jobProfile.fitRequirements scoped to the vacancy, distinct from the free-text requirements field', async () => {
    jobProfileUpsert.mockResolvedValue({
      id: 'jp-1', vacancyId: VACANCY_ID,
      fitRequirements: { minYearsExperience: 3, requiredEducationLevel: 'bachelor', requiredLanguages: ['English'] },
    });
    const caller = await makeCaller();

    const result = await caller.vacancy.updateFitRequirements({
      vacancyId: VACANCY_ID,
      minYearsExperience: 3,
      requiredEducationLevel: 'bachelor',
      requiredLanguages: ['English'],
    });

    expect(result.fitRequirements).toEqual({ minYearsExperience: 3, requiredEducationLevel: 'bachelor', requiredLanguages: ['English'] });
    expect(jobProfileUpsert).toHaveBeenCalledWith({
      where: { vacancyId: VACANCY_ID },
      create: {
        organizationId: ORG_ID,
        vacancyId: VACANCY_ID,
        fitRequirements: { minYearsExperience: 3, requiredEducationLevel: 'bachelor', requiredLanguages: ['English'] },
      },
      update: { fitRequirements: { minYearsExperience: 3, requiredEducationLevel: 'bachelor', requiredLanguages: ['English'] } },
      select: { id: true, vacancyId: true, fitRequirements: true },
    });
  });

  it('omits unset fields from the persisted JSON object rather than writing them as null', async () => {
    jobProfileUpsert.mockResolvedValue({ id: 'jp-1', vacancyId: VACANCY_ID, fitRequirements: { minYearsExperience: 5 } });
    const caller = await makeCaller();

    await caller.vacancy.updateFitRequirements({ vacancyId: VACANCY_ID, minYearsExperience: 5 });

    expect(jobProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { fitRequirements: { minYearsExperience: 5 } },
      }),
    );
  });

  it('rejects an invalid requiredEducationLevel', async () => {
    const caller = await makeCaller();
    await expect(
      caller.vacancy.updateFitRequirements({ vacancyId: VACANCY_ID, requiredEducationLevel: 'not-a-level' }),
    ).rejects.toThrow();
    expect(jobProfileUpsert).not.toHaveBeenCalled();
  });
});
