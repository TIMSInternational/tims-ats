import { z } from 'zod';
import { RATER_RELATIONSHIPS, EVAL360_COMPETENCIES } from '@tims/shared';
import { router, permissionProcedure, protectedProcedure } from '../trpc';
import { requireOrgScope } from '../access';
import { evaluation360Service } from '../services/evaluation360.service';

const cycleIdInput = z.object({ cycleId: z.string().uuid() });

const raterAssignmentInput = z.object({
  subjectUserId: z.string().uuid(),
  raterUserId: z.string().uuid(),
  relationship: z.enum(RATER_RELATIONSHIPS),
});

const ratingInput = z.object({
  competencyKey: z.enum(EVAL360_COMPETENCIES),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(5000).optional(),
});

export const submitRatingsInput = z.object({
  assignmentId: z.string().uuid(),
  ratings: z
    .array(ratingInput)
    .length(6)
    .refine(
      (arr) => new Set(arr.map((r) => r.competencyKey)).size === 6,
      'Debe calificar las 6 competencias exactamente una vez',
    ),
});

// ---------------------------------------------------------------------------
// The first seven procedures below are org-admin operations (cycle CRUD +
// rater assignment). requireOrgScope() is the FIRST statement in every
// resolver: permissionProcedure only checks a grant EXISTS for module+action,
// it does NOT enforce scope — without this gate, any sub-org role holding an
// evaluation360 grant (e.g. employee's own-scoped self-service grant) could
// reach these admin endpoints.
//
// myRaterTasks/submitRatings (Slice 3) are self-service and deliberately
// IDENTITY-anchored instead: every call passes ctx.user.id as the rater and
// ctx.user.organizationId as the org, and the service/repository hard-filter
// on `raterUserId = ctx.user.id` in every query/write. They must NOT call
// requireOrgScope (that's the org-admin gate above) and must NOT use
// assertScoped/scopeWhereFor — for an org-scoped caller (super_admin/
// hr_admin) those resolve their where-fragment to `{}` (see
// entity-policies.ts), which would let an admin submit/read on behalf of
// another rater (forged feedback). raterAssignment is intentionally NOT
// registered as a ScopedEntity for this reason.
//
// myReport (Slice 4) is the same identity-anchored shape, anchored on
// ctx.user.id as the SUBJECT instead of the rater: it must NOT call
// requireOrgScope/assertScoped/scopeWhereFor for the same reason — an
// org-scoped admin must never read another user's anonymized report by
// supplying their id, since there's no id param to supply in the first
// place (subject is always the caller). The service enforces
// cycle.status==='published' AND subject-membership before returning
// anything, and the aggregation (min-3 anonymity) happens in the PURE
// services/evaluation360-aggregate.ts module.
// ---------------------------------------------------------------------------
export const evaluation360Router = router({
  createCycle: permissionProcedure('evaluation360', 'create')
    .input(z.object({ name: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return evaluation360Service.createCycle(ctx.user.organizationId, ctx.user.id, input.name);
    }),

  openCycle: permissionProcedure('evaluation360', 'update')
    .input(cycleIdInput)
    .mutation(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return evaluation360Service.openCycle(ctx.user.organizationId, input.cycleId);
    }),

  closeCycle: permissionProcedure('evaluation360', 'update')
    .input(cycleIdInput)
    .mutation(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return evaluation360Service.closeCycle(ctx.user.organizationId, input.cycleId);
    }),

  publishCycle: permissionProcedure('evaluation360', 'update')
    .input(cycleIdInput)
    .mutation(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return evaluation360Service.publishCycle(ctx.user.organizationId, input.cycleId);
    }),

  assignRaters: permissionProcedure('evaluation360', 'create')
    .input(
      z.object({
        cycleId: z.string().uuid(),
        assignments: z.array(raterAssignmentInput).min(1).max(500),
      }),
    )
    .mutation(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return evaluation360Service.assignRaters(ctx.user.organizationId, input.cycleId, input.assignments);
    }),

  listCycles: permissionProcedure('evaluation360', 'read').query(({ ctx }) => {
    requireOrgScope(ctx.access);
    return evaluation360Service.listCycles(ctx.user.organizationId);
  }),

  getCycleProgress: permissionProcedure('evaluation360', 'read')
    .input(cycleIdInput)
    .query(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return evaluation360Service.getCycleProgress(ctx.user.organizationId, input.cycleId, ctx.user.id);
    }),

  // ---- Self-service (Slice 3) — identity-anchored, see docstring above. ----
  // protectedProcedure, not permissionProcedure: authorization here is
  // IDENTITY (raterUserId === ctx.user.id), not an RBAC grant — any staff
  // role (leader/hrbp/recruiter/committee) can be legitimately assigned as a
  // rater without holding an evaluation360 permission grant.

  myRaterTasks: protectedProcedure.query(({ ctx }) => {
    return evaluation360Service.myRaterTasks(ctx.user.organizationId, ctx.user.id);
  }),

  submitRatings: protectedProcedure.input(submitRatingsInput).mutation(({ ctx, input }) => {
    return evaluation360Service.submitRatings(ctx.user.organizationId, ctx.user.id, input.assignmentId, input.ratings);
  }),

  // ---- Self-service (Slice 4) — identity-anchored, see docstring above. ----
  // protectedProcedure — same identity rationale as above, anchored on
  // subjectUserId === ctx.user.id instead of raterUserId.

  myReport: protectedProcedure.input(cycleIdInput).query(({ ctx, input }) => {
    return evaluation360Service.myReport(ctx.user.organizationId, ctx.user.id, input.cycleId);
  }),

  // ---- Self-service (Slice 5) — identity-anchored, see docstring above. ----
  // Lets the "My Reports" UI enumerate published cycles to call myReport for,
  // without the org-admin-only listCycles endpoint (the admin org-gate above
  // would reject an own-scoped employee caller there). protectedProcedure —
  // same identity rationale as the other three self-service procedures.

  myReportCycles: protectedProcedure.query(({ ctx }) => {
    return evaluation360Service.myReportCycles(ctx.user.organizationId, ctx.user.id);
  }),
});
