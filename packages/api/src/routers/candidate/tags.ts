import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const candidateTagsRouter = router({
  // 6.8 — Add tag
  addTag: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        tag: z.string().min(1).max(50),
        source: z.string().default('manual'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.candidateTag.create({
        data: {
          organizationId: ctx.user.organizationId,
          candidateId: input.candidateId,
          tag: input.tag,
          source: input.source,
        },
      });
    }),

  // 6.9 — Remove tag
  removeTag: permissionProcedure('candidate', 'update')
    .input(z.object({ candidateId: z.string().uuid(), tag: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.candidateTag.findFirst({
        where: {
          candidateId: input.candidateId,
          tag: input.tag,
          organizationId: ctx.user.organizationId,
        },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag no encontrado' });
      }

      await db.candidateTag.delete({ where: { id: existing.id } });
      return { success: true };
    }),

  // 6.18 — Bulk tag candidates
  bulkTag: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateIds: z.array(z.string().uuid()).min(1).max(200),
        tag: z.string().min(1).max(50),
        source: z.string().default('bulk'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.user.organizationId;

      // Verify all candidates belong to org
      const count = await db.candidate.count({
        where: { id: { in: input.candidateIds }, organizationId: orgId, deletedAt: null },
      });
      if (count !== input.candidateIds.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Uno o mas candidatos no encontrados' });
      }

      // Use createMany with skipDuplicates to avoid unique constraint errors
      const result = await db.candidateTag.createMany({
        data: input.candidateIds.map((candidateId) => ({
          organizationId: orgId,
          candidateId,
          tag: input.tag,
          source: input.source,
        })),
        skipDuplicates: true,
      });

      return { tagged: result.count };
    }),
});
