import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';
import { assertScoped, scopeWhereFor } from '../../access';

export const candidateTimelineRouter = router({
  getTimeline: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      // Codex F1: timeline child loads are filtered by the application fragment.
      const appScopeWhere = await scopeWhereFor('application', ctx.access, ctx.user.id);
      return candidateService.getTimeline(ctx.user.organizationId, input.candidateId, appScopeWhere);
    }),

  applyToVacancy: permissionProcedure('candidate', 'create')
    .input(z.object({
      candidateId: z.string().uuid(),
      vacancyId: z.string().uuid(),
      source: z.string().max(100).default('manual'),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.applyToVacancy(ctx.user.organizationId, input.candidateId, input.vacancyId, input.source);
    }),

  getRisks: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      const appScopeWhere = await scopeWhereFor('application', ctx.access, ctx.user.id);
      return candidateService.getRisks(ctx.user.organizationId, input.candidateId, appScopeWhere);
    }),

  getRecommendations: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.getRecommendations(ctx.user.organizationId, input.candidateId);
    }),

  merge: permissionProcedure('candidate', 'delete')
    .input(z.object({
      primaryId: z.string().uuid(),
      duplicateId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.primaryId, ctx.access, ctx.user.id, ctx.user.organizationId);
      await assertScoped('candidate', input.duplicateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.merge(ctx.user.organizationId, input.primaryId, input.duplicateId);
    }),
});
