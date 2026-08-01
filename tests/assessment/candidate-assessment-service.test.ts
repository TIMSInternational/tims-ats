import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/candidate-assessment.repository', async () => {
  const actual = await vi.importActual<
    typeof import('../../packages/api/src/repositories/candidate-assessment.repository')
  >('../../packages/api/src/repositories/candidate-assessment.repository');
  return {
    ...actual,
    candidateAssessmentRepo: {
      findAssignmentsForCandidate: vi.fn(),
      findOwnedAssignment: vi.fn(),
      findQuestionsForType: vi.fn(),
      upsertConsent: vi.fn(),
      markStarted: vi.fn(),
    },
    candidateAssessmentWriteRepo: {
      findAssignmentInTx: vi.fn(),
      findQuestionsWithAnswerKeyInTx: vi.fn(),
      upsertResponseInTx: vi.fn(),
      upsertResultInTx: vi.fn(),
      completeAssignmentInTx: vi.fn(),
      getNormCountsInTx: vi.fn(),
    },
  };
});
vi.mock('../../packages/api/src/repositories/candidate-portal.repository', () => ({
  candidatePortalRepo: {
    findOrgBySlug: vi.fn(),
    findActiveCandidate: vi.fn(),
  },
}));
vi.mock('@tims/db', () => ({
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: (_o: string, f: (tx: unknown) => unknown) => f({}),
}));

import { candidateAssessmentService } from '../../packages/api/src/services/candidate-assessment.service';
import {
  candidateAssessmentRepo,
  candidateAssessmentWriteRepo,
} from '../../packages/api/src/repositories/candidate-assessment.repository';
import { candidatePortalRepo } from '../../packages/api/src/repositories/candidate-portal.repository';

const ORG = { id: 'org-1', name: 'TIMS', isActive: true };
const EMAIL = 'candidate@example.com';
const SLUG = 'tims';
const ASSIGNMENT_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(candidatePortalRepo.findOrgBySlug).mockResolvedValue(ORG as never);
});

// getMyAssessments/startAssessment/getAssessmentQuestions now live in
// candidate-assessment-lifecycle.service.ts — see
// tests/assessment/candidate-assessment-lifecycle-service.test.ts.

const SINGLE_CHOICE_Q = { id: 'q1', type: 'single_choice', correctOptionIds: ['b'], points: 5 };
const FREE_TEXT_Q = { id: 'q2', type: 'free_text', correctOptionIds: [], points: 20 };

