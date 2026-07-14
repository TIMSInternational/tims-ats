import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 1.7 Slice 2 — evaluation360Service. Covers: atomic guarded cycle
// transitions (open/close/publish -> CONFLICT on count 0), assignRaters'
// cycle-state guard + cross-org id rejection (BAD_REQUEST), and
// getCycleProgress shaping (NOT_FOUND when the cycle isn't in this org, and
// per-relationship total/submitted counts including relationships with zero
// assignments).

const createCycleMock = vi.fn();
const openCycleMock = vi.fn();
const closeCycleMock = vi.fn();
const publishCycleMock = vi.fn();
const listCyclesMock = vi.fn();
const getCycleForOrgMock = vi.fn();
const assignRatersMock = vi.fn();
const getProgressCountsMock = vi.fn();
const findRaterTasksMock = vi.fn();
const findAssignmentForRaterMock = vi.fn();
const submitRatingsMock = vi.fn();
const findPublishedCycleMock = vi.fn();
const subjectHasAssignmentInCycleMock = vi.fn();
const findReportRowsMock = vi.fn();
const findPublishedCyclesForSubjectMock = vi.fn();

vi.mock('../../packages/api/src/repositories/evaluation360.repository', () => ({
  evaluation360Repository: {
    createCycle: (...a: unknown[]) => createCycleMock(...a),
    openCycle: (...a: unknown[]) => openCycleMock(...a),
    closeCycle: (...a: unknown[]) => closeCycleMock(...a),
    publishCycle: (...a: unknown[]) => publishCycleMock(...a),
    listCycles: (...a: unknown[]) => listCyclesMock(...a),
    getCycleForOrg: (...a: unknown[]) => getCycleForOrgMock(...a),
    assignRaters: (...a: unknown[]) => assignRatersMock(...a),
    getProgressCounts: (...a: unknown[]) => getProgressCountsMock(...a),
    findRaterTasks: (...a: unknown[]) => findRaterTasksMock(...a),
    findAssignmentForRater: (...a: unknown[]) => findAssignmentForRaterMock(...a),
    submitRatings: (...a: unknown[]) => submitRatingsMock(...a),
    findPublishedCycle: (...a: unknown[]) => findPublishedCycleMock(...a),
    subjectHasAssignmentInCycle: (...a: unknown[]) => subjectHasAssignmentInCycleMock(...a),
    findReportRows: (...a: unknown[]) => findReportRowsMock(...a),
    findPublishedCyclesForSubject: (...a: unknown[]) => findPublishedCyclesForSubjectMock(...a),
  },
}));

import { evaluation360Service } from '../../packages/api/src/services/evaluation360.service';

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const CYCLE_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const USER_A = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const USER_B = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
const CREATED_BY = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';
const RATER_ID = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66';
const ASSIGNMENT_ID = 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a77';
const SUBJECT_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a88';

const SIX_RATINGS = [
  { competencyKey: 'leadership' as const, rating: 4 },
  { competencyKey: 'communication' as const, rating: 4 },
  { competencyKey: 'collaboration' as const, rating: 4 },
  { competencyKey: 'execution' as const, rating: 4 },
  { competencyKey: 'adaptability' as const, rating: 4 },
  { competencyKey: 'integrity' as const, rating: 4 },
];

beforeEach(() => vi.clearAllMocks());

describe('evaluation360Service.createCycle', () => {
  it('creates a draft cycle scoped to the org and creator', async () => {
    createCycleMock.mockResolvedValue({ id: CYCLE_ID, name: 'Q3 Review', status: 'draft', createdAt: new Date() });
    const result = await evaluation360Service.createCycle(ORG_ID, CREATED_BY, 'Q3 Review');
    expect(createCycleMock).toHaveBeenCalledWith(ORG_ID, CREATED_BY, 'Q3 Review');
    expect(result).toMatchObject({ id: CYCLE_ID, name: 'Q3 Review', status: 'draft' });
  });
});

