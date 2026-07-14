import { tenantDb as db } from '@tims/db';
import type { RaterRelationship, ReviewCycleStatus } from '@tims/db';
import { EVAL360_COMPETENCIES } from '@tims/shared';

// ---------------------------------------------------------------------------
// evaluation360 repository — admin-facing reads/writes for ReviewCycle +
// RaterAssignment. Explicit selects only — never return full records. Cycle
// status transitions use guarded `updateMany` (where includes the expected
// current status); a `count === 0` result means the row is absent, not this
// org, or not in the expected state — the service maps that to CONFLICT.
//
// Slice 3 addition (bottom of file): rater self-service reads/writes
// (findRaterTasks/findAssignmentForRater/submitRatings) are IDENTITY-anchored
// — every where clause filters on `raterUserId` in ADDITION to
// `organizationId`. Never scope-filtered (no scopeWhereFor/assertScoped) —
// see router docstring for why.
//
// Slice 4 addition (bottom of file): myReport support
// (findPublishedCycle/subjectHasAssignmentInCycle/findReportRows) is
// IDENTITY-anchored on `subjectUserId` the same way Slice 3 is anchored on
// `raterUserId`. findReportRows is the MOST SENSITIVE query here: its
// `select` never includes `raterUserId` — not on RaterResponse, not on the
// nested `assignment` relation — because a rater's user id must never reach
// the aggregator or the client (anonymity for peer/direct_report depends on
// it). `relationship` lives only on RaterAssignment, so it's selected via
// the nested relation and flattened onto the returned row.
// ---------------------------------------------------------------------------

export interface RaterAssignmentInput {
  subjectUserId: string;
  raterUserId: string;
  relationship: RaterRelationship;
}

export interface RatingSubmissionInput {
  competencyKey: (typeof EVAL360_COMPETENCIES)[number];
  rating: number;
  comment?: string;
}

/** Flattened aggregator input row returned by findReportRows — structurally
 * identical to services/evaluation360-aggregate.ts's AggregateInputRow, kept
 * as a local type here (not imported from services/) so this repository
 * only ever depends on `@tims/db`. */
export interface AggregateReportRow {
  assignmentId: string;
  relationship: RaterRelationship;
  competencyKey: string;
  rating: number;
  comment: string | null;
}

