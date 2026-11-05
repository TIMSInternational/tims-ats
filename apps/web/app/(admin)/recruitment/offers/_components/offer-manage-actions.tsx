'use client';

import { useCallback, useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { CreateOfferModal } from '../../candidates/[id]/create-offer-modal';
import type { OfferFormSource, OfferFormVacancy } from '../../candidates/[id]/create-offer-form';
import { WithdrawOfferModal } from './withdraw-offer-modal';

const SECONDARY =
  'px-4 py-2.5 rounded-lg text-[13px] font-medium border border-[#EDEDED] text-[#1F114C] hover:bg-[#F6F6F6] transition';

type Dialog = 'edit' | 'withdraw' | 'new' | null;

/**
 * Offer management on the detail header (Pilot UX audit B-02 / B-04):
 *  - "Editar borrador": the offer form on offer.update, while the offer is a draft;
 *  - "Retirar oferta": from draft, pending approval, approved or sent;
 *  - "Crear nueva oferta": after a rejection, a decline, a withdrawal or an expired link, a new draft for
 *    the same (still active) application, starting from this offer's terms. No more dead end.
 */
export function OfferManageActions({
  offer,
  canEdit,
  canWithdraw,
  canCreateNew,
  onChanged,
}: {
  offer: OfferFormSource & {
    status: string;
    candidateId: string;
    applicationId: string | null;
    vacancy: OfferFormVacancy;
  };
  canEdit: boolean;
  canWithdraw: boolean;
  canCreateNew: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  // Stable: Modal re-runs its focus effect when onClose changes identity (the detail view re-renders on refetch).
  const close = useCallback(() => setDialog(null), []);
  const applications = offer.applicationId ? [{ id: offer.applicationId, vacancy: offer.vacancy }] : [];

  if (!canEdit && !canWithdraw && !canCreateNew) return null;

  return (
    <>
      {canEdit && applications.length > 0 && (
        <button type="button" className={SECONDARY} onClick={() => setDialog('edit')}>
          {t.offers.editDraft}
        </button>
      )}
      {canCreateNew && applications.length > 0 && (
        <button
          type="button"
          className={SECONDARY}
          title={t.offers.createNewOfferHint}
          onClick={() => setDialog('new')}
        >
          {t.offers.createNewOffer}
        </button>
      )}
      {canWithdraw && (
        <button
          type="button"
          className="px-4 py-2.5 rounded-lg text-[13px] font-medium border border-red-200 text-red-700 hover:bg-red-50 transition"
          onClick={() => setDialog('withdraw')}
        >
          {t.offers.withdrawOffer}
        </button>
      )}
      {dialog === 'edit' && (
        <CreateOfferModal
          mode="edit"
          candidateId={offer.candidateId}
          applications={applications}
          source={offer}
          onClose={close}
          onSaved={onChanged}
        />
      )}
      {dialog === 'new' && (
        <CreateOfferModal candidateId={offer.candidateId} applications={applications} source={offer} onClose={close} />
      )}
      {dialog === 'withdraw' && (
        <WithdrawOfferModal
          offerId={offer.id}
          wasSent={offer.status === 'sent'}
          onClose={close}
          onWithdrawn={onChanged}
        />
      )}
    </>
  );
}