describe('evaluation360Service transitions', () => {
  it('openCycle: draft -> open on success', async () => {
    openCycleMock.mockResolvedValue({ count: 1 });
    const result = await evaluation360Service.openCycle(ORG_ID, CYCLE_ID);
    expect(openCycleMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID);
    expect(result).toEqual({ cycleId: CYCLE_ID, status: 'open' });
  });

  it('openCycle: throws CONFLICT when the cycle is not draft (count 0)', async () => {
    openCycleMock.mockResolvedValue({ count: 0 });
    await expect(evaluation360Service.openCycle(ORG_ID, CYCLE_ID)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('closeCycle: open -> closed on success', async () => {
    closeCycleMock.mockResolvedValue({ count: 1 });
    const result = await evaluation360Service.closeCycle(ORG_ID, CYCLE_ID);
    expect(closeCycleMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID);
    expect(result).toEqual({ cycleId: CYCLE_ID, status: 'closed' });
  });

  it('closeCycle: throws CONFLICT when the cycle is not open (count 0)', async () => {
    closeCycleMock.mockResolvedValue({ count: 0 });
    await expect(evaluation360Service.closeCycle(ORG_ID, CYCLE_ID)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('publishCycle: closed -> published on success', async () => {
    publishCycleMock.mockResolvedValue({ count: 1 });
    const result = await evaluation360Service.publishCycle(ORG_ID, CYCLE_ID);
    expect(publishCycleMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID);
    expect(result).toEqual({ cycleId: CYCLE_ID, status: 'published' });
  });

  it('publishCycle: throws CONFLICT when the cycle is not closed (count 0)', async () => {
    publishCycleMock.mockResolvedValue({ count: 0 });
    await expect(evaluation360Service.publishCycle(ORG_ID, CYCLE_ID)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('evaluation360Service.assignRaters', () => {
  const assignments = [{ subjectUserId: USER_A, raterUserId: USER_B, relationship: 'peer' as const }];

  // Fix wave (FIX C, TOCTOU): the cycle-status check moved into the
  // repository's single $transaction (re-checked atomically alongside the
  // org-membership validation + createMany) instead of a separate
  // getCycleForOrg pre-read in the service. The service now calls
  // evaluation360Repository.assignRaters ONCE, with the expected statuses,
  // and maps its `cycleNotOpen` flag to CONFLICT — getCycleForOrg is no
  // longer invoked by this code path at all.

  it('throws CONFLICT when the repository reports cycleNotOpen (absent / wrong org / not draft-or-open)', async () => {
    assignRatersMock.mockResolvedValue({ cycleNotOpen: true, missingUserIds: [], created: 0 });
    await expect(evaluation360Service.assignRaters(ORG_ID, CYCLE_ID, assignments)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(getCycleForOrgMock).not.toHaveBeenCalled();
  });

  it('passes the expected draft/open statuses to the repository (single atomic call, no separate pre-read)', async () => {
    assignRatersMock.mockResolvedValue({ cycleNotOpen: false, missingUserIds: [], created: 1 });
    await evaluation360Service.assignRaters(ORG_ID, CYCLE_ID, assignments);
    expect(assignRatersMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID, assignments, ['draft', 'open']);
    expect(getCycleForOrgMock).not.toHaveBeenCalled();
  });

  it('allows assignment when the repository confirms the cycle status matched (draft or open)', async () => {
    assignRatersMock.mockResolvedValue({ cycleNotOpen: false, missingUserIds: [], created: 1 });
    const result = await evaluation360Service.assignRaters(ORG_ID, CYCLE_ID, assignments);
    expect(result).toEqual({ created: 1 });
  });

  it('throws BAD_REQUEST when the repository reports cross-org / nonexistent user ids', async () => {
    assignRatersMock.mockResolvedValue({ cycleNotOpen: false, missingUserIds: [USER_B], created: 0 });
    await expect(evaluation360Service.assignRaters(ORG_ID, CYCLE_ID, assignments)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('dedups via skipDuplicates at the repository createMany (created count can be lower than input length)', async () => {
    const dupeAssignments = [
      { subjectUserId: USER_A, raterUserId: USER_B, relationship: 'peer' as const },
      { subjectUserId: USER_A, raterUserId: USER_B, relationship: 'peer' as const },
    ];
    assignRatersMock.mockResolvedValue({ cycleNotOpen: false, missingUserIds: [], created: 1 });
    const result = await evaluation360Service.assignRaters(ORG_ID, CYCLE_ID, dupeAssignments);
    expect(result).toEqual({ created: 1 });
    expect(assignRatersMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID, dupeAssignments, ['draft', 'open']);
  });
});

describe('evaluation360Service.getCycleProgress', () => {
  it('throws NOT_FOUND when the cycle does not belong to this org', async () => {
    getCycleForOrgMock.mockResolvedValue(null);
    await expect(evaluation360Service.getCycleProgress(ORG_ID, CYCLE_ID, USER_A)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(getProgressCountsMock).not.toHaveBeenCalled();
  });

  it('shapes per-relationship submitted/total counts, including relationships with zero assignments', async () => {
    getCycleForOrgMock.mockResolvedValue({ id: CYCLE_ID, status: 'open' });
    getProgressCountsMock.mockResolvedValue([
      { relationship: 'peer', status: 'submitted', _count: { _all: 3 } },
      { relationship: 'peer', status: 'pending', _count: { _all: 2 } },
      { relationship: 'manager', status: 'submitted', _count: { _all: 1 } },
      // 'self' and 'direct_report' have no rows at all.
    ]);

    const result = await evaluation360Service.getCycleProgress(ORG_ID, CYCLE_ID, USER_A);

    expect(result).toEqual({
      cycleId: CYCLE_ID,
      progress: [
        { relationship: 'self', total: 0, submitted: 0 },
        { relationship: 'manager', total: 1, submitted: 1 },
        { relationship: 'peer', total: 5, submitted: 3 },
        { relationship: 'direct_report', total: 0, submitted: 0 },
      ],
    });
  });

  // Fix wave (BLOCKING — anonymity leak, Codex): passes the caller's id
  // through to the repository as excludeSubjectUserId. If the caller is ALSO
  // a subject in this cycle (e.g. the sole subject), the cycle-wide counts
  // must exclude their own subject-assignments — otherwise they could
  // difference their own suppressed (<3) peer bucket size from the totals,
  // defeating myReport's min-3 anonymity omission.
  it('passes callerUserId through as the repository excludeSubjectUserId (caller-as-sole-subject cannot self-difference)', async () => {
    getCycleForOrgMock.mockResolvedValue({ id: CYCLE_ID, status: 'open' });
    getProgressCountsMock.mockResolvedValue([]);

    await evaluation360Service.getCycleProgress(ORG_ID, CYCLE_ID, USER_A);

    expect(getProgressCountsMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID, USER_A);
  });
});

// ---------------------------------------------------------------------------
// Sprint 1.7 Slice 3 — rater self-service (identity-anchored, NOT scope-aware).
// myRaterTasks/submitRatings must key EVERY repo call to (orgId, raterUserId)
// where raterUserId is ALWAYS ctx.user.id — never assertScoped/scopeWhereFor,
// which would return {} for an org-scoped caller (super_admin/hr_admin) and
// let them act on behalf of another rater.
// ---------------------------------------------------------------------------

describe('evaluation360Service.myRaterTasks', () => {
  it('maps repo rows to the task DTO (including the fixed 6-competency list) scoped to this rater, newest cycle first', async () => {
    findRaterTasksMock.mockResolvedValue([
      {
        id: ASSIGNMENT_ID,
        relationship: 'peer',
        cycleId: CYCLE_ID,
        cycle: { name: 'Q3 Review' },
        subject: { firstName: 'Ana', lastName: 'Gomez' },
      },
    ]);

    const result = await evaluation360Service.myRaterTasks(ORG_ID, RATER_ID);

    expect(findRaterTasksMock).toHaveBeenCalledWith(ORG_ID, RATER_ID);
    expect(result).toEqual([
      {
        assignmentId: ASSIGNMENT_ID,
        cycleId: CYCLE_ID,
        cycleName: 'Q3 Review',
        relationship: 'peer',
        subject: { firstName: 'Ana', lastName: 'Gomez' },
        competencies: ['leadership', 'communication', 'collaboration', 'execution', 'adaptability', 'integrity'],
      },
    ]);
  });

  it('returns an empty list when the rater has no pending tasks in an open cycle', async () => {
    findRaterTasksMock.mockResolvedValue([]);
    const result = await evaluation360Service.myRaterTasks(ORG_ID, RATER_ID);
    expect(result).toEqual([]);
  });
});

describe('evaluation360Service.submitRatings', () => {
  it('throws NOT_FOUND when the pre-fetch finds no assignment owned by this rater in this org (absent / not this org / not your assignment)', async () => {
    findAssignmentForRaterMock.mockResolvedValue(null);

    await expect(
      evaluation360Service.submitRatings(ORG_ID, RATER_ID, ASSIGNMENT_ID, SIX_RATINGS),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(findAssignmentForRaterMock).toHaveBeenCalledWith(ORG_ID, RATER_ID, ASSIGNMENT_ID);
    expect(submitRatingsMock).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when the atomic claim count is 0 (cycle not open OR already submitted)', async () => {
    findAssignmentForRaterMock.mockResolvedValue({ id: ASSIGNMENT_ID, status: 'pending', cycle: { status: 'open' } });
    submitRatingsMock.mockResolvedValue({ claimed: false });

    await expect(
      evaluation360Service.submitRatings(ORG_ID, RATER_ID, ASSIGNMENT_ID, SIX_RATINGS),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('happy path: pre-fetch finds the assignment, the atomic claim succeeds, and it returns submitted', async () => {
    findAssignmentForRaterMock.mockResolvedValue({ id: ASSIGNMENT_ID, status: 'pending', cycle: { status: 'open' } });
    submitRatingsMock.mockResolvedValue({ claimed: true });

    const result = await evaluation360Service.submitRatings(ORG_ID, RATER_ID, ASSIGNMENT_ID, SIX_RATINGS);

    expect(submitRatingsMock).toHaveBeenCalledWith(ORG_ID, RATER_ID, ASSIGNMENT_ID, SIX_RATINGS);
    expect(result).toEqual({ assignmentId: ASSIGNMENT_ID, status: 'submitted' });
  });
});

// ---------------------------------------------------------------------------
// Sprint 1.7 Slice 4 — myReport (identity-anchored, published-only). Two
// independent NOT_FOUND gates BEFORE any aggregation: (1) the cycle must be
// published in this org, (2) the caller must be a subject of >=1 assignment
// in that cycle. Either miss returns the SAME NOT_FOUND — never distinguish
// "cycle not published" from "you are not a subject" to the caller.
// ---------------------------------------------------------------------------

describe('evaluation360Service.myReport', () => {
  it('throws NOT_FOUND when the cycle is not published in this org, and never reads assignments or rows', async () => {
    findPublishedCycleMock.mockResolvedValue(null);

    await expect(evaluation360Service.myReport(ORG_ID, SUBJECT_ID, CYCLE_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(findPublishedCycleMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID);
    expect(subjectHasAssignmentInCycleMock).not.toHaveBeenCalled();
    expect(findReportRowsMock).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the cycle is published but the caller is not a subject in it, and never reads rows', async () => {
    findPublishedCycleMock.mockResolvedValue({ id: CYCLE_ID, name: 'Q3 Review' });
    subjectHasAssignmentInCycleMock.mockResolvedValue(false);

    await expect(evaluation360Service.myReport(ORG_ID, SUBJECT_ID, CYCLE_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(subjectHasAssignmentInCycleMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID, SUBJECT_ID);
    expect(findReportRowsMock).not.toHaveBeenCalled();
  });

  it('happy path: returns cycleId/cycleName plus aggregated buckets when published and the caller is a subject', async () => {
    findPublishedCycleMock.mockResolvedValue({ id: CYCLE_ID, name: 'Q3 Review' });
    subjectHasAssignmentInCycleMock.mockResolvedValue(true);
    findReportRowsMock.mockResolvedValue([
      { assignmentId: 'p1', relationship: 'peer', competencyKey: 'leadership', rating: 4, comment: 'a' },
      { assignmentId: 'p2', relationship: 'peer', competencyKey: 'leadership', rating: 5, comment: 'b' },
      { assignmentId: 'p3', relationship: 'peer', competencyKey: 'leadership', rating: 3, comment: 'c' },
    ]);

    const result = await evaluation360Service.myReport(ORG_ID, SUBJECT_ID, CYCLE_ID);

    expect(findReportRowsMock).toHaveBeenCalledWith(ORG_ID, CYCLE_ID, SUBJECT_ID);
    expect(result).toEqual({
      cycleId: CYCLE_ID,
      cycleName: 'Q3 Review',
      buckets: [
        {
          relationship: 'peer',
          raterCount: 3,
          competencies: [{ competencyKey: 'leadership', average: 4 }],
          comments: null,
        },
      ],
    });
  });

  it('both NOT_FOUND gates (cycle-not-published vs caller-not-subject) throw the SAME message (REPORT_NOT_FOUND_MESSAGE) — never let the caller distinguish which gate failed', async () => {
    findPublishedCycleMock.mockResolvedValue(null);
    const errA = await evaluation360Service.myReport(ORG_ID, SUBJECT_ID, CYCLE_ID).catch((e) => e);

    findPublishedCycleMock.mockResolvedValue({ id: CYCLE_ID, name: 'Q3 Review' });
    subjectHasAssignmentInCycleMock.mockResolvedValue(false);
    const errB = await evaluation360Service.myReport(ORG_ID, SUBJECT_ID, CYCLE_ID).catch((e) => e);

    expect(errA.message).toBe('Reporte no encontrado');
    expect(errB.message).toBe('Reporte no encontrado');
    expect(errA.message).toBe(errB.message);
  });

  it('the returned payload never contains a raterUserId / rater id field anywhere', async () => {
    findPublishedCycleMock.mockResolvedValue({ id: CYCLE_ID, name: 'Q3 Review' });
    subjectHasAssignmentInCycleMock.mockResolvedValue(true);
    findReportRowsMock.mockResolvedValue([
      { assignmentId: 'm1', relationship: 'manager', competencyKey: 'leadership', rating: 4, comment: 'ok' },
    ]);

    const result = await evaluation360Service.myReport(ORG_ID, SUBJECT_ID, CYCLE_ID);

    expect(JSON.stringify(result)).not.toMatch(/raterUserId|raterId/i);
  });
});

// ---------------------------------------------------------------------------
// Sprint 1.7 Slice 5 — myReportCycles (identity-anchored, same pattern as
// myReport). `subjectUserId` here is always ctx.user.id from the router.
// ---------------------------------------------------------------------------

describe('evaluation360Service.myReportCycles', () => {
  it('maps repo rows to {cycleId, cycleName, publishedAt}, scoped to this subject', async () => {
    const publishedAt = new Date('2026-07-01T00:00:00Z');
    findPublishedCyclesForSubjectMock.mockResolvedValue([
      { id: CYCLE_ID, name: 'Q3 Review', publishedAt },
    ]);

    const result = await evaluation360Service.myReportCycles(ORG_ID, SUBJECT_ID);

    expect(findPublishedCyclesForSubjectMock).toHaveBeenCalledWith(ORG_ID, SUBJECT_ID);
    expect(result).toEqual([{ cycleId: CYCLE_ID, cycleName: 'Q3 Review', publishedAt }]);
  });

  it('returns an empty list when the subject has no published-cycle assignments', async () => {
    findPublishedCyclesForSubjectMock.mockResolvedValue([]);
    const result = await evaluation360Service.myReportCycles(ORG_ID, SUBJECT_ID);
    expect(result).toEqual([]);
  });
});
