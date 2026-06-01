import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const vacancyApprovalsRouter = router({
  // 4.8 — Submit vacancy for approval
  submitForApproval: permissionProcedure('vacancy', 'update')
    .input(z.object({
      id: z.string().uuid(),
      approverIds: z.array(z.string().uuid()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, status: 'draft', deletedAt: null },
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
          include: { approvals: { orderBy: { step: 'asc' } } },
        });
      });
    }),

  // 4.9 — Approve vacancy
  approve: permissionProcedure('vacancy', 'approve')
    .input(z.object({
      id: z.string().uuid(),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const approval = await db.vacancyApproval.findFirst({
        where: {
          vacancyId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
      });
      if (!approval) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay aprobacion pendiente para este usuario' });
      }

      await db.vacancyApproval.update({
        where: { id: approval.id },
        data: { status: 'approved', comment: input.comment, decidedAt: new Date() },
      });

      // Check if all approvals are done
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
        include: { approvals: { orderBy: { step: 'asc' } } },
      });
    }),

  // 4.10 — Reject vacancy
  reject: permissionProcedure('vacancy', 'approve')
    .input(z.object({
      id: z.string().uuid(),
      comment: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const approval = await db.vacancyApproval.findFirst({
        where: {
          vacancyId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
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

        // Cancel remaining pending approvals
        await tx.vacancyApproval.updateMany({
          where: { vacancyId: input.id, status: 'pending' },
          data: { status: 'cancelled' },
        });

        return tx.vacancy.findUniqueOrThrow({
          where: { id: input.id },
          include: { approvals: { orderBy: { step: 'asc' } } },
        });
      });
    }),

  // 4.19 — Get approval chain for a vacancy
  getApprovalChain: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.vacancyApproval.findMany({
        where: { vacancyId: input.vacancyId },
        orderBy: { step: 'asc' },
        include: {
          approver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });
    }),
});
