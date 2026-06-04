import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';

export const performanceOkrsRouter = router({
  // 11.1 — List OKRs
  listOkrs: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        userId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
        period: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, userId, teamId, period, status } = input;

      const where = {
        organizationId: ctx.user.organizationId,
        ...(userId ? { userId } : {}),
        ...(teamId ? { teamId } : {}),
        ...(period ? { period } : {}),
        ...(status ? { status } : {}),
      };

      const okrs = await db.okr.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          team: { select: { id: true, name: true } },
          keyResults: true,
        },
      });

      let nextCursor: string | undefined;
      if (okrs.length > limit) {
        const nextItem = okrs.pop();
        nextCursor = nextItem?.id;
      }

      return { okrs, nextCursor };
    }),

  // 11.2 — Get OKR by ID
  getOkrById: permissionProcedure('performance', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const okr = await db.okr.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.user.organizationId,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
          team: { select: { id: true, name: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          keyResults: { orderBy: { updatedAt: 'desc' } },
        },
      });

      if (!okr) {
        throw new Error('OKR no encontrado');
      }

      return okr;
    }),

  // 11.3 — Create OKR
  createOkr: permissionProcedure('performance', 'create')
    .input(
      z.object({
        userId: z.string().uuid(),
        teamId: z.string().uuid().optional(),
        title: z.string().min(1).max(500),
        period: z.string(),
        keyResults: z
          .array(
            z.object({
              title: z.string().min(1).max(500),
              targetValue: z.number(),
              unit: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { keyResults, ...okrData } = input;

      // Verify the referenced user belongs to the caller's org (no cross-tenant ref)
      const userInOrg = await db.user.count({
        where: { id: input.userId, organizationId: ctx.user.organizationId },
      });
      if (userInOrg === 0) {
        throw new Error('Usuario referenciado no encontrado en esta organizacion');
      }

      return db.okr.create({
        data: {
          ...okrData,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          ...(keyResults && keyResults.length > 0
            ? {
                keyResults: {
                  create: keyResults.map((kr) => ({
                    ...kr,
                    organizationId: ctx.user.organizationId,
                  })),
                },
              }
            : {}),
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          keyResults: true,
        },
      });
    }),

  // 11.4 — Update OKR
  updateOkr: permissionProcedure('performance', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        period: z.string().optional(),
        status: z.string().optional(),
        progress: z.number().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Verify the OKR belongs to the caller's org (IDOR prevention)
      const okr = await db.okr.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!okr) throw new Error('OKR no encontrado');

      return db.okr.update({
        where: { id },
        data,
        include: { keyResults: true },
      });
    }),

  // 11.5 — Update Key Result
  updateKeyResult: permissionProcedure('performance', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        currentValue: z.number().optional(),
        targetValue: z.number().optional(),
        status: z.string().optional(),
        title: z.string().min(1).max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Verify the key result belongs to the caller's org (IDOR prevention)
      const existing = await db.keyResult.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!existing) throw new Error('Key Result no encontrado');

      const keyResult = await db.keyResult.update({
        where: { id },
        data,
        include: { okr: { select: { id: true } } },
      });

      // Recalculate OKR progress from all key results
      const allKrs = await db.keyResult.findMany({
        where: { okrId: keyResult.okr.id },
      });

      if (allKrs.length > 0) {
        const avgProgress =
          allKrs.reduce((sum, kr) => {
            const pct = kr.targetValue > 0 ? (kr.currentValue / kr.targetValue) * 100 : 0;
            return sum + Math.min(100, pct);
          }, 0) / allKrs.length;

        await db.okr.update({
          where: { id: keyResult.okr.id },
          data: { progress: Math.round(avgProgress) },
        });
      }

      return keyResult;
    }),
});
