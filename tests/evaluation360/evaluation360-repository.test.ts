import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 1.7 Slice 2 — evaluation360Repository. Asserts every query/write is
// org-scoped (`organizationId: orgId` in the where clause — a missing org
// filter is a cross-tenant defect) and uses an explicit `select`. The
// transition methods (open/close/publish) additionally assert the guarded
// `updateMany` includes the expected *current* status in its where clause,
// mirroring external-validation.repository.ts's TOCTOU-safe pattern.
// Pattern mirrors tests/fit-engine/fit-engine-repository.test.ts: vi.mock
// at the '@tims/db' tenantDb boundary + import the real repository.

const txUserFindMany = vi.fn();
const txCreateMany = vi.fn();
const txReviewCycleFindFirst = vi.fn();
const txRaterAssignmentUpdateMany = vi.fn();
const txRaterResponseCreateMany = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    reviewCycle: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    raterAssignment: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    raterResponse: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { evaluation360Repository } from '../../packages/api/src/repositories/evaluation360.repository';
import { tenantDb } from '@tims/db';

const ORG_ID = 'org-1';
const CYCLE_ID = 'cycle-1';
const USER_A = 'user-a';
const USER_B = 'user-b';
const RATER_ID = 'rater-1';
const ASSIGNMENT_ID = 'assignment-1';

type Tx = {
  reviewCycle: { findFirst: typeof txReviewCycleFindFirst };
  user: { findMany: typeof txUserFindMany };
  raterAssignment: { createMany: typeof txCreateMany; updateMany: typeof txRaterAssignmentUpdateMany };
  raterResponse: { createMany: typeof txRaterResponseCreateMany };
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the cycle-status re-check inside the transaction finds a matching
  // cycle (draft/open) unless a test overrides it — matches the pre-fix-wave
  // "cycle exists and is open" happy path for non-assignRaters tests too.
  txReviewCycleFindFirst.mockResolvedValue({ id: CYCLE_ID });
  vi.mocked(tenantDb.$transaction).mockImplementation(async (fn: unknown) =>
    (fn as (tx: Tx) => unknown)({
      reviewCycle: { findFirst: txReviewCycleFindFirst },
      user: { findMany: txUserFindMany },
      raterAssignment: { createMany: txCreateMany, updateMany: txRaterAssignmentUpdateMany },
      raterResponse: { createMany: txRaterResponseCreateMany },
    }),
  );
});

describe('evaluation360Repository.createCycle', () => {
  it('scopes to the org and selects only id/name/status/createdAt', async () => {
    vi.mocked(tenantDb.reviewCycle.create).mockResolvedValue({} as never);
    await evaluation360Repository.createCycle(ORG_ID, 'creator-1', 'Q3 Review');
    expect(tenantDb.reviewCycle.create).toHaveBeenCalledWith({
      data: { organizationId: ORG_ID, createdById: 'creator-1', name: 'Q3 Review' },
      select: { id: true, name: true, status: true, createdAt: true },
    });
  });
});

describe('evaluation360Repository transition guards', () => {
  it('openCycle guards on org + draft status', async () => {
    vi.mocked(tenantDb.reviewCycle.updateMany).mockResolvedValue({ count: 1 } as never);
    await evaluation360Repository.openCycle(ORG_ID, CYCLE_ID);
    expect(tenantDb.reviewCycle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CYCLE_ID, organizationId: ORG_ID, status: 'draft' } }),
    );
    const call = vi.mocked(tenantDb.reviewCycle.updateMany).mock.calls[0]![0] as { data: { status: string } };
    expect(call.data.status).toBe('open');
  });

  it('closeCycle guards on org + open status', async () => {
    vi.mocked(tenantDb.reviewCycle.updateMany).mockResolvedValue({ count: 1 } as never);
    await evaluation360Repository.closeCycle(ORG_ID, CYCLE_ID);
    expect(tenantDb.reviewCycle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CYCLE_ID, organizationId: ORG_ID, status: 'open' } }),
    );
  });

  it('publishCycle guards on org + closed status', async () => {
    vi.mocked(tenantDb.reviewCycle.updateMany).mockResolvedValue({ count: 1 } as never);
    await evaluation360Repository.publishCycle(ORG_ID, CYCLE_ID);
    expect(tenantDb.reviewCycle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CYCLE_ID, organizationId: ORG_ID, status: 'closed' } }),
    );
  });
});