describe('candidateAssessmentService.submitAssessment', () => {
  beforeEach(() => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
  });

  it('throws NOT_FOUND when the assignment is not owned (pre-check)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue(null);
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a double-submit against an already-completed assignment (pre-check)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'completed',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_already_completed' });
    expect(candidateAssessmentWriteRepo.findAssignmentInTx).not.toHaveBeenCalled();
  });

  it('rejects a double-submit caught only inside the transaction (race)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'completed',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_already_completed' });
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).not.toHaveBeenCalled();
  });

  it("rejects a questionId that does not belong to the assignment's assessmentTypeId", async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
    ] as never);
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'not-in-type', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'question_not_in_assessment' });
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).not.toHaveBeenCalled();
  });

  it('auto-scores MCQ, leaves free_text ungraded, and completes the assignment atomically', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
      FREE_TEXT_Q,
    ] as never);
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

    const result = await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
      { questionId: 'q1', selectedOptionIds: ['b'] },
      { questionId: 'q2', freeText: 'my essay' },
    ]);

    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledTimes(2);
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ questionId: 'q1', isCorrect: true, pointsAwarded: 5 }),
    );
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ questionId: 'q2', isCorrect: null, pointsAwarded: null, freeText: 'my essay' }),
    );
    expect(candidateAssessmentWriteRepo.upsertResultInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ rawScore: 5, normalizedScore: 100 }),
    );
    expect(candidateAssessmentWriteRepo.completeAssignmentInTx).toHaveBeenCalledWith(
      {},
      'org-1',
      'cand-1',
      ASSIGNMENT_ID,
    );
    expect(result).toEqual({ rawScore: 5, normalizedScore: 100, hasPending: true });
  });

  it('closes the double-submit race via the conditional final write (finding #1)', async () => {
    // Both assignments report in_progress (the early in-tx probe does NOT
    // catch this race under READ COMMITTED — see repository comment) but the
    // conditional completeAssignmentInTx updateMany matches 0 rows because a
    // concurrent winner already flipped the row to completed.
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
    ] as never);
    vi.mocked(candidateAssessmentWriteRepo.getNormCountsInTx).mockResolvedValue({
      countBelow: 0,
      countEqual: 0,
      sampleSize: 0,
    });
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 0 } as never);

    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_already_completed' });
    expect(candidateAssessmentWriteRepo.completeAssignmentInTx).toHaveBeenCalledWith(
      {},
      'org-1',
      'cand-1',
      ASSIGNMENT_ID,
    );
  });

  it('does not double-count a duplicate questionId in the submitted answers (finding #2a)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
    ] as never);
    vi.mocked(candidateAssessmentWriteRepo.getNormCountsInTx).mockResolvedValue({
      countBelow: 0,
      countEqual: 0,
      sampleSize: 0,
    });
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

    // q1 submitted twice — a correct answer then a wrong one. The Map keeps
    // the LAST occurrence, so the wrong one wins and only ONE response row
    // is written (not two, which would have doubled rawScore to 10).
    const result = await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
      { questionId: 'q1', selectedOptionIds: ['b'] },
      { questionId: 'q1', selectedOptionIds: ['a'] },
    ]);

    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledTimes(1);
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ questionId: 'q1', isCorrect: false, pointsAwarded: 0 }),
    );
    expect(result).toEqual({ rawScore: 0, normalizedScore: 0, hasPending: false });
  });

  it('counts an unanswered question in the denominator instead of yielding 100% (finding #2b)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    const SECOND_CHOICE_Q = { id: 'q3', type: 'single_choice', correctOptionIds: ['x'], points: 5 };
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
      SECOND_CHOICE_Q,
    ] as never);
    vi.mocked(candidateAssessmentWriteRepo.getNormCountsInTx).mockResolvedValue({
      countBelow: 0,
      countEqual: 0,
      sampleSize: 0,
    });
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

    // Only q1 (of 2 questions) is answered, correctly.
    const result = await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
      { questionId: 'q1', selectedOptionIds: ['b'] },
    ]);

    // Unanswered q3 still gets a response row (empty selection -> incorrect)
    // and lands in computeResult's denominator, so the score is 5/10 = 50%,
    // not 5/5 = 100%.
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledTimes(2);
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ questionId: 'q3', selectedOptionIds: [], isCorrect: false, pointsAwarded: 0 }),
    );
    expect(result).toEqual({ rawScore: 5, normalizedScore: 50, hasPending: false });
  });

  it('grades only against active questions and rejects a deactivated questionId (final review finding #1)', async () => {
    // Simulates the FIXED repo behavior: findQuestionsWithAnswerKeyInTx now
    // filters isActive: true (packages/api/src/repositories/candidate-assessment.repository.ts),
    // so a deactivated question is simply absent from the set the service
    // grades against — from the service's perspective, that's the same shape
    // as a completely nonexistent questionId. The mock here returns ONLY the
    // one active question; a second, deactivated question ('q-deactivated')
    // is deliberately NOT in the mock's returned set.
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
    ] as never);
    vi.mocked(candidateAssessmentWriteRepo.getNormCountsInTx).mockResolvedValue({
      countBelow: 0,
      countEqual: 0,
      sampleSize: 0,
    });
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

    // (a) A correct answer on the ONE active question yields normalizedScore
    // 100 — not diluted by a phantom deactivated question in the denominator.
    const result = await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
      { questionId: 'q1', selectedOptionIds: ['b'] },
    ]);
    expect(result).toEqual({ rawScore: 5, normalizedScore: 100, hasPending: false });

    // (b) Submitting an answer for the deactivated question ('q-deactivated',
    // absent from the filtered set) is rejected the same way as any other
    // unknown questionId — question_not_in_assessment, no partial write.
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q-deactivated', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'question_not_in_assessment' });
  });

  it('rejects a free_text answer that also supplies selectedOptionIds (finding #4)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([FREE_TEXT_Q] as never);

    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q2', freeText: 'my essay', selectedOptionIds: ['a'] },
      ]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'answer_type_mismatch' });
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).not.toHaveBeenCalled();
  });

  it('rejects a choice-question answer that supplies freeText instead of selectedOptionIds (finding #4)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
    ] as never);

    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', freeText: 'oops, wrong field' },
      ]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'answer_type_mismatch' });
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).not.toHaveBeenCalled();
  });

  it('computes and stores a norm band when the population meets MIN_NORM_SAMPLE_SIZE and the result is non-partial', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
    ] as never);
    vi.mocked(candidateAssessmentWriteRepo.getNormCountsInTx).mockResolvedValue({
      countBelow: 5,
      countEqual: 0,
      sampleSize: 5,
    });
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

    await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
      { questionId: 'q1', selectedOptionIds: ['b'] },
    ]);

    // Candidate scores 100 (normalizedScore for a correct single_choice answer),
    // population [20,30,40,50,60] -> percentile 100, band 'excellent'.
    expect(candidateAssessmentWriteRepo.upsertResultInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ percentile: 100, band: 'excellent', normSampleSize: 5 }),
    );
  });

  it('stores a null percentile/band/normSampleSize=0 when the population is below MIN_NORM_SAMPLE_SIZE', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
    ] as never);
    vi.mocked(candidateAssessmentWriteRepo.getNormCountsInTx).mockResolvedValue({
      countBelow: 2,
      countEqual: 0,
      sampleSize: 2,
    });
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

    await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
      { questionId: 'q1', selectedOptionIds: ['b'] },
    ]);

    expect(candidateAssessmentWriteRepo.upsertResultInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ percentile: null, band: null, normSampleSize: 2 }),
    );
  });

  it('never queries the population or stores a band when the result is partial (has a pending essay)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
      SINGLE_CHOICE_Q,
      FREE_TEXT_Q,
    ] as never);
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

    await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
      { questionId: 'q1', selectedOptionIds: ['b'] },
      { questionId: 'q2', freeText: 'my essay' },
    ]);

    expect(candidateAssessmentWriteRepo.getNormCountsInTx).not.toHaveBeenCalled();
    expect(candidateAssessmentWriteRepo.upsertResultInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ percentile: null, band: null, normSampleSize: null }),
    );
  });
});
