import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const offerApprovalsRouter = router({
  // 9.5 — Submit offer for approval
  submitForApproval: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        approverIds: z.array(z.string().uuid()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      if (offer.status !== 'draft') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden enviar a aprobacion ofertas en estado borrador',
        });
      }

      return db.$transaction(async (tx) => {
        // Create approval chain
        await tx.offerApproval.createMany({
          data: input.approverIds.map((approverId, index) => ({
            organizationId: ctx.user.organizationId,
            offerId: input.id,
            approverId,
            step: index + 1,
            status: 'pending',
          })),
        });

        return tx.offer.update({
          where: { id: input.id },
          data: { status: 'pending_approval' },
          include: {
            approvals: {
              orderBy: { step: 'asc' },
              include: {
                approver: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        });
      });
    }),

  // 9.6 — Approve an offer
  approve: permissionProcedure('offer', 'approve')
    .input(
      z.object({
        id: z.string().uuid(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const approval = await db.offerApproval.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
      });

      if (!approval) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No se encontro aprobacion pendiente para este usuario',
        });
      }

      return db.$transaction(async (tx) => {
        await tx.offerApproval.update({
          where: { id: approval.id },
          data: {
            status: 'approved',
            comment: input.comment,
            decidedAt: new Date(),
          },
        });

        // Check if all approvals are done
        const pendingCount = await tx.offerApproval.count({
          where: {
            offerId: input.id,
            status: 'pending',
          },
        });

        if (pendingCount === 0) {
          return tx.offer.update({
            where: { id: input.id },
            data: { status: 'approved' },
          });
        }

        return tx.offer.findUnique({ where: { id: input.id } });
      });
    }),

  // 9.7 — Reject an offer
  reject: permissionProcedure('offer', 'approve')
    .input(
      z.object({
        id: z.string().uuid(),
        comment: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const approval = await db.offerApproval.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
      });

      if (!approval) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No se encontro aprobacion pendiente para este usuario',
        });
      }

      return db.$transaction(async (tx) => {
        await tx.offerApproval.update({
          where: { id: approval.id },
          data: {
            status: 'rejected',
            comment: input.comment,
            decidedAt: new Date(),
          },
        });

        return tx.offer.update({
          where: { id: input.id },
          data: { status: 'rejected' },
        });
      });
    }),

  // 9.9 — Get approval chain for an offer
  getApprovalChain: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.offerApproval.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
        },
        include: {
          approver: { select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true } },
        },
        orderBy: { step: 'asc' },
      });
    }),

  // 9.18 — Get pending offers (awaiting action by current user)
  getPending: permissionProcedure('offer', 'read').query(async ({ ctx }) => {
    // Get offers pending the current user's approval
    const pendingApprovals = await db.offerApproval.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        approverId: ctx.user.id,
        status: 'pending',
      },
      include: {
        offer: {
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            },
            vacancy: { select: { id: true, title: true } },
            creator: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return pendingApprovals.map((a) => ({
      approvalId: a.id,
      step: a.step,
      offer: a.offer,
    }));
  }),
});
