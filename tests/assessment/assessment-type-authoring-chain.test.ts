/**
 * F13 end-to-end SEAM chain: a type created by the C# authoring surface → questions authored on it (TS
 * assessmentQuestionService) → the assign gate the candidate-profile path (#273) runs → candidate submits
 * (TS candidateAssessmentService) → score computed.
 *
 * HONEST SCOPE. The chain crosses two runtimes, so no single process runs all of it:
 *  - C# create/update/deactivate against real Postgres + RLS is proved by
 *    services/Tims.Platform/tests/Tims.IntegrationTests/AssessmentTypes/AssessmentTypeWriteEndpointTests.cs.
 *  - Here, the C# → web seam is the exact response shape that test asserts, parsed by the FE's strict zod
 *    schema; every TS step after it runs the REAL service code over an in-memory store that stands in for
 *    Prisma (repositories mocked). What is NOT exercised here: Prisma SQL, RLS, and the tRPC router glue of
 *    `assessment.assign` beyond its `assertHasActiveQuestions` gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface StoredQuestion {
  id: string;
  organizationId: string;
  assessmentTypeId: string;
  type: string;
  correctOptionIds: string[];
  points: number;
  isActive: boolean;
}

const store = vi.hoisted(() => ({
  types: [] as { id: string; organizationId: string; isActive: boolean }[],
  questions: [] as StoredQuestion[],
  results: [] as Record<string, unknown>[],
}));

vi.mock('../../packages/api/src/repositories/assessment-question.repository', () => ({
  assessmentQuestionRepo: {
    findTypeById: vi.fn(
      async (orgId: string, id: string) => store.types.find((t) => t.id === id && t.organizationId === orgId) ?? null,
    ),
    create: vi.fn(async (data: Omit<StoredQuestion, 'id' | 'isActive'>) => {
      const row = { ...data, id: `q-${store.questions.length + 1}`, isActive: true };
      store.questions.push(row);
      return row;
    }),
    countActiveQuestions: vi.fn(
      async (orgId: string, typeId: string) =>
        store.questions.filter((q) => q.organizationId === orgId && q.assessmentTypeId === typeId && q.isActive).length,
    ),
  },
}));

vi.mock('../../packages/api/src/repositories/candidate-assessment.repository', async () => {
  const actual = await vi.importActual<
    typeof import('../../packages/api/src/repositories/candidate-assessment.repository')
  >('../../packages/api/src/repositories/candidate-assessment.repository');
  return {
    ...actual,
    candidateAssessmentRepo: { findOwnedAssignment: vi.fn() },
    candidateAssessmentWriteRepo: {
      findAssignmentInTx: vi.fn(),
      findQuestionsWithAnswerKeyInTx: vi.fn(async (_tx: unknown, orgId: string, typeId: string) =>
        store.questions.filter((q) => q.organizationId === orgId && q.assessmentTypeId === typeId && q.isActive),
      ),
      upsertResponseInTx: vi.fn(),
      upsertResultInTx: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => {
        store.results.push(data);
      }),
      completeAssignmentInTx: vi.fn(async () => ({ count: 1 })),
      getNormCountsInTx: vi.fn(async () => ({ countBelow: 0, countEqual: 0, sampleSize: 0 })),
    },
  };
});
vi.mock('../../packages/api/src/repositories/candidate-portal.repository', () => ({
  candidatePortalRepo: {
    findOrgBySlug: vi.fn(async () => ({ id: ORG_A, name: 'Acme', isActive: true })),
    findActiveCandidate: vi.fn(async () => ({ id: 'cand-1' })),
  },
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
vi.mock('@tims/db', () => ({
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: (_o: string, f: (tx: unknown) => unknown) => f({}),
}));

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const TYPE_ID = '7a000000-0000-0000-0000-00000000c0de';
const ASSIGNMENT_ID = '33333333-3333-3333-3333-333333333333';

// The body POST /assessments/types returns (AssessmentTypeWriteEndpointTests.Create_Admin_Is200_... asserts
// code/organizationId/isActive/createdAt on this exact shape).
const csharpCreateResponse = {
  id: TYPE_ID,
  organizationId: ORG_A,
  name: 'Prueba Lógica Alfa',
  code: 'prueba_logica_alfa',
  description: 'Razonamiento',
  duration: 30,
  isActive: true,
  createdAt: '2026-09-29T12:00:00.000Z',
  updatedAt: '2026-09-29T12:00:00.000Z',
};

beforeEach(() => {
  store.types.length = 0;
  store.questions.length = 0;
  store.results.length = 0;
});

describe('F13 chain: create type → add questions → assign gate → submit → score', () => {
  it('runs every TS seam on a type created through the C# authoring surface', async () => {
    const { assessmentTypeRowSchema } = await import('../../apps/web/lib/platform-api/assessment-types');
    const { assessmentQuestionService } = await import('../../packages/api/src/services/assessment-question.service');
    const { candidateAssessmentService } = await import('../../packages/api/src/services/candidate-assessment.service');
    const { candidateAssessmentRepo, candidateAssessmentWriteRepo } =
      await import('../../packages/api/src/repositories/candidate-assessment.repository');

    // 1. C# → web seam: the FE accepts the create response; the row now exists in the org's catalog.
    const created = assessmentTypeRowSchema.parse(csharpCreateResponse);
    store.types.push({ id: created.id, organizationId: created.organizationId, isActive: created.isActive });

    // 2. Before any question exists, the assign gate (#273 path) refuses the type.
    await expect(assessmentQuestionService.assertHasActiveQuestions(ORG_A, created.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'assessment_has_no_questions',
    });

    // 3. Author two scorable questions on the new type (existing authoring path).
    const q1 = await assessmentQuestionService.create(ORG_A, {
      assessmentTypeId: created.id,
      type: 'single_choice',
      prompt: '2 + 2 = ?',
      options: [
        { id: 'a', label: '3' },
        { id: 'b', label: '4' },
      ],
      correctOptionIds: ['b'],
      points: 4,
      order: 0,
    });
    const q2 = await assessmentQuestionService.create(ORG_A, {
      assessmentTypeId: created.id,
      type: 'multi_choice',
      prompt: 'Primes?',
      options: [
        { id: 'x', label: '2' },
        { id: 'y', label: '3' },
        { id: 'z', label: '4' },
      ],
      correctOptionIds: ['x', 'y'],
      points: 6,
      order: 1,
    });

    // Tenant boundary: another org cannot author on this type.
    await expect(
      assessmentQuestionService.create(ORG_B, {
        assessmentTypeId: created.id,
        type: 'single_choice',
        prompt: 'x',
        options: [
          { id: 'a', label: 'a' },
          { id: 'b', label: 'b' },
        ],
        correctOptionIds: ['a'],
        points: 1,
        order: 0,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // 4. Assign gate now passes.
    await expect(assessmentQuestionService.assertHasActiveQuestions(ORG_A, created.id)).resolves.toBeUndefined();

    // 5. Candidate submits against an assignment of that type → score computed from the authored answer key.
    const assignment = { id: ASSIGNMENT_ID, status: 'in_progress', expiresAt: null, assessmentTypeId: created.id };
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue(assignment as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue(assignment as never);

    const result = await candidateAssessmentService.submitAssessment('cand@example.com', 'acme', ASSIGNMENT_ID, [
      { questionId: q1.id, selectedOptionIds: ['b'] }, // correct: 4 pts
      { questionId: q2.id, selectedOptionIds: ['x'] }, // incomplete multi: 0 pts
    ]);

    expect(result).toEqual({ rawScore: 4, normalizedScore: 40, hasPending: false });
    expect(store.results).toHaveLength(1);
    expect(store.results[0]).toMatchObject({ rawScore: 4, normalizedScore: 40 });
  });

  it('the web seam rejects a C# response that drifts from the contract', async () => {
    const { assessmentTypeRowSchema } = await import('../../apps/web/lib/platform-api/assessment-types');
    expect(() => assessmentTypeRowSchema.parse({ ...csharpCreateResponse, config: {} })).toThrow();
    expect(() => assessmentTypeRowSchema.parse({ ...csharpCreateResponse, createdAt: '2026-09-29 12:00' })).toThrow();
  });
});
