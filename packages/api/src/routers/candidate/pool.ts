import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';
import { scopeWhereFor, assertScoped } from '../../access';
import { logPlatformExport } from '../../access/security-audit';

export const candidatePoolRouter = router({
  addToPool: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        poolType: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.addToPool(ctx.user.organizationId, input.candidateId, input.poolType);
    }),

  getPoolStats: permissionProcedure('candidate', 'read').query(async ({ ctx }) => {
    const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
    return candidateService.getPoolStats(ctx.user.organizationId, scopeWhere);
  }),

  export: permissionProcedure('candidate', 'read')
    .input(
      z.object({
        format: z.literal('csv').default('csv'),
        poolType: z.string().max(100).optional(),
        tags: z.array(z.string().max(100)).max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
      const result = await candidateService.exportPool(ctx.user.organizationId, scopeWhere, {
        poolType: input.poolType,
        tags: input.tags,
      });
      logPlatformExport(ctx, {
        resource: 'candidate_pool',
        count: result.count,
        format: 'csv',
        truncated: result.truncated,
      });
      return { ...result, format: 'csv' as const };
    }),
});
