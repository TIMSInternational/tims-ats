import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { scopeWhereFor, assertScoped, assertSubjectInScope } from '../../access';

export const performanceOkrsRouter = router({
  // 11.1 — List OKRs
  listOkrs: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        userId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
        period: z.string().max(100).optional(),
        status: z.string().max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, userId, teamId, period, status } = input;
      const scopeWhere = (await scopeWhereFor('okr', ctx.access, ctx.user.id)) as Prisma.OkrWhereInput;

      const where: Prisma.OkrWhereInput = {
        AND: [
          { organizationId: ctx.user.organizationId },
          scopeWhere,
          {
            ...(userId ? { userId } : {}),
            ...(teamId ? { teamId } : {}),
            ...(period ? { period } : {}),
            ...(status ? { status } : {}),
          },
        ],
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
      const scopeWhere = (await scopeWhereFor('okr', ctx.access, ctx.user.id)) as Prisma.OkrWhereInput;
      const okr = await db.okr.findFirst({
        where: {
          AND: [{ id: input.id, organizationId: ctx.user.organizationId }, scopeWhere],
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
        period: z.string().max(100),
        keyResults: z
          .array(
            z.object({
              title: z.string().min(1).max(500),
              targetValue: z.number(),
              unit: z.string().max(100).optional(),
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

      // Narrow scopes may only create OKRs for users inside their subject set
      // (no row exists yet, so the target itself is the thing to authorize).
      await assertSubjectInScope(
        ctx.access,
        ctx.user.id,
        input.userId,
        'No puedes crear OKRs para este usuario',
      );

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
        period: z.string().max(100).optional(),
        status: z.string().max(100).optional(),
        progress: z.number().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Scope + IDOR probe: a narrow scope must not reach an out-of-scope OKR by id.
      await assertScoped('okr', id, ctx.access, ctx.user.id, ctx.user.organizationId);

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
        status: z.string().max(100).optional(),
        title: z.string().min(1).max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Child table: fetch the (org-scoped) key result to find its parent OKR,
      // then probe the parent so narrow scopes can't reach an out-of-scope OKR's
      // key results by id.
      const existing = await db.keyResult.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
        select: { id: true, okrId: true },
      });
      if (!existing) throw new Error('Key Result no encontrado');
      await assertScoped('okr', existing.okrId, ctx.access, ctx.user.id, ctx.user.organizationId);

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
