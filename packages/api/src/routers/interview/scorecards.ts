import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { assertScoped, scopeWhereFor } from '../../access';
import { scorecardVisibilityService, visibleScorecard } from '../../services/scorecard-visibility.service';
import { scorecardSubmissionService } from '../../services/scorecard-submission.service';
import { MAX_RATING_KEYS, RATING_KEY_MAX } from '@tims/shared';
import type { Prisma } from '@tims/db';

export const interviewScorecardsRouter = router({
  // 8.6 — Get scorecard for a specific interview + evaluator
  getScorecard: permissionProcedure('interview', 'read')
    .input(
      z.object({
        interviewId: z.string().uuid(),
        evaluatorId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);
      const evaluatorId = input.evaluatorId ?? ctx.user.id;

      const scorecard = await db.interviewScorecard.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
          evaluatorId,
        },
        include: {
          evaluator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });
      if (!scorecard) return null;

      // Blind evaluation: asking for SOMEONE ELSE's card obeys the same rule as
      // getById — a blinded panel evaluator gets a status stub, not the content.
      const blinded =
        evaluatorId !== ctx.user.id &&
        (await scorecardVisibilityService.isBlinded(ctx.user.organizationId, input.interviewId, ctx.user.id));
      return visibleScorecard(scorecard, ctx.user.id, blinded);
    }),

  // 8.7 — Submit a scorecard
  submitScorecard: permissionProcedure('interview', 'create')
    .input(
      z.object({
        interviewId: z.string().uuid(),
        ratings: z
          .record(z.string().max(RATING_KEY_MAX), z.number().min(1).max(5))
          .refine((r) => Object.keys(r).length <= MAX_RATING_KEYS, {
            message: `A lo sumo ${MAX_RATING_KEYS} competencias`,
          }),
        recommendation: z.enum(['strong_yes', 'yes', 'neutral', 'no', 'strong_no']),
        overallNotes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);

      // Slice-1 codex carry-over: only an ASSIGNED evaluator may submit a
      // scorecard — without this, any org member could upsert one (the upsert
      // keys on evaluatorId: ctx.user.id, so they'd forge their own row).
      const evaluator = await db.interviewEvaluator.findFirst({
        where: { interviewId: input.interviewId, userId: ctx.user.id, interview: { organizationId: ctx.user.organizationId } },
        select: { id: true },
      });
      if (!evaluator) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo un evaluador asignado puede enviar la evaluacion' });
      }

      // Completeness is enforced HERE (not only in the room UI): submitting is what
      // un-blinds an evaluator, so an empty/partial card must not count. A
      // re-submission is allowed (the room offers "Update") but audited — see
      // services/scorecard-submission.service.ts.
      const result = await scorecardSubmissionService.submit(
        ctx.user.organizationId,
        input.interviewId,
        ctx.user.id,
        ctx.user.impersonatorId ?? ctx.user.id,
        { ratings: input.ratings, recommendation: input.recommendation, overallNotes: input.overallNotes },
      );
      if (!result.ok) {
        throw result.reason === 'not_found'
          ? new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' })
          : new TRPCError({
              code: 'BAD_REQUEST',
              message: 'La evaluacion debe calificar todas las competencias de la entrevista',
            });
      }
      return result.scorecard;
    }),

  // 8.11 — Compare evaluator scores
  compareEvaluators: permissionProcedure('interview', 'read')
    .input(z.object({ interviewId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);
      // Aggregate view (averages + consensus) — refused while the caller is blinded.
      await scorecardVisibilityService.assertNotBlinded(ctx.user.organizationId, input.interviewId, ctx.user.id);

      const scorecards = await db.interviewScorecard.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
          submittedAt: { not: null },
        },
        include: {
          evaluator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });

      if (scorecards.length === 0) {
        return { interviewId: input.interviewId, evaluators: [], consensus: null };
      }

      const evaluators = scorecards.map((sc) => ({
        evaluator: sc.evaluator,
        recommendation: sc.recommendation,
        ratings: sc.ratings as Record<string, number>,
        submittedAt: sc.submittedAt,
      }));

      // Calculate average ratings across evaluators
      const allCriteria = new Set<string>();
      for (const e of evaluators) {
        for (const key of Object.keys(e.ratings)) {
          allCriteria.add(key);
        }
      }

      const averages: Record<string, number> = {};
      for (const criterion of allCriteria) {
        const scores = evaluators
          .map((e) => e.ratings[criterion])
          .filter((s): s is number => s !== undefined);
        averages[criterion] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      }

      const recommendations = evaluators.map((e) => e.recommendation);
      const consensus =
        new Set(recommendations).size === 1
          ? recommendations[0]
          : null;

      return {
        interviewId: input.interviewId,
        evaluators,
        averageRatings: averages,
        consensus,
      };
    }),

  // 8.15 — Get pending scorecards for current user
  getPendingScorecards: permissionProcedure('interview', 'read').query(async ({ ctx }) => {
    const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id) as Prisma.InterviewWhereInput;

    const evaluatorAssignments = await db.interviewEvaluator.findMany({
      where: {
        userId: ctx.user.id,
        status: 'pending',
        interview: {
          AND: [
            { organizationId: ctx.user.organizationId, status: { in: ['scheduled', 'rescheduled', 'completed'] } },
            scopeWhere,
          ],
        },
      },
      include: {
        interview: {
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, avatar: true },
            },
            vacancy: { select: { id: true, title: true } },
            scorecards: {
              where: { evaluatorId: ctx.user.id },
            },
          },
        },
      },
    });

    // Filter out interviews where the user already submitted a scorecard
    return evaluatorAssignments.filter(
      (a) => a.interview.scorecards.length === 0 || a.interview.scorecards[0].submittedAt === null
    );
  }),
});