describe('evaluation360Repository.listCycles', () => {
  it('filters by organizationId and selects explicit fields only', async () => {
    vi.mocked(tenantDb.reviewCycle.findMany).mockResolvedValue([] as never);
    await evaluation360Repository.listCycles(ORG_ID);
    expect(tenantDb.reviewCycle.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, status: true, opensAt: true, closesAt: true, publishedAt: true, createdAt: true },
    });
  });
});

describe('evaluation360Repository.getCycleForOrg', () => {
  it('scopes the lookup by organizationId', async () => {
    vi.mocked(tenantDb.reviewCycle.findFirst).mockResolvedValue(null as never);
    await evaluation360Repository.getCycleForOrg(ORG_ID, CYCLE_ID);
    expect(tenantDb.reviewCycle.findFirst).toHaveBeenCalledWith({
      where: { id: CYCLE_ID, organizationId: ORG_ID },
      select: { id: true, status: true },
    });
  });
});

describe('evaluation360Repository.assignRaters', () => {
  const assignments = [{ subjectUserId: USER_A, raterUserId: USER_B, relationship: 'peer' as const }];
  const EXPECTED_STATUSES = ['draft', 'open'] as const;

  // Fix wave (FIX C, TOCTOU): the cycle-status re-check now happens INSIDE the
  // same $transaction as the org-membership validation + createMany, instead
  // of as a separate pre-read in the service. These tests assert (a) the
  // status re-check runs first, scoped to org+id+expected-statuses, and (b) a
  // non-matching cycle short-circuits the transaction (cycleNotOpen: true,
  // no user lookup, no createMany) — closing the race where a concurrent
  // closeCycle could slip in between a separate read and the write.

  it('re-checks the cycle status inside the transaction, scoped to org + expected statuses', async () => {
    txReviewCycleFindFirst.mockResolvedValue({ id: CYCLE_ID });
    txUserFindMany.mockResolvedValue([{ id: USER_A }, { id: USER_B }]);
    txCreateMany.mockResolvedValue({ count: 1 });

    await evaluation360Repository.assignRaters(ORG_ID, CYCLE_ID, assignments, [...EXPECTED_STATUSES]);

    expect(txReviewCycleFindFirst).toHaveBeenCalledWith({
      where: { id: CYCLE_ID, organizationId: ORG_ID, status: { in: [...EXPECTED_STATUSES] } },
      select: { id: true },
    });
  });

  it('looks up both subject and rater user ids scoped to this org', async () => {
    txUserFindMany.mockResolvedValue([{ id: USER_A }, { id: USER_B }]);
    txCreateMany.mockResolvedValue({ count: 1 });

    await evaluation360Repository.assignRaters(ORG_ID, CYCLE_ID, assignments, [...EXPECTED_STATUSES]);

    expect(txUserFindMany).toHaveBeenCalledWith({
      where: { id: { in: [USER_A, USER_B] }, organizationId: ORG_ID },
      select: { id: true },
    });
  });

  it('creates assignments with skipDuplicates when the cycle status matches and every user id is found in the org', async () => {
    txUserFindMany.mockResolvedValue([{ id: USER_A }, { id: USER_B }]);
    txCreateMany.mockResolvedValue({ count: 1 });

    const result = await evaluation360Repository.assignRaters(ORG_ID, CYCLE_ID, assignments, [...EXPECTED_STATUSES]);

    expect(txCreateMany).toHaveBeenCalledWith({
      data: [{ organizationId: ORG_ID, cycleId: CYCLE_ID, subjectUserId: USER_A, raterUserId: USER_B, relationship: 'peer' }],
      skipDuplicates: true,
    });
    expect(result).toEqual({ cycleNotOpen: false, missingUserIds: [], created: 1 });
  });

  it('does NOT call the user lookup or createMany and reports cycleNotOpen when the status re-check misses (e.g. concurrently closed)', async () => {
    txReviewCycleFindFirst.mockResolvedValue(null);

    const result = await evaluation360Repository.assignRaters(ORG_ID, CYCLE_ID, assignments, [...EXPECTED_STATUSES]);

    expect(txUserFindMany).not.toHaveBeenCalled();
    expect(txCreateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ cycleNotOpen: true, missingUserIds: [], created: 0 });
  });

  it('does NOT call createMany and reports missing ids when a user id belongs to another org', async () => {
    // The org-scoped findMany against ORG_ID resolves only USER_A (e.g.
    // USER_B actually belongs to a different org), so USER_B is "missing".
    txUserFindMany.mockResolvedValue([{ id: USER_A }]);

    const result = await evaluation360Repository.assignRaters(ORG_ID, CYCLE_ID, assignments, [...EXPECTED_STATUSES]);

    expect(txCreateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ cycleNotOpen: false, missingUserIds: [USER_B], created: 0 });
  });
});

