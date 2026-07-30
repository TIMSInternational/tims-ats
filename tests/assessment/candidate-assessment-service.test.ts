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

describe('candidateAssessmentService.getMyAssessments', () => {
  it('throws NOT_FOUND for a missing/inactive org', async () => {
    vi.mocked(candidatePortalRepo.findOrgBySlug).mockResolvedValue(null);
    await expect(candidateAssessmentService.getMyAssessments(EMAIL, SLUG)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns an empty list when the session email has no candidate at this org', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue(null);
    expect(await candidateAssessmentService.getMyAssessments(EMAIL, SLUG)).toEqual([]);
    expect(candidateAssessmentRepo.findAssignmentsForCandidate).not.toHaveBeenCalled();
  });

  it("returns the candidate's assignments", async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findAssignmentsForCandidate).mockResolvedValue([{ id: 'a1' }] as never);
    expect(await candidateAssessmentService.getMyAssessments(EMAIL, SLUG)).toEqual([{ id: 'a1' }]);
  });
});

describe('candidateAssessmentService.startAssessment', () => {
  it('rejects when consentAccepted is not true, before any write', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    await expect(
      candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, false, null, null),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'consent_required' });
    expect(candidateAssessmentRepo.upsertConsent).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the assignment is not owned by this candidate', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue(null);
    await expect(
      candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, null, null),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an expired assignment', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'assigned',
      expiresAt: new Date('2020-01-01'),
      assessmentTypeId: 'type-1',
    } as never);
    await expect(
      candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, null, null),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_expired' });
    expect(candidateAssessmentRepo.markStarted).not.toHaveBeenCalled();
  });

  it('rejects a completed/cancelled assignment (out of {assigned, in_progress})', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'completed',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    await expect(
      candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, null, null),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_not_startable' });
  });

  it('records consent then marks in_progress on first start', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'assigned',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentRepo.markStarted).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
    } as never);

    const result = await candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, '1.2.3.4', 'ua');

    expect(candidateAssessmentRepo.upsertConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: ASSIGNMENT_ID,
        candidateId: 'cand-1',
        ipAddress: '1.2.3.4',
        userAgent: 'ua',
      }),
    );
    expect(candidateAssessmentRepo.markStarted).toHaveBeenCalledWith(ASSIGNMENT_ID);
    expect(result).toEqual({ id: ASSIGNMENT_ID, status: 'in_progress' });
  });

  it('is idempotent when already in_progress — re-marks started without erroring', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentRepo.markStarted).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
    } as never);

    const result = await candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, null, null);
    expect(result.status).toBe('in_progress');
  });
});

describe('candidateAssessmentService.getAssessmentQuestions', () => {
  it('throws NOT_FOUND when the assignment is not owned by this candidate', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue(null);
    await expect(candidateAssessmentService.getAssessmentQuestions(EMAIL, SLUG, ASSIGNMENT_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects when the assignment has not been started', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'assigned',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    await expect(candidateAssessmentService.getAssessmentQuestions(EMAIL, SLUG, ASSIGNMENT_ID)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'assignment_not_in_progress',
    });
  });

  it('rejects an expired in_progress assignment', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: new Date('2020-01-01'),
      assessmentTypeId: 'type-1',
    } as never);
    await expect(candidateAssessmentService.getAssessmentQuestions(EMAIL, SLUG, ASSIGNMENT_ID)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'assignment_expired',
    });
  });

  it("returns the assessment type's questions without correctOptionIds", async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    const questions = [
      { id: 'q1', order: 0, type: 'single_choice', prompt: 'p', options: [{ id: 'a', label: 'A' }], points: 1 },
    ];
    vi.mocked(candidateAssessmentRepo.findQuestionsForType).mockResolvedValue(questions as never);

    const result = await candidateAssessmentService.getAssessmentQuestions(EMAIL, SLUG, ASSIGNMENT_ID);

    expect(result).toEqual(questions);
    expect(JSON.stringify(result)).not.toContain('correctOptionIds');
    expect(candidateAssessmentRepo.findQuestionsForType).toHaveBeenCalledWith('org-1', 'type-1');
  });
});

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
    expect(candidateAssessmentWriteRepo.completeAssignmentInTx).toHaveBeenCalledWith({}, ASSIGNMENT_ID);
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
    vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 0 } as never);

    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_already_completed' });
    expect(candidateAssessmentWriteRepo.completeAssignmentInTx).toHaveBeenCalledWith({}, ASSIGNMENT_ID);
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
});
