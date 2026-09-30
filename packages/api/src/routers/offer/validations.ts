import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { assertScoped } from '../../access';

export const offerValidationsRouter = router({
  // 9.10 — List pre-employment validations
  listValidations: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('offer', input.offerId, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.preemploymentValidation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
        },
        include: {
          completedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  // 9.11 — Update a pre-employment validation
  updateValidation: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['pending', 'passed', 'failed', 'waived']),
        result: z.record(z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
        notes: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch-then-probe hop: the input key is a child id (validationId), not
      // an offerId. Fetch the validation to get its offerId, then scope-probe
      // the parent offer — pipeline stages pattern.
      const validation = await db.preemploymentValidation.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        select: { id: true, offerId: true, status: true, offer: { select: { status: true } } },
      });

      if (!validation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Validacion no encontrada' });
      }

      await assertScoped('offer', validation.offerId, ctx.access, ctx.user.id, ctx.user.organizationId);
      if (validation.offer.status === 'converted') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No se pueden cambiar validaciones de una contratación registrada' });
      }

      return db.preemploymentValidation.update({
        where: { id: input.id },
        data: {
          status: input.status,
          result: (input.result as Prisma.InputJsonValue) ?? undefined,
          notes: input.notes,
          completedById: ctx.user.id,
          completedByApiKeyId: null,
          completedAt: input.status !== 'pending' ? new Date() : null,
        },
      });
    }),

  // 9.14 — Get legal checklist for an offer
  getLegalChecklist: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('offer', input.offerId, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.legalCheck.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
        },
        include: {
          completedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  // 9.15 — Update a legal check
  updateLegalCheck: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        completed: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch-then-probe hop: input key is a child id (legalCheckId). Fetch the
      // check to get its offerId, then scope-probe the parent offer.
      const check = await db.legalCheck.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        select: { id: true, offerId: true, offer: { select: { status: true } } },
      });

      if (!check) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verificacion legal no encontrada' });
      }

      await assertScoped('offer', check.offerId, ctx.access, ctx.user.id, ctx.user.organizationId);
      if (check.offer.status === 'converted') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No se pueden cambiar verificaciones de una contratación registrada' });
      }

      return db.legalCheck.update({
        where: { id: input.id },
        data: {
          completed: input.completed,
          completedAt: input.completed ? new Date() : null,
          completedById: input.completed ? ctx.user.id : null,
        },
      });
    }),
});
