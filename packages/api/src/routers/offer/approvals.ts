import { z } from 'zod';
import { router, permissionProcedure, anyPermissionProcedure } from '../../trpc';
import { tenantDb as db, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { scopeWhereFor, assertScoped, buildAccessForUser, createAnchorLoader } from '../../access';
import { filterStaffRoleSlugs } from '@tims/shared';
import { redactOfferSettings } from './offer-dto';

// Every approver must be an active member of this organization holding offer:approve; otherwise the offer
// would sit in pending_approval forever (same failure vacancy.submitForApproval closed in #120). Reject
// the whole submission if any id fails.
async function assertOfferApprovers(organizationId: string, offerId: string, approverIds: string[]) {
  const unique = [...new Set(approverIds)];
  const approvers = await db.user.findMany({
    where: { id: { in: unique }, organizationId, isActive: true, deletedAt: null },
    select: { id: true, userRoles: { select: { role: { select: { slug: true } } } } },
  });
  const byId = new Map(approvers.map((u) => [u.id, u]));
  for (const approverId of unique) {
    const approver = byId.get(approverId);
    if (!approver) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Uno o mas aprobadores no son validos (inactivo, de otra organizacion, o inexistente)',
      });
    }
    const roles = filterStaffRoleSlugs(approver.userRoles.map((ur) => ur.role.slug));
    const access = await buildAccessForUser(
      { id: approver.id, organizationId, roles, isPlatformOwner: false },
      'offer',
      'approve',
    );
    if (!access.allowed) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Uno o mas aprobadores no tienen permiso para aprobar ofertas',
      });
    }
    // offer:approve can be scope-limited (leaders hold it at TEAM scope), and approve() re-checks THIS
    // offer via assertScoped against the approver's own access. Probe it now with the APPROVER's access,
    // not the caller's, so an out-of-scope approver is rejected here instead of parking the offer in
    // pending_approval with someone who can never act (mirrors vacancy approvals, #120 round 2).
    const approverAccessContext = {
      allowed: true as const,
      scope: access.scope,
      roles: access.roles,
      anchors: createAnchorLoader(organizationId, approverId),
    };
    try {
      await assertScoped('offer', offerId, approverAccessContext, approverId, organizationId);
    } catch (err) {
      // assertScoped signals scope denial with NOT_FOUND; anything else is a real failure and propagates.
      if (err instanceof TRPCError && err.code === 'NOT_FOUND') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Uno o mas aprobadores no tienen esta oferta dentro de su alcance',
        });
      }
      throw err;
    }
  }
}

