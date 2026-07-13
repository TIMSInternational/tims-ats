import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 1.5 Task 3 — fitEngineRouter. Gated by fit_engine:{read,create,update};
// vacancy-scoped operations additionally probe assertScoped('vacancy', ...) so
// hrbp (unit) / leader (team) grants are correctly fenced to their vacancies.

const computeFitScoreMock = vi.fn();
const getRankingForVacancyMock = vi.fn();
const simulateWeightsMock = vi.fn();
const upsertWeightProfileMock = vi.fn();
const listWeightProfilesMock = vi.fn();
const computeForVacancyMock = vi.fn();
const getFitScoreForExplainMock = vi.fn();

vi.mock('../../packages/api/src/services/fit-engine.service', () => ({
  fitEngineService: {
    computeFitScore: (...a: unknown[]) => computeFitScoreMock(...a),
    getRankingForVacancy: (...a: unknown[]) => getRankingForVacancyMock(...a),
    simulateWeights: (...a: unknown[]) => simulateWeightsMock(...a),
    upsertWeightProfile: (...a: unknown[]) => upsertWeightProfileMock(...a),
    listWeightProfiles: (...a: unknown[]) => listWeightProfilesMock(...a),
    computeForVacancy: (...a: unknown[]) => computeForVacancyMock(...a),
    getFitScoreForExplain: (...a: unknown[]) => getFitScoreForExplainMock(...a),
  },
  FIT_DIMENSIONS: ['assessment', 'interview', 'experience', 'education', 'languages'],
}));

const explainFitMock = vi.fn();
vi.mock('@tims/ai', () => ({ explainFit: (...a: unknown[]) => explainFitMock(...a) }));

const accessAllowed = vi.hoisted(() => ({ value: true }));
function setAccessAllowed(value: boolean) {
  accessAllowed.value = value;
}
const buildAccessForUserMock = vi.hoisted(() =>
  vi.fn(async () =>
    accessAllowed.value ? { allowed: true, scope: 'organization', roles: ['hr_admin'] } : { allowed: false },
  ),
);
const assertScopedMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>('../../packages/api/src/access');
  return {
    ...actual,
    buildAccessForUser: buildAccessForUserMock,
    assertScoped: assertScopedMock,
    scopeWhereFor: vi.fn().mockResolvedValue({}),
  };
});

// The tenant-context middleware in trpc.ts validates organizationId as a real
// UUID (defense-in-depth before it becomes the RLS GUC value), and the
// router's Zod input schema requires vacancyId to be a UUID too — so these
// must be well-formed UUIDs, not the placeholder-style ids other test suites
// occasionally use.
const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const CANDIDATE_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { fitEngineRouter } = await import('../../packages/api/src/routers/fit-engine');
  const testRouter = router({ fitEngine: fitEngineRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: { id: 'user-1', organizationId: ORG_ID, roles: ['hr_admin'], isPlatformOwner: false, impersonatorId: null, email: 'hr@tims.co', isActive: true },
    headers: new Headers(), supabaseAuth: null, externalAuth: null,
  } as never) as unknown as {
    fitEngine: {
      getRankingForVacancy(input: { vacancyId: string }): Promise<unknown>;
      computeForVacancy(input: { vacancyId: string }): Promise<{ computed: number }>;
      simulateWeights(input: { vacancyId: string; hypotheticalWeights: Record<string, number> }): Promise<unknown>;
      upsertRoleFamilyWeightProfile(input: { name: string; weights: Record<string, number> }): Promise<unknown>;
      listRoleFamilyWeightProfiles(): Promise<unknown>;
      explainFit(input: { candidateId: string; vacancyId: string }): Promise<{ narrative: string; model: string }>;
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAccessAllowed(true);
});

