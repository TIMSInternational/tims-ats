import { TRPCError } from '@trpc/server';
import type { RaterRelationship } from '@tims/db';
import { EVAL360_COMPETENCIES } from '@tims/shared';
import {
  evaluation360Repository,
  type RaterAssignmentInput,
  type RatingSubmissionInput,
} from '../repositories/evaluation360.repository';
import { aggregate360Report } from './evaluation360-aggregate';

// ---------------------------------------------------------------------------
// evaluation360 service — Slice 2: admin cycle CRUD + rater assignment.
// Cycle status transitions (draft -> open -> closed -> published) are
// enforced via atomic guarded `updateMany`s in the repository; `count === 0`
// means the transition was illegal (cycle absent, wrong org, or not in the
// expected current state) and is surfaced as CONFLICT here. Anonymity /
// report-shaping rules (self shown, manager attributed, peer/direct_report
// suppressed below 3 raters) belong to a later slice, not this one.
//
// Slice 3 addition (bottom of file): myRaterTasks/submitRatings are
// IDENTITY-anchored self-service — every repo call is keyed to
// (orgId, raterUserId) where raterUserId is ALWAYS the caller (ctx.user.id,
// passed in by the router). Deliberately NOT scope-aware: assertScoped/
// scopeWhereFor resolve to {} for an org-scoped caller (super_admin/
// hr_admin), which would let an admin submit/read on behalf of another
// rater — forged 360 feedback. A hard raterUserId filter closes that gap
// regardless of the caller's RBAC scope.
// ---------------------------------------------------------------------------

const ILLEGAL_TRANSITION_MESSAGE = 'La transición no es válida para el estado actual del ciclo';
const SUBMISSION_NOT_FOUND_MESSAGE = 'Evaluación no encontrada';
const SUBMISSION_CONFLICT_MESSAGE = 'La evaluación no está abierta o ya fue enviada';
// Deliberately the SAME message/code for both myReport NOT_FOUND gates (cycle
// not published vs. caller not a subject) — never let the caller distinguish
// "this report doesn't exist" from "this report isn't yours to see".
const REPORT_NOT_FOUND_MESSAGE = 'Reporte no encontrado';

const PROGRESS_RELATIONSHIPS: RaterRelationship[] = ['self', 'manager', 'peer', 'direct_report'];

