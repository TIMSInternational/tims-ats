import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { scopeWhereFor, assertScoped } from '../../access';

// ---------------------------------------------------------------------------
// Shared selects
// ---------------------------------------------------------------------------

const approvalSelect = {
  id: true,
  step: true,
  status: true,
  comment: true,
  decidedAt: true,
  approver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
} as const;

const vacancyWithApprovalsSelect = {
  id: true,
  title: true,
  status: true,
  approvals: { orderBy: { step: 'asc' as const }, select: approvalSelect },
} as const;

// ---------------------------------------------------------------------------
// Approvals sub-router
// ---------------------------------------------------------------------------

export const vacancyApprovalsRouter = router({
  submitForApproval: permissionProcedure('vacancy', 'update')
    .input(z.object({
      id: z.string().uuid(),
      approverIds: z.array(z.string().uuid()).min(1).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const vacancy = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, status: 'draft', deletedAt: null },
        select: { id: true },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada o no esta en borrador' });
      }

      return db.$transaction(async (tx) => {
        await tx.vacancy.update({
          where: { id: input.id },
          data: { status: 'pending_approval' },
        });

        await tx.vacancyApproval.createMany({
          data: input.approverIds.map((approverId, idx) => ({
            organizationId: ctx.user.organizationId,
            vacancyId: input.id,
            approverId,
            step: idx + 1,
            status: 'pending',
          })),
        });

        return tx.vacancy.findUniqueOrThrow({
          where: { id: input.id },
          select: vacancyWithApprovalsSelect,
        });
      });
    }),

  approve: permissionProcedure('vacancy', 'approve')
    .input(z.object({
      id: z.string().uuid(),
      comment: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const approval = await db.vacancyApproval.findFirst({
        where: {
          vacancyId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
        select: { id: true },
      });
      if (!approval) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay aprobacion pendiente para este usuario' });
      }

      await db.vacancyApproval.update({
        where: { id: approval.id },
        data: { status: 'approved', comment: input.comment, decidedAt: new Date() },
      });

      const pendingCount = await db.vacancyApproval.count({
        where: { vacancyId: input.id, status: 'pending' },
      });

      if (pendingCount === 0) {
        await db.vacancy.update({
          where: { id: input.id },
          data: { status: 'approved' },
        });
      }

      return db.vacancy.findUniqueOrThrow({
        where: { id: input.id },
        select: vacancyWithApprovalsSelect,
      });
    }),

  reject: permissionProcedure('vacancy', 'approve')
    .input(z.object({
      id: z.string().uuid(),
      comment: z.string().min(1).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const approval = await db.vacancyApproval.findFirst({
        where: {
          vacancyId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
        select: { id: true },
      });
      if (!approval) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay aprobacion pendiente para este usuario' });
      }

      return db.$transaction(async (tx) => {
        await tx.vacancyApproval.update({
          where: { id: approval.id },
          data: { status: 'rejected', comment: input.comment, decidedAt: new Date() },
        });

        await tx.vacancy.update({
          where: { id: input.id },
          data: { status: 'draft' },
        });

        await tx.vacancyApproval.updateMany({
          where: { vacancyId: input.id, status: 'pending' },
          data: { status: 'cancelled' },
        });

        return tx.vacancy.findUniqueOrThrow({
          where: { id: input.id },
          select: vacancyWithApprovalsSelect,
        });
      });
    }),

  getApprovalChain: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('vacancy', ctx.access, ctx.user.id);
      const vacancy = await db.vacancy.findFirst({
        where: {
          AND: [
            { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
            scopeWhere as Prisma.VacancyWhereInput,
          ],
        },
        select: { id: true },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.vacancyApproval.findMany({
        where: { vacancyId: input.vacancyId },
        orderBy: { step: 'asc' },
        select: approvalSelect,
      });
    }),
});
