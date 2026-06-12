import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';
import { scopeWhereFor, assertScoped } from '../../access';

export const candidateTagsRouter = router({
  addTag: permissionProcedure('candidate', 'update')
    .input(z.object({
      candidateId: z.string().uuid(),
      tag: z.string().min(1).max(50),
      source: z.string().max(50).default('manual'),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.addTag(ctx.user.organizationId, input.candidateId, input.tag, input.source);
    }),

  removeTag: permissionProcedure('candidate', 'update')
    .input(z.object({ candidateId: z.string().uuid(), tag: z.string().max(50) }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.removeTag(ctx.user.organizationId, input.candidateId, input.tag);
    }),

  bulkTag: permissionProcedure('candidate', 'update')
    .input(z.object({
      candidateIds: z.array(z.string().uuid()).min(1).max(200),
      tag: z.string().min(1).max(50),
      source: z.string().max(50).default('bulk'),
    }))
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
      return candidateService.bulkTag(ctx.user.organizationId, scopeWhere, input.candidateIds, input.tag, input.source);
    }),
});
