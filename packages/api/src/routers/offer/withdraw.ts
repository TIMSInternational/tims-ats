import { z } from 'zod';
import { router, anyPermissionProcedure } from '../../trpc';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { WITHDRAWABLE_OFFER_STATUSES } from '@tims/shared';
import { scopeWhereFor } from '../../access';
import { offerWithdrawRepository } from '../../repositories/offer-withdraw.repository';

// "Retirar oferta" (Pilot UX audit B-04): staff take back an offer that is wrong or no longer wanted, from
// draft, pending approval, approved or sent. The offer becomes `withdrawn` (terminal), its signing token is
// removed so a link the candidate already received stops working, and still-pending approval steps are
// cancelled. A withdrawn offer no longer counts as open, so a corrected offer can be created for the same
// application. Same gate as submitForApproval: whoever may send an offer for approval may withdraw it.
// Owed a C# port like every procedure added under owner decision D-1 (trpc-procedure-ratchet.test.ts).

/** settings without the bearer token, plus who withdrew the offer, when and why (shown in the history). */
export function withdrawnSettings(
  settings: unknown,
  withdrawal: { at: Date; byName: string; reason?: string },
): Prisma.InputJsonObject {
  const base =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  const { signingToken: _token, signingTokenRecipient: _recipient, ...rest } = base;
  return {
    ...(rest as Prisma.InputJsonObject),
    withdrawnAt: withdrawal.at.toISOString(),
    withdrawnByName: withdrawal.byName,
    ...(withdrawal.reason ? { withdrawnReason: withdrawal.reason } : {}),
  };
}

export const offerWithdrawRouter = router({
  withdraw: anyPermissionProcedure('offer', ['update', 'create'])
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;
      const scopeWhere = await scopeWhereFor('offer', ctx.access, ctx.user.id);
      const offer = await offerWithdrawRepository.findForWithdraw(
        organizationId,
        input.id,
        scopeWhere as Prisma.OfferWhereInput,
      );
      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }
      if (!(WITHDRAWABLE_OFFER_STATUSES as readonly string[]).includes(offer.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden retirar ofertas en borrador, pendientes de aprobación, aprobadas o enviadas',
        });
      }

      const byName = await offerWithdrawRepository.actorName(organizationId, ctx.user.id);
      const settings = withdrawnSettings(offer.settings, {
        at: new Date(),
        byName,
        reason: input.reason ? input.reason : undefined,
      });
      // Compare-and-set on the state read above: a concurrent accept (the candidate answering), approval or
      // send changes status/updatedAt, the write matches nothing, and the withdrawal is refused.
      const withdrawn = await offerWithdrawRepository.withdraw(organizationId, offer, settings, {
        userId: ctx.user.id,
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
      });
      if (!withdrawn) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'La oferta cambió de estado mientras la retirabas; recarga la página para ver su estado actual',
        });
      }
      return withdrawn;
    }),
});