export const evaluation360Service = {
  async createCycle(orgId: string, createdById: string, name: string) {
    return evaluation360Repository.createCycle(orgId, createdById, name);
  },

  async openCycle(orgId: string, cycleId: string) {
    const { count } = await evaluation360Repository.openCycle(orgId, cycleId);
    if (count === 0) {
      throw new TRPCError({ code: 'CONFLICT', message: ILLEGAL_TRANSITION_MESSAGE });
    }
    return { cycleId, status: 'open' as const };
  },

  async closeCycle(orgId: string, cycleId: string) {
    const { count } = await evaluation360Repository.closeCycle(orgId, cycleId);
    if (count === 0) {
      throw new TRPCError({ code: 'CONFLICT', message: ILLEGAL_TRANSITION_MESSAGE });
    }
    return { cycleId, status: 'closed' as const };
  },

  async publishCycle(orgId: string, cycleId: string) {
    const { count } = await evaluation360Repository.publishCycle(orgId, cycleId);
    if (count === 0) {
      throw new TRPCError({ code: 'CONFLICT', message: ILLEGAL_TRANSITION_MESSAGE });
    }
    return { cycleId, status: 'published' as const };
  },

  async listCycles(orgId: string) {
    return evaluation360Repository.listCycles(orgId);
  },

  async assignRaters(orgId: string, cycleId: string, assignments: RaterAssignmentInput[]) {
    // Status re-check + org-membership validation + createMany all happen inside
    // ONE repository-level $transaction (TOCTOU-safe: no separate pre-read the
    // status guard could race against a concurrent closeCycle). See repository
    // docstring for detail.
    const { cycleNotOpen, missingUserIds, created } = await evaluation360Repository.assignRaters(
      orgId,
      cycleId,
      assignments,
      ['draft', 'open'],
    );
    if (cycleNotOpen) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'El ciclo debe estar en borrador o abierto para asignar evaluadores',
      });
    }
    if (missingUserIds.length > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Uno o más usuarios no pertenecen a esta organización',
      });
    }

    return { created };
  },

  // `callerUserId` excludes the caller's own subject-assignments from the
  // progress counts (see repository docstring) — an admin who is also a
  // subject in this cycle must not be able to difference their own
  // suppressed peer/direct_report bucket via this endpoint.
  async getCycleProgress(orgId: string, cycleId: string, callerUserId: string) {
    const cycle = await evaluation360Repository.getCycleForOrg(orgId, cycleId);
    if (!cycle) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ciclo no encontrado' });
    }

    const rows = await evaluation360Repository.getProgressCounts(orgId, cycleId, callerUserId);
    const progress = PROGRESS_RELATIONSHIPS.map((relationship) => {
      const relationshipRows = rows.filter((r) => r.relationship === relationship);
      const total = relationshipRows.reduce((sum, r) => sum + r._count._all, 0);
      const submitted = relationshipRows
        .filter((r) => r.status === 'submitted')
        .reduce((sum, r) => sum + r._count._all, 0);
      return { relationship, total, submitted };
    });

    return { cycleId, progress };
  },

  // -------------------------------------------------------------------------
  // Slice 3 — rater self-service. `raterUserId` here is always ctx.user.id
  // from the router — this service never accepts a caller-supplied rater id.
  // -------------------------------------------------------------------------

  async myRaterTasks(orgId: string, raterUserId: string) {
    const rows = await evaluation360Repository.findRaterTasks(orgId, raterUserId);
    return rows.map((row) => ({
      assignmentId: row.id,
      cycleId: row.cycleId,
      cycleName: row.cycle.name,
      relationship: row.relationship,
      subject: { firstName: row.subject.firstName, lastName: row.subject.lastName },
      competencies: EVAL360_COMPETENCIES,
    }));
  },

  async submitRatings(orgId: string, raterUserId: string, assignmentId: string, ratings: RatingSubmissionInput[]) {
    // Pre-fetch is ownership-anchored (id + organizationId + raterUserId) so a
    // mismatch on ANY of those three is indistinguishable from the outside —
    // NOT_FOUND either way, never leaking which condition failed.
    const assignment = await evaluation360Repository.findAssignmentForRater(orgId, raterUserId, assignmentId);
    if (!assignment) {
      throw new TRPCError({ code: 'NOT_FOUND', message: SUBMISSION_NOT_FOUND_MESSAGE });
    }

    // Atomic claim + response insert happen together in ONE repository
    // transaction (TOCTOU-safe against a concurrent re-submit or a cycle
    // closing between this pre-fetch and the write).
    const { claimed } = await evaluation360Repository.submitRatings(orgId, raterUserId, assignmentId, ratings);
    if (!claimed) {
      throw new TRPCError({ code: 'CONFLICT', message: SUBMISSION_CONFLICT_MESSAGE });
    }

    return { assignmentId, status: 'submitted' as const };
  },

  // -------------------------------------------------------------------------
  // Slice 4 — myReport (identity-anchored, published-only). `subjectUserId`
  // here is always ctx.user.id from the router — this service never accepts
  // a caller-supplied subject id. Two independent gates run BEFORE any
  // aggregation, both surfaced as the SAME NOT_FOUND: (1) the cycle must be
  // published in this org (never reveal a draft/open/closed cycle's report
  // shape), (2) the caller must be a subject of >=1 assignment in it. Only
  // after both pass do we fetch aggregator rows and hand them to the PURE
  // aggregate360Report (min-3 anonymity) — see services/evaluation360-aggregate.ts.
  // -------------------------------------------------------------------------

  async myReport(orgId: string, subjectUserId: string, cycleId: string) {
    const cycle = await evaluation360Repository.findPublishedCycle(orgId, cycleId);
    if (!cycle) {
      throw new TRPCError({ code: 'NOT_FOUND', message: REPORT_NOT_FOUND_MESSAGE });
    }

    const isSubject = await evaluation360Repository.subjectHasAssignmentInCycle(orgId, cycleId, subjectUserId);
    if (!isSubject) {
      throw new TRPCError({ code: 'NOT_FOUND', message: REPORT_NOT_FOUND_MESSAGE });
    }

    const rows = await evaluation360Repository.findReportRows(orgId, cycleId, subjectUserId);
    const buckets = aggregate360Report(rows);

    return { cycleId, cycleName: cycle.name, buckets };
  },

  // -------------------------------------------------------------------------
  // Slice 5 — myReportCycles (identity-anchored, same shape as myReport).
  // `subjectUserId` is always ctx.user.id from the router. Lets the "My
  // Reports" participant UI discover which published cycles it should call
  // myReport(cycleId) for, without the org-admin-only listCycles endpoint.
  // -------------------------------------------------------------------------

  async myReportCycles(orgId: string, subjectUserId: string) {
    const cycles = await evaluation360Repository.findPublishedCyclesForSubject(orgId, subjectUserId);
    return cycles.map((c) => ({ cycleId: c.id, cycleName: c.name, publishedAt: c.publishedAt }));
  },
};
