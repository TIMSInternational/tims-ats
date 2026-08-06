import { describe, it, expect, vi, beforeEach } from 'vitest';

// Final whole-branch review (Assessment Player Slice 2) — repo-level tests for
// two fixes that the service-level tests can't observe because the service
// test mocks candidateAssessmentRepo/candidateAssessmentWriteRepo entirely
// (see tests/assessment/candidate-assessment-service.test.ts). These tests
// exercise the REAL repository against a mocked tenantDb. That pattern was
// borrowed from tests/evaluation360/evaluation360-repository.test.ts, which
// #54 deleted in 2026-08 along with the orphaned repository it covered (the
// evaluation360 domain is C#-owned now); see git history if the original
// shape is ever needed.
//
// Finding #1: findQuestionsWithAnswerKeyInTx must filter isActive: true, same
// as the candidate-facing findQuestionsForType — otherwise a deactivated
// question stays gradeable, deflating scores and letting a deactivated
// questionId be accepted as a valid submission target.
//
// Finding #2: markStarted must NOT overwrite startedAt on a repeat call once
// the assignment is already in_progress — the guard is the conditional
// updateMany's WHERE status: 'assigned', not an unconditional update().

// vi.mock is hoisted above these top-level statements, so any variables its
// factory reads must be created via vi.hoisted (plain `const x = vi.fn()`
// declared before vi.mock still hits a TDZ error, since the factory body
// itself only runs later when '@tims/db' is first imported — but the
// hoisted vi.mock call closes over the pre-hoist binding).
const { assessmentAssignmentUpdateMany, assessmentAssignmentFindUniqueOrThrow, assessmentQuestionFindMany } =
  vi.hoisted(() => ({
    assessmentAssignmentUpdateMany: vi.fn(),
    assessmentAssignmentFindUniqueOrThrow: vi.fn(),
    assessmentQuestionFindMany: vi.fn(),
  }));

vi.mock('@tims/db', () => ({
  tenantDb: {
    assessmentAssignment: {
      updateMany: assessmentAssignmentUpdateMany,
      findUniqueOrThrow: assessmentAssignmentFindUniqueOrThrow,
    },
    assessmentQuestion: {
      findMany: assessmentQuestionFindMany,
    },
  },
}));

import {
  candidateAssessmentRepo,
  candidateAssessmentWriteRepo,
} from '../../packages/api/src/repositories/candidate-assessment.repository';

const ASSIGNMENT_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = 'org-1';
const TYPE_ID = 'type-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx', () => {
  it('filters isActive: true, matching findQuestionsForType (review finding #1)', async () => {
    assessmentQuestionFindMany.mockResolvedValue([]);
    const tx = { assessmentQuestion: { findMany: assessmentQuestionFindMany } } as never;

    await candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx(tx, ORG_ID, TYPE_ID);

    expect(assessmentQuestionFindMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, assessmentTypeId: TYPE_ID, isActive: true },
      select: { id: true, type: true, correctOptionIds: true, points: true },
    });
  });
});

describe('candidateAssessmentWriteRepo.getNormCountsInTx (issue #16 — count-based, no full-population fetch)', () => {
  it('issues 3 count() calls (below/equal/total) against the same org+type+non-partial scope, excluding self — never a findMany', async () => {
    const countMock = vi
      .fn()
      .mockResolvedValueOnce(3) // countBelow
      .mockResolvedValueOnce(1) // countEqual
      .mockResolvedValueOnce(5); // sampleSize (total)
    const mockTx = { assessmentResult: { count: countMock, findMany: vi.fn() } };

    const result = await candidateAssessmentWriteRepo.getNormCountsInTx(
      mockTx as never,
      'org-1',
      'type-1',
      'assignment-self',
      70,
    );

    expect(result).toEqual({ countBelow: 3, countEqual: 1, sampleSize: 5 });
    expect(mockTx.assessmentResult.findMany).not.toHaveBeenCalled();
    expect(countMock).toHaveBeenCalledTimes(3);

    const baseScope = {
      organizationId: 'org-1',
      assignmentId: { not: 'assignment-self' },
      assignment: { assessmentTypeId: 'type-1', status: 'completed' },
      breakdown: { path: ['pendingManual'], equals: [] },
    };
    expect(countMock).toHaveBeenNthCalledWith(1, {
      where: { ...baseScope, normalizedScore: { lt: 70 } },
    });
    expect(countMock).toHaveBeenNthCalledWith(2, {
      where: { ...baseScope, normalizedScore: 70 },
    });
    expect(countMock).toHaveBeenNthCalledWith(3, {
      where: { ...baseScope, normalizedScore: { not: null } },
    });
  });
});

describe('candidateAssessmentRepo.markStarted', () => {
  it('on first start: conditionally flips assigned -> in_progress and sets startedAt', async () => {
    assessmentAssignmentUpdateMany.mockResolvedValue({ count: 1 });

    const result = await candidateAssessmentRepo.markStarted(ASSIGNMENT_ID);

    expect(assessmentAssignmentUpdateMany).toHaveBeenCalledWith({
      where: { id: ASSIGNMENT_ID, status: 'assigned' },
      data: { status: 'in_progress', startedAt: expect.any(Date) },
    });
    // No extra read needed — the updateMany itself proves the transition happened.
    expect(assessmentAssignmentFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(result).toEqual({ id: ASSIGNMENT_ID, status: 'in_progress' });
  });

  it('on repeat call while already in_progress: does NOT touch startedAt (review finding #2)', async () => {
    // The guarded updateMany matches 0 rows because status is already
    // in_progress, not 'assigned' — this is what proves startedAt was never
    // written a second time (an unconditional update() would match here).
    assessmentAssignmentUpdateMany.mockResolvedValue({ count: 0 });
    assessmentAssignmentFindUniqueOrThrow.mockResolvedValue({ id: ASSIGNMENT_ID, status: 'in_progress' });

    const result = await candidateAssessmentRepo.markStarted(ASSIGNMENT_ID);

    expect(assessmentAssignmentUpdateMany).toHaveBeenCalledWith({
      where: { id: ASSIGNMENT_ID, status: 'assigned' },
      data: { status: 'in_progress', startedAt: expect.any(Date) },
    });
    // The fallback read never selects/overwrites startedAt.
    expect(assessmentAssignmentFindUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: ASSIGNMENT_ID },
      select: { id: true, status: true },
    });
    expect(result).toEqual({ id: ASSIGNMENT_ID, status: 'in_progress' });
  });
});
