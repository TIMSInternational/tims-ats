'use client';

import { useCallback, useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { CreateOfferModal } from '../../candidates/[id]/create-offer-modal';
import type { OfferFormSource, OfferFormVacancy } from '../../candidates/[id]/create-offer-form';
import { WithdrawOfferModal } from './withdraw-offer-modal';
import { Menu, type MenuEntry } from '../../../../../components/menu';

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
  // "Crear nueva oferta" needs the (active) application to link the new offer to. Editing does not send an
  // application, so a draft created without the link (offer.create allows it) stays editable: there the
  // entry's id is only the form's select key.
  const linked = offer.applicationId ? [{ id: offer.applicationId, vacancy: offer.vacancy }] : [];
  const editEntry = [{ id: offer.applicationId ?? `offer-${offer.id}`, vacancy: offer.vacancy }];

  // The header keeps one primary action; editing, copying and withdrawing live in a "Más acciones"
  // menu, withdrawing last and in red after a separator (toolbars.md: "Add a More menu").
  const items: MenuEntry[] = [];
  if (canEdit) items.push({ key: 'edit', label: t.offers.editDraftMenu, onSelect: () => setDialog('edit') });
  if (canCreateNew && linked.length > 0) {
    items.push({ key: 'new', label: t.offers.createNewOfferMenu, onSelect: () => setDialog('new') });
  }
  if (canWithdraw) {
    if (items.length > 0) items.push({ key: 'sep', type: 'separator' });
    items.push({ key: 'withdraw', label: t.offers.withdrawOfferMenu, destructive: true, onSelect: () => setDialog('withdraw') });
  }

  if (items.length === 0) return null;

  return (
    <>
      <Menu items={items} label={t.common.moreActions} panelClassName="w-60" />
      {dialog === 'edit' && (
        <CreateOfferModal
          mode="edit"
          candidateId={offer.candidateId}
          applications={editEntry}
          source={offer}
          onClose={close}
          onSaved={onChanged}
        />
      )}
      {dialog === 'new' && (
        <CreateOfferModal candidateId={offer.candidateId} applications={linked} source={offer} onClose={close} />
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