export const evaluation360Repository = {
  async createCycle(orgId: string, createdById: string, name: string) {
    return db.reviewCycle.create({
      data: { organizationId: orgId, createdById, name },
      select: { id: true, name: true, status: true, createdAt: true },
    });
  },

  async openCycle(orgId: string, cycleId: string) {
    return db.reviewCycle.updateMany({
      where: { id: cycleId, organizationId: orgId, status: 'draft' },
      data: { status: 'open', opensAt: new Date() },
    });
  },

  async closeCycle(orgId: string, cycleId: string) {
    return db.reviewCycle.updateMany({
      where: { id: cycleId, organizationId: orgId, status: 'open' },
      data: { status: 'closed', closesAt: new Date() },
    });
  },

  async publishCycle(orgId: string, cycleId: string) {
    return db.reviewCycle.updateMany({
      where: { id: cycleId, organizationId: orgId, status: 'closed' },
      data: { status: 'published', publishedAt: new Date() },
    });
  },

  async listCycles(orgId: string) {
    return db.reviewCycle.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, status: true, opensAt: true, closesAt: true, publishedAt: true, createdAt: true },
    });
  },

  /** Existence + status check, org-scoped — used for getCycleProgress's NOT_FOUND check. (assignRaters re-checks status itself, inside its own transaction — see below.) */
  async getCycleForOrg(orgId: string, cycleId: string) {
    return db.reviewCycle.findFirst({
      where: { id: cycleId, organizationId: orgId },
      select: { id: true, status: true },
    });
  },

  /**
   * Re-checks the cycle's status AND validates every subjectUserId/
   * raterUserId in `assignments` belongs to the org, then transactionally
   * `createMany`s the assignments (skipDuplicates on the
   * [cycleId, subjectUserId, raterUserId] unique key) — all inside the SAME
   * `$transaction`. The status re-check happens here (not as a separate
   * pre-read in the service) so a concurrent closeCycle can't slip in
   * between a status check and the write (TOCTOU). `cycleNotOpen: true`
   * means the cycle is absent, not this org, or not in `expectedStatuses`;
   * `missingUserIds` are cross-org/nonexistent ids. Returns instead of
   * throwing either way — the repository is data-access only; the service
   * maps `cycleNotOpen` to CONFLICT and `missingUserIds` to BAD_REQUEST.
   */
  async assignRaters(
    orgId: string,
    cycleId: string,
    assignments: RaterAssignmentInput[],
    expectedStatuses: ReviewCycleStatus[],
  ): Promise<{ cycleNotOpen: boolean; missingUserIds: string[]; created: number }> {
    const userIds = [...new Set(assignments.flatMap((a) => [a.subjectUserId, a.raterUserId]))];

    return db.$transaction(async (tx) => {
      const cycle = await tx.reviewCycle.findFirst({
        where: { id: cycleId, organizationId: orgId, status: { in: expectedStatuses } },
        select: { id: true },
      });
      if (!cycle) {
        return { cycleNotOpen: true, missingUserIds: [], created: 0 };
      }

      const found = await tx.user.findMany({
        where: { id: { in: userIds }, organizationId: orgId },
        select: { id: true },
      });
      const foundIds = new Set(found.map((u) => u.id));
      const missingUserIds = userIds.filter((id) => !foundIds.has(id));
      if (missingUserIds.length > 0) {
        return { cycleNotOpen: false, missingUserIds, created: 0 };
      }

      const result = await tx.raterAssignment.createMany({
        data: assignments.map((a) => ({
          organizationId: orgId,
          cycleId,
          subjectUserId: a.subjectUserId,
          raterUserId: a.raterUserId,
          relationship: a.relationship,
        })),
        skipDuplicates: true,
      });
      return { cycleNotOpen: false, missingUserIds: [], created: result.count };
    });
  },

  /**
   * Per-relationship, per-status assignment counts for a cycle (org-scoped).
   * `excludeSubjectUserId` excludes the caller's OWN subject-assignments from
   * the counts. An admin who is also a subject in this cycle (e.g. the sole
   * subject) must not be able to difference their own suppressed (<3)
   * peer/direct_report bucket size from the cycle-wide totals — that would
   * defeat myReport's min-3 anonymity omission via this endpoint.
   */
  async getProgressCounts(orgId: string, cycleId: string, excludeSubjectUserId: string) {
    return db.raterAssignment.groupBy({
      by: ['relationship', 'status'],
      where: { organizationId: orgId, cycleId, subjectUserId: { not: excludeSubjectUserId } },
      _count: { _all: true },
    });
  },

  // -------------------------------------------------------------------------
  // Slice 3 — rater self-service (identity-anchored). Every method below
  // takes `raterUserId` and filters on it directly (never via
  // scopeWhereFor/assertScoped) so the result set is always "this caller's
  // own assignments", regardless of the caller's RBAC scope.
  // -------------------------------------------------------------------------

  /** Pending assignments for this rater in an open cycle, newest cycle first. */
  async findRaterTasks(orgId: string, raterUserId: string) {
    return db.raterAssignment.findMany({
      where: {
        raterUserId,
        organizationId: orgId,
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
  },

  /** Existence + ownership probe for submitRatings' pre-fetch — org AND rater scoped. */
  async findAssignmentForRater(orgId: string, raterUserId: string, assignmentId: string) {
    return db.raterAssignment.findFirst({
      where: { id: assignmentId, organizationId: orgId, raterUserId },
      select: { id: true, status: true, cycle: { select: { status: true } } },
    });
  },

  /**
   * Atomically claims the assignment (guarded `updateMany`: id + org +
   * raterUserId + status:pending + cycle open) and, only if the claim
   * succeeded, `createMany`s the RaterResponse rows — both inside the SAME
   * `$transaction` so a failed insert rolls back the status flip. `count ===
   * 0` on the claim means the assignment isn't pending or the cycle isn't
   * open (already submitted / closed / unpublished race) — returned as
   * `claimed: false`, not thrown; the service maps that to CONFLICT.
   */
  async submitRatings(
    orgId: string,
    raterUserId: string,
    assignmentId: string,
    ratings: RatingSubmissionInput[],
  ): Promise<{ claimed: boolean }> {
    return db.$transaction(async (tx) => {
      const claim = await tx.raterAssignment.updateMany({
        where: {
          id: assignmentId,
          organizationId: orgId,
          raterUserId,
          status: 'pending',
          cycle: { is: { status: 'open' } },
        },
        data: { status: 'submitted', submittedAt: new Date() },
      });
      if (claim.count === 0) {
        return { claimed: false };
      }

      await tx.raterResponse.createMany({
        data: ratings.map((r) => ({
          assignmentId,
          organizationId: orgId,
          competencyKey: r.competencyKey,
          rating: r.rating,
          comment: r.comment ?? null,
        })),
      });
      return { claimed: true };
    });
  },

  // -------------------------------------------------------------------------
  // Slice 4 — myReport support (identity-anchored on subjectUserId). See
  // file docstring above for the raterUserId-exclusion rationale on
  // findReportRows.
  // -------------------------------------------------------------------------

  /** Existence + status check for the subject-report gate — org-scoped, published only. */
  async findPublishedCycle(orgId: string, cycleId: string) {
    return db.reviewCycle.findFirst({
      where: { id: cycleId, organizationId: orgId, status: 'published' },
      select: { id: true, name: true },
    });
  },

  /** True iff the caller is a subject of at least one assignment in this cycle (org-scoped). */
  async subjectHasAssignmentInCycle(orgId: string, cycleId: string, subjectUserId: string): Promise<boolean> {
    const found = await db.raterAssignment.findFirst({
      where: { cycleId, organizationId: orgId, subjectUserId },
      select: { id: true },
    });
    return found !== null;
  },

  /**
   * Slice 5 addition — every PUBLISHED cycle in which this caller is a
   * subject of at least one assignment (org-scoped, identity-anchored on
   * `subjectUserId` the same way the rest of this section is). Lets the "My
   * Reports" UI enumerate which cycles to call findReportRows/myReport for,
   * without needing the org-admin-only listCycles endpoint (which
   * requireOrgScope would 403 an own-scoped employee caller on).
   */
  async findPublishedCyclesForSubject(orgId: string, subjectUserId: string) {
    return db.reviewCycle.findMany({
      where: { organizationId: orgId, status: 'published', assignments: { some: { subjectUserId } } },
      select: { id: true, name: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });
  },

  /**
   * Aggregator input for the subject report: every SUBMITTED RaterResponse
   * for this subject in this cycle, flattened with `relationship` pulled
   * from the assignment relation. The select NEVER includes `raterUserId` —
   * neither on RaterResponse nor nested under `assignment` — so a rater's
   * user id never leaves the database layer.
   */
  async findReportRows(orgId: string, cycleId: string, subjectUserId: string): Promise<AggregateReportRow[]> {
    const rows = await db.raterResponse.findMany({
      where: {
        organizationId: orgId,
        assignment: { is: { cycleId, organizationId: orgId, subjectUserId, status: 'submitted' } },
      },
      select: {
        assignmentId: true,
        competencyKey: true,
        rating: true,
        comment: true,
        assignment: { select: { relationship: true } },
      },
    });
    return rows.map((r) => ({
      assignmentId: r.assignmentId,
      relationship: r.assignment.relationship,
      competencyKey: r.competencyKey,
      rating: r.rating,
      comment: r.comment,
    }));
  },
};
