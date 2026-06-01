import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const candidatePoolRouter = router({
  // 6.10 — Add to pool (change poolType)
  addToPool: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        poolType: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.candidate.findFirst({
        where: { id: input.candidateId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      return db.candidate.update({
        where: { id: input.candidateId },
        data: { poolType: input.poolType },
      });
    }),

  // 6.17 — Get pool statistics
  getPoolStats: permissionProcedure('candidate', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const stats = await db.candidate.groupBy({
      by: ['poolType'],
      where: { organizationId: orgId, isActive: true, deletedAt: null },
      _count: { id: true },
    });

    const total = stats.reduce((sum, s) => sum + s._count.id, 0);

    return {
      total,
      byPool: stats.map((s) => ({
        poolType: s.poolType,
        count: s._count.id,
      })),
    };
  }),

  // 6.19 — Export candidates (stub)
  export: permissionProcedure('candidate', 'read')
    .input(
      z.object({
        format: z.enum(['csv', 'xlsx']).default('csv'),
        poolType: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Stub: in production this would generate and upload the file to S3
      return {
        downloadUrl: `https://storage.tims.app/${ctx.user.organizationId}/exports/candidates-${Date.now()}.${input.format}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        format: input.format,
        status: 'stub_generated',
      };
    }),
});