describe('evaluation360Repository.getProgressCounts', () => {
  // Fix wave (BLOCKING — anonymity leak): the caller's own subject-assignments
  // MUST be excluded, otherwise an admin who is also a subject in this cycle
  // (e.g. the sole subject) could difference their own suppressed (<3)
  // peer/direct_report bucket from the cycle-wide totals — defeating
  // myReport's min-3 anonymity omission.
  it('groups assignments by relationship + status scoped to this org and cycle, excluding the caller as subject', async () => {
    vi.mocked(tenantDb.raterAssignment.groupBy).mockResolvedValue([] as never);
    await evaluation360Repository.getProgressCounts(ORG_ID, CYCLE_ID, USER_A);
    expect(tenantDb.raterAssignment.groupBy).toHaveBeenCalledWith({
      by: ['relationship', 'status'],
      where: { organizationId: ORG_ID, cycleId: CYCLE_ID, subjectUserId: { not: USER_A } },
      _count: { _all: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Sprint 1.7 Slice 3 — rater self-service (identity-anchored, NOT scope-aware).
// Every query below MUST filter on raterUserId in addition to organizationId —
// a missing raterUserId filter is a cross-user leak defect (an org-scoped
// caller like super_admin/hr_admin could otherwise read/write another rater's
// assignment, since scopeWhereFor would return {} for their scope).
// ---------------------------------------------------------------------------

describe('evaluation360Repository.findRaterTasks', () => {
  it('filters by raterUserId AND organizationId AND status:pending AND the cycle-open relation, selecting only the fields the task DTO needs, newest cycle first', async () => {
    vi.mocked(tenantDb.raterAssignment.findMany).mockResolvedValue([] as never);
    await evaluation360Repository.findRaterTasks(ORG_ID, RATER_ID);
    expect(tenantDb.raterAssignment.findMany).toHaveBeenCalledWith({
      where: {
        raterUserId: RATER_ID,
        organizationId: ORG_ID,
        status: 'pending',
        cycle: { is: { status: 'open' } },
      },
      select: {
        id: true,
        relationship: true,
        cycleId: true,
        cycle: { select: { name: true } },
        subject: { select: { firstName: true, lastName: true } },
      },
      orderBy: { cycle: { createdAt: 'desc' } },
    });
  });
});

describe('evaluation360Repository.findAssignmentForRater', () => {
  it('scopes the lookup by id + organizationId + raterUserId (identity-anchored, not scope-aware)', async () => {
    vi.mocked(tenantDb.raterAssignment.findFirst).mockResolvedValue(null as never);
    await evaluation360Repository.findAssignmentForRater(ORG_ID, RATER_ID, ASSIGNMENT_ID);
    expect(tenantDb.raterAssignment.findFirst).toHaveBeenCalledWith({
      where: { id: ASSIGNMENT_ID, organizationId: ORG_ID, raterUserId: RATER_ID },
      select: { id: true, status: true, cycle: { select: { status: true } } },
    });
  });
});

describe('evaluation360Repository.submitRatings', () => {
  const ratings = [
    { competencyKey: 'leadership' as const, rating: 4, comment: undefined },
    { competencyKey: 'communication' as const, rating: 5, comment: 'great' },
  ];

  it('atomically claims the assignment (guarded updateMany: id + org + raterUserId + status:pending + cycle open) inside a single $transaction', async () => {
    txRaterAssignmentUpdateMany.mockResolvedValue({ count: 1 });
    txRaterResponseCreateMany.mockResolvedValue({ count: 2 });

    await evaluation360Repository.submitRatings(ORG_ID, RATER_ID, ASSIGNMENT_ID, ratings);

    expect(txRaterAssignmentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: ASSIGNMENT_ID,
        organizationId: ORG_ID,
        raterUserId: RATER_ID,
        status: 'pending',
        cycle: { is: { status: 'open' } },
      },
      data: expect.objectContaining({ status: 'submitted' }),
    });
  });

  it('createMany inserts the RaterResponse rows scoped to this org, using null for an absent comment, only when the claim succeeded', async () => {
    txRaterAssignmentUpdateMany.mockResolvedValue({ count: 1 });
    txRaterResponseCreateMany.mockResolvedValue({ count: 2 });

    const result = await evaluation360Repository.submitRatings(ORG_ID, RATER_ID, ASSIGNMENT_ID, ratings);

    expect(txRaterResponseCreateMany).toHaveBeenCalledWith({
      data: [
        { assignmentId: ASSIGNMENT_ID, organizationId: ORG_ID, competencyKey: 'leadership', rating: 4, comment: null },
        { assignmentId: ASSIGNMENT_ID, organizationId: ORG_ID, competencyKey: 'communication', rating: 5, comment: 'great' },
      ],
    });
    expect(result).toEqual({ claimed: true });
  });

  it('does NOT call createMany and reports claimed:false when the atomic claim count is 0 (already submitted or cycle not open)', async () => {
    txRaterAssignmentUpdateMany.mockResolvedValue({ count: 0 });

    const result = await evaluation360Repository.submitRatings(ORG_ID, RATER_ID, ASSIGNMENT_ID, ratings);

    expect(txRaterResponseCreateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: false });
  });
});

// ---------------------------------------------------------------------------
// Sprint 1.7 Slice 4 — myReport support (identity-anchored, published-only).
// findReportRows is the MOST SENSITIVE query in the file: its `select` MUST
// NOT include raterUserId anywhere (not on RaterResponse, not on the nested
// assignment relation) — a rater's user id must never reach the aggregator
// or the client. It selects `relationship` via the assignment relation
// (RaterResponse has no relationship column of its own).
// ---------------------------------------------------------------------------

const SUBJECT_ID = 'subject-1';

describe('evaluation360Repository.findPublishedCycle', () => {
  it('scopes by id + organizationId + status:published, selecting only id + name', async () => {
    vi.mocked(tenantDb.reviewCycle.findFirst).mockResolvedValue(null as never);
    await evaluation360Repository.findPublishedCycle(ORG_ID, CYCLE_ID);
    expect(tenantDb.reviewCycle.findFirst).toHaveBeenCalledWith({
      where: { id: CYCLE_ID, organizationId: ORG_ID, status: 'published' },
      select: { id: true, name: true },
    });
  });
});

describe('evaluation360Repository.subjectHasAssignmentInCycle', () => {
  it('checks existence scoped by cycleId + organizationId + subjectUserId, returns true when found', async () => {
    vi.mocked(tenantDb.raterAssignment.findFirst).mockResolvedValue({ id: ASSIGNMENT_ID } as never);
    const result = await evaluation360Repository.subjectHasAssignmentInCycle(ORG_ID, CYCLE_ID, SUBJECT_ID);
    expect(tenantDb.raterAssignment.findFirst).toHaveBeenCalledWith({
      where: { cycleId: CYCLE_ID, organizationId: ORG_ID, subjectUserId: SUBJECT_ID },
      select: { id: true },
    });
    expect(result).toBe(true);
  });

  it('returns false when no assignment is found', async () => {
    vi.mocked(tenantDb.raterAssignment.findFirst).mockResolvedValue(null as never);
    const result = await evaluation360Repository.subjectHasAssignmentInCycle(ORG_ID, CYCLE_ID, SUBJECT_ID);
    expect(result).toBe(false);
  });
});

describe('evaluation360Repository.findReportRows', () => {
  it('filters RaterResponse by organizationId + assignment(cycleId + organizationId + subjectUserId + status:submitted), selecting ONLY assignmentId/competencyKey/rating/comment + assignment.relationship (never raterUserId)', async () => {
    vi.mocked(tenantDb.raterResponse.findMany).mockResolvedValue([] as never);
    await evaluation360Repository.findReportRows(ORG_ID, CYCLE_ID, SUBJECT_ID);
    expect(tenantDb.raterResponse.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        assignment: { is: { cycleId: CYCLE_ID, organizationId: ORG_ID, subjectUserId: SUBJECT_ID, status: 'submitted' } },
      },
      select: {
        assignmentId: true,
        competencyKey: true,
        rating: true,
        comment: true,
        assignment: { select: { relationship: true } },
      },
    });
  });

  it('does NOT select raterUserId anywhere in the select shape (top-level or nested under assignment)', async () => {
    vi.mocked(tenantDb.raterResponse.findMany).mockResolvedValue([] as never);
    await evaluation360Repository.findReportRows(ORG_ID, CYCLE_ID, SUBJECT_ID);
    const call = vi.mocked(tenantDb.raterResponse.findMany).mock.calls[0]![0] as {
      select: Record<string, unknown> & { assignment?: { select: Record<string, unknown> } };
    };
    expect(call.select).not.toHaveProperty('raterUserId');
    expect(call.select.assignment?.select).not.toHaveProperty('raterUserId');
    expect(JSON.stringify(call.select)).not.toMatch(/raterUserId/);
  });

  it('maps rows to the flat AggregateInputRow shape (relationship pulled out of the nested assignment)', async () => {
    vi.mocked(tenantDb.raterResponse.findMany).mockResolvedValue([
      {
        assignmentId: ASSIGNMENT_ID,
        competencyKey: 'leadership',
        rating: 4,
        comment: 'great job',
        assignment: { relationship: 'peer' },
      },
    ] as never);

    const result = await evaluation360Repository.findReportRows(ORG_ID, CYCLE_ID, SUBJECT_ID);

    expect(result).toEqual([
      { assignmentId: ASSIGNMENT_ID, relationship: 'peer', competencyKey: 'leadership', rating: 4, comment: 'great job' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sprint 1.7 Slice 5 — myReportCycles support (identity-anchored on
// subjectUserId, same pattern as the Slice 4 methods above). Lets the "My
// Reports" participant UI discover which published cycles it should call
// myReport for, without the org-admin-only listCycles endpoint.
// ---------------------------------------------------------------------------

describe('evaluation360Repository.findPublishedCyclesForSubject', () => {
  it('filters by organizationId + status:published + assignments.some(subjectUserId), selecting only id/name/publishedAt, newest first', async () => {
    vi.mocked(tenantDb.reviewCycle.findMany).mockResolvedValue([] as never);
    await evaluation360Repository.findPublishedCyclesForSubject(ORG_ID, SUBJECT_ID);
    expect(tenantDb.reviewCycle.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, status: 'published', assignments: { some: { subjectUserId: SUBJECT_ID } } },
      select: { id: true, name: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });
  });
});
