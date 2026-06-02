import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';

export const candidatePoolRouter = router({
  addToPool: permissionProcedure('candidate', 'update')
    .input(z.object({
      candidateId: z.string().uuid(),
      poolType: z.string().min(1).max(100),
    }))
    .mutation(({ ctx, input }) =>
      candidateService.addToPool(ctx.user.organizationId, input.candidateId, input.poolType),
    ),

  getPoolStats: permissionProcedure('candidate', 'read')
    .query(({ ctx }) => candidateService.getPoolStats(ctx.user.organizationId)),

  export: permissionProcedure('candidate', 'read')
    .input(z.object({
      format: z.enum(['csv', 'xlsx']).default('csv'),
      poolType: z.string().max(100).optional(),
      tags: z.array(z.string().max(100)).max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Stub — will be replaced with real CSV generation in Phase 1.5
      return {
        downloadUrl: `https://storage.tims.app/${ctx.user.organizationId}/exports/candidates-${Date.now()}.${input.format}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        format: input.format,
        status: 'stub_generated',
      };
    }),
});