describe('fitEngine.getRankingForVacancy', () => {
  it('scopes the vacancy before returning the ranking', async () => {
    getRankingForVacancyMock.mockResolvedValue([{ candidateId: 'c1', overallScore: 90 }]);
    const caller = await makeCaller();
    const result = await caller.fitEngine.getRankingForVacancy({ vacancyId: VACANCY_ID });
    expect(assertScopedMock).toHaveBeenCalledWith('vacancy', VACANCY_ID, expect.anything(), 'user-1', ORG_ID);
    expect(getRankingForVacancyMock).toHaveBeenCalledWith(ORG_ID, VACANCY_ID);
    expect(result).toEqual([{ candidateId: 'c1', overallScore: 90 }]);
  });

  it('throws FORBIDDEN and never queries when the caller lacks fit_engine:read', async () => {
    setAccessAllowed(false);
    const caller = await makeCaller();
    await expect(caller.fitEngine.getRankingForVacancy({ vacancyId: VACANCY_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getRankingForVacancyMock).not.toHaveBeenCalled();
  });
});

describe('fitEngine.computeForVacancy', () => {
  it('triggers a bulk recompute for the vacancy pipeline', async () => {
    computeForVacancyMock.mockResolvedValue({ computed: 3 });
    const caller = await makeCaller();
    const result = await caller.fitEngine.computeForVacancy({ vacancyId: VACANCY_ID });
    expect(result).toEqual({ computed: 3 });
    expect(computeForVacancyMock).toHaveBeenCalledWith(ORG_ID, VACANCY_ID);
  });
});

describe('fitEngine.simulateWeights', () => {
  const weights = { assessment: 0.2, interview: 0.2, experience: 0.2, education: 0.2, languages: 0.2 };

  it('rejects a weight set that does not sum to 1.0', async () => {
    const caller = await makeCaller();
    await expect(
      caller.fitEngine.simulateWeights({ vacancyId: VACANCY_ID, hypotheticalWeights: { ...weights, assessment: 0.9 } }),
    ).rejects.toThrow();
    expect(simulateWeightsMock).not.toHaveBeenCalled();
  });

  it('accepts a weight set that sums to 1.0 and never mutates', async () => {
    simulateWeightsMock.mockResolvedValue([{ candidateId: 'c1', simulatedScore: 77 }]);
    const caller = await makeCaller();
    const result = await caller.fitEngine.simulateWeights({ vacancyId: VACANCY_ID, hypotheticalWeights: weights });
    expect(result).toEqual([{ candidateId: 'c1', simulatedScore: 77 }]);
    expect(simulateWeightsMock).toHaveBeenCalledWith(ORG_ID, VACANCY_ID, weights);
  });
});

describe('fitEngine.upsertRoleFamilyWeightProfile', () => {
  const weights = { assessment: 0.3, interview: 0.3, experience: 0.2, education: 0.1, languages: 0.1 };

  it('rejects an invalid weight profile name or sum', async () => {
    const caller = await makeCaller();
    await expect(
      caller.fitEngine.upsertRoleFamilyWeightProfile({ name: 'sales', weights: { ...weights, assessment: 0.5 } }),
    ).rejects.toThrow();
  });

  it('persists a valid profile', async () => {
    upsertWeightProfileMock.mockResolvedValue({ id: 'p1', name: 'sales', weights });
    const caller = await makeCaller();
    const result = await caller.fitEngine.upsertRoleFamilyWeightProfile({ name: 'sales', weights });
    expect(result).toEqual({ id: 'p1', name: 'sales', weights });
    expect(upsertWeightProfileMock).toHaveBeenCalledWith(ORG_ID, 'sales', weights);
  });
});

describe('fitEngine.explainFit', () => {
  it('404s when no FitScore exists yet for this candidate+vacancy', async () => {
    getFitScoreForExplainMock.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(
      caller.fitEngine.explainFit({ candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(explainFitMock).not.toHaveBeenCalled();
  });

  it('calls explainFit with the stored breakdown and returns the narrative', async () => {
    getFitScoreForExplainMock.mockResolvedValue({
      overallScore: 78,
      breakdown: { assessment: null, interview: 85, experience: 90, education: 100, languages: 40, llmJudgment: null },
      candidateName: 'Ana Gomez',
      vacancyTitle: 'Sales Director',
    });
    explainFitMock.mockResolvedValue({ result: { narrative: 'Solid interview performance.' }, model: 'sonnet' });

    const caller = await makeCaller();
    const result = await caller.fitEngine.explainFit({ candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID });

    expect(result).toEqual({ narrative: 'Solid interview performance.', model: 'sonnet' });
    expect(explainFitMock).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ overallScore: 78 }));
  });
});
