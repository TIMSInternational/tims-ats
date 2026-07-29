import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertSubjectInScope, requireOrgScope } from '../access';
import {
  getAxisBreakdownInput,
  getMovementHistoryInput,
  simulateInput,
  submitCalibrationVoteInput,
  finalizeCalibrationInput,
  getQuadrantPlanInput,
} from './ninebox.schemas';
import { simulateBands, resolveQuadrantPlan, computeMovements } from '@tims/shared';

export const nineboxRouter = router({
  // ── Grid ─────────────────────────────────────────────────────────────

  getAxisBreakdown: permissionProcedure('ninebox', 'read')
    .input(getAxisBreakdownInput)
    .query(async ({ ctx, input }) => {
      // Point-read keyed on a target userId → subject-scope it.
      await assertSubjectInScope(
        ctx.access,
        ctx.user.id,
        input.userId,
        'No puedes ver esta evaluacion',
      );

      const evaluation = await db.nineBoxEvaluation.findFirstOrThrow({
        where: {
          organizationId: ctx.user.organizationId,
          userId: input.userId,
          period: input.period,
        },
      });

      return {
        userId: input.userId,
        period: input.period,
        potentialScore: evaluation.potentialScore,
        performanceScore: evaluation.performanceScore,
        quadrant: evaluation.quadrant,
        confidence: evaluation.confidence,
        axisBreakdown: evaluation.axisBreakdown,
      };
    }),

  getMovementHistory: permissionProcedure('ninebox', 'read')
    .input(getMovementHistoryInput)
    .query(async ({ ctx, input }) => {
      // Row-level read → compose the evaluation scope fragment; the input
      // userId/companyId filters only intersect within the caller's grant.
      const scopeWhere = (await scopeWhereFor('nineBoxEvaluation', ctx.access, ctx.user.id)) as Prisma.NineBoxEvaluationWhereInput;

      const evaluations = await db.nineBoxEvaluation.findMany({
        where: {
          AND: [
            {
              organizationId: ctx.user.organizationId,
              ...(input.userId && { userId: input.userId }),
              ...(input.companyId && { user: { companyId: input.companyId } }),
            },
            scopeWhere,
          ],
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ userId: 'asc' }, { evaluatedAt: 'asc' }],
      });

      // Pure kernel (@tims/shared) — per-user consecutive quadrant-change movements over the
      // pre-ordered (userId asc, evaluatedAt asc) rows, golden-fixtured both stacks.
      const movements = computeMovements(
        evaluations.map((ev) => ({
          userId: ev.userId,
          firstName: ev.user.firstName,
          lastName: ev.user.lastName,
          period: ev.period,
          quadrant: ev.quadrant,
        })),
      );

      return { movements, totalMovements: movements.length };
    }),

  // Stub: simulate placement changes
  simulate: permissionProcedure('ninebox', 'read')
    .input(simulateInput)
    .query(async ({ input }) => {
      // TODO: integrate with scoring engine. Pure kernel (@tims/shared) — golden-fixtured both stacks.
      return {
        userId: input.userId,
        ...simulateBands(input.newPotentialScore, input.newPerformanceScore),
        _stub: true,
      };
    }),

  // ── Calibration ──────────────────────────────────────────────────────

  submitCalibrationVote: permissionProcedure('ninebox', 'update')
    .input(submitCalibrationVoteInput)
    .mutation(async ({ ctx, input }) => {
      // Committee-membership rule (mirrors interview submitScorecard): a vote
      // may only be cast by a MEMBER of the calibration session's committee.
      // (a) the session must exist within the org (NOT_FOUND otherwise — does
      //     not confirm the id to outsiders).
      const session = await db.calibrationSession.findFirst({
        where: { id: input.sessionId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de calibracion no encontrada' });
      }
      // (b) the VOTER (ctx.user.id — never input; the upsert keys voterId off
      //     ctx so a non-member can't forge a row) must be a committee member.
      const membership = await db.calibrationMember.findFirst({
        where: { sessionId: input.sessionId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Solo un miembro del comite puede votar',
        });
      }
      // (c) the EVALUATED user must be a real member of this org (codex: an
      //     unvalidated FK let votes target arbitrary/cross-tenant user ids).
      //     Deliberately NOT subject-scoped: committee panels calibrate across
      //     teams — session MEMBERSHIP is the authority, not the voter's team.
      const evaluated = await db.user.findFirst({
        where: { id: input.evaluatedUserId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!evaluated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario evaluado no encontrado' });
      }

      return db.calibrationVote.upsert({
        where: {
          sessionId_evaluatedUserId_voterId: {
            sessionId: input.sessionId,
            evaluatedUserId: input.evaluatedUserId,
            voterId: ctx.user.id,
          },
        },
        create: {
          sessionId: input.sessionId,
          evaluatedUserId: input.evaluatedUserId,
          voterId: ctx.user.id,
          quadrant: input.quadrant,
          justification: input.justification,
        },
        update: {
          quadrant: input.quadrant,
          justification: input.justification,
        },
      });
    }),

  finalizeCalibration: permissionProcedure('ninebox', 'update')
    .input(finalizeCalibrationInput)
    .mutation(async ({ ctx, input }) => {
      // Finalizing a session is an org-governance lifecycle act, not a
      // committee-member grant → org/company scope only.
      requireOrgScope(ctx.access);

      return db.calibrationSession.update({
        where: {
          id: input.sessionId,
          organizationId: ctx.user.organizationId,
        },
        data: {
          status: 'finalized',
          completedAt: new Date(),
        },
      });
    }),

  // ── Plans & Analytics ────────────────────────────────────────────────

  getQuadrantPlan: permissionProcedure('ninebox', 'read')
    .input(getQuadrantPlanInput)
    .query(async ({ input }) => {
      return resolveQuadrantPlan(input.quadrant);
    }),

});