// Explicit projection for approval-flow responses. Deliberately omits `settings` (which holds the
// candidate's signing bearer token) and compensation terms; the approval UI refetches the offer.
const OFFER_DECISION_SELECT = {
  id: true,
  organizationId: true,
  candidateId: true,
  vacancyId: true,
  applicationId: true,
  status: true,
  sentAt: true,
  respondedAt: true,
  expiresAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OfferSelect;

export const offerApprovalsRouter = router({
  // 9.5 — Submit offer for approval. offer:create (recruiters) suffices: the body only moves a DRAFT into
  // the approval chain and never edits terms, which stays offer:update.
  submitForApproval: anyPermissionProcedure('offer', ['update', 'create'])
    .input(
      z.object({
        id: z.string().uuid(),
        approverIds: z.array(z.string().uuid()).max(100).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('offer', ctx.access, ctx.user.id);

      // Compose scope into the business findFirst — it fetches `status` used by
      // the draft-guard below, so we must preserve that field.
      const offer = await db.offer.findFirst({
        where: {
          AND: [{ id: input.id, organizationId: ctx.user.organizationId }, scopeWhere as Prisma.OfferWhereInput],
        },
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

      await assertOfferApprovers(ctx.user.organizationId, input.id, input.approverIds);

      // runTenantTransaction, not db.$transaction (#45 / prisma#17948) — `db` is
      // `tenantDb`, so the outer wrapper never made these writes atomic.
      return runTenantTransaction(ctx.user.organizationId, async (tx) => {
        // Compare-and-set draft -> pending_approval FIRST: the draft check above ran outside this
        // transaction, so two concurrent submissions would otherwise both create an approval chain.
        const moved = await tx.offer.updateMany({
          where: { id: input.id, organizationId: ctx.user.organizationId, status: 'draft' },
          data: { status: 'pending_approval' },
        });
        if (moved.count !== 1) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'La oferta ya no está en borrador; recarga e inténtalo de nuevo',
          });
        }

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

        return tx.offer.findFirstOrThrow({
          where: { id: input.id, organizationId: ctx.user.organizationId },
          select: {
            ...OFFER_DECISION_SELECT,
            approvals: {
              orderBy: { step: 'asc' },
              select: {
                id: true,
                step: true,
                status: true,
                comment: true,
                decidedAt: true,
                createdAt: true,
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
        comment: z.string().max(20000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Probe the offer through scope before acting on the approval record.
      await assertScoped('offer', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      // State-guarded (live defect: a rejected offer could be approved by the remaining approvers and
      // then emailed for signature). Every transition is a compare-and-set inside one transaction:
      //  1. lock the offer row with a no-op CAS on status='pending_approval'. A concurrent approve or
      //     reject of the same offer blocks here until the other commits, then re-evaluates the
      //     predicate — so a rejected offer fails it, and two final approvals are serialized (no
      //     write-skew where each counts the other's still-pending row and the offer stays stuck);
      //  2. flip only THIS approver's row, and only while it is still pending;
      //  3. count pending rows (fresh READ COMMITTED snapshot, taken after the lock) and, when none
      //     remain, CAS pending_approval -> approved.
      return runTenantTransaction(ctx.user.organizationId, async (tx) => {
        const offerId = input.id;
        const organizationId = ctx.user.organizationId;
        const locked = await tx.offer.updateMany({
          where: { id: offerId, organizationId, status: 'pending_approval' },
          data: { status: 'pending_approval' },
        });
        if (locked.count !== 1) {
          // Idempotent replay: this approver's approval already completed the offer (a client retry
          // after the final approval committed). Anything else - rejected, sent, draft - conflicts.
          const replay = await tx.offerApproval.count({
            where: {
              organizationId,
              offerId,
              approverId: ctx.user.id,
              status: 'approved',
              offer: { status: 'approved' },
            },
          });
          if (replay > 0) {
            return tx.offer.findFirstOrThrow({ where: { id: offerId, organizationId }, select: OFFER_DECISION_SELECT });
          }
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'La oferta ya no está pendiente de aprobación',
          });
        }

        const decided = await tx.offerApproval.updateMany({
          where: { organizationId, offerId, approverId: ctx.user.id, status: 'pending' },
          data: {
            status: 'approved',
            comment: input.comment,
            decidedAt: new Date(),
          },
        });
        if (decided.count === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'No se encontro aprobacion pendiente para este usuario',
          });
        }

        const pendingCount = await tx.offerApproval.count({
          where: { organizationId, offerId, status: 'pending' },
        });

        if (pendingCount === 0) {
          const flipped = await tx.offer.updateMany({
            where: { id: offerId, organizationId, status: 'pending_approval' },
            data: { status: 'approved' },
          });
          if (flipped.count !== 1) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'La oferta ya no está pendiente de aprobación',
            });
          }
        }

        return tx.offer.findFirstOrThrow({ where: { id: offerId, organizationId }, select: OFFER_DECISION_SELECT });
      });
    }),

  // 9.7 — Reject an offer
  reject: permissionProcedure('offer', 'approve')
    .input(
      z.object({
        id: z.string().uuid(),
        comment: z.string().max(20000).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Probe the offer through scope before acting on the approval record.
      await assertScoped('offer', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      // State-guarded: only a pending_approval offer can be rejected, and only by an approver whose
      // own row is still pending. The offer CAS runs first so it serializes against a concurrent
      // final approve (see approve above); a throw rolls the whole transaction back.
      return runTenantTransaction(ctx.user.organizationId, async (tx) => {
        const offerId = input.id;
        const organizationId = ctx.user.organizationId;
        const rejected = await tx.offer.updateMany({
          where: { id: offerId, organizationId, status: 'pending_approval' },
          data: { status: 'rejected' },
        });
        if (rejected.count !== 1) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'La oferta ya no está pendiente de aprobación',
          });
        }

        const decided = await tx.offerApproval.updateMany({
          where: { organizationId, offerId, approverId: ctx.user.id, status: 'pending' },
          data: {
            status: 'rejected',
            comment: input.comment,
            decidedAt: new Date(),
          },
        });
        if (decided.count === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'No se encontro aprobacion pendiente para este usuario',
          });
        }

        return tx.offer.findFirstOrThrow({ where: { id: offerId, organizationId }, select: OFFER_DECISION_SELECT });
      });
    }),

  // 9.9 — Get approval chain for an offer
  getApprovalChain: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Probe the offer through scope before returning its approval chain.
      await assertScoped('offer', input.offerId, ctx.access, ctx.user.id, ctx.user.organizationId);

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
    const scopeWhere = await scopeWhereFor('offer', ctx.access, ctx.user.id);

    // Get offers pending the current user's approval; AND-compose scope on the
    // offer relation so narrow-scoped approvers only see offers they can reach.
    const pendingApprovals = await db.offerApproval.findMany({
      where: {
        AND: [
          {
            organizationId: ctx.user.organizationId,
            approverId: ctx.user.id,
            status: 'pending',
          },
          { offer: scopeWhere as Prisma.OfferWhereInput },
          // A rejected offer leaves the other approvers' rows pending; never surface it to them.
          { offer: { status: 'pending_approval' } },
        ],
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
      offer: redactOfferSettings(a.offer),
    }));
  }),
});
