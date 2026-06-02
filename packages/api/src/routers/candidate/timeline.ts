import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';

export const candidateTimelineRouter = router({
  getTimeline: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      candidateService.getTimeline(ctx.user.organizationId, input.candidateId),
    ),

  applyToVacancy: permissionProcedure('candidate', 'create')
    .input(z.object({
      candidateId: z.string().uuid(),
      vacancyId: z.string().uuid(),
      source: z.string().max(100).default('manual'),
    }))
    .mutation(({ ctx, input }) =>
      candidateService.applyToVacancy(ctx.user.organizationId, input.candidateId, input.vacancyId, input.source),
    ),

  getRisks: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      candidateService.getRisks(ctx.user.organizationId, input.candidateId),
    ),

  getRecommendations: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      candidateService.getRecommendations(ctx.user.organizationId, input.candidateId),
    ),

  merge: permissionProcedure('candidate', 'delete')
    .input(z.object({
      primaryId: z.string().uuid(),
      duplicateId: z.string().uuid(),
    }))
    .mutation(({ ctx, input }) =>
      candidateService.merge(ctx.user.organizationId, input.primaryId, input.duplicateId),
    ),
});
