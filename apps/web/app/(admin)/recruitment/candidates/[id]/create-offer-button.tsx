'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { isOpenOffer } from '@tims/shared';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { useCan } from '../../../../../lib/permissions';
import { offerDetailHref } from '../../../../../lib/offer-deep-link';
import { CreateOfferModal } from './create-offer-modal';
import type { OfferFormApplication } from './create-offer-form';

const BUTTON =
  'flex items-center gap-2 border border-[#1F114C] text-[#1F114C] px-4 h-9 rounded-lg text-[12px] font-medium hover:bg-[#1F114C]/5 transition disabled:opacity-50';

/**
 * "Crear oferta" on the candidate profile.
 *  - Only for viewers who may create offers (B-17: a leader saw it and got "No tienes permiso…").
 *  - Only for the active applications whose vacancy has no open offer yet (A-15 / B-04: duplicates were
 *    possible); when every one has an open offer, it becomes "Ver oferta" and opens that offer.
 * The server enforces the same one-open-offer rule (offer.create).
 */
export function CreateOfferButton({
  candidateId,
  applications,
}: {
  candidateId: string;
  applications: OfferFormApplication[];
}) {
  const { t } = useI18n();
  const canCreate = useCan()('offer', 'create');
  const [showModal, setShowModal] = useState(false);
  const enabled = canCreate && applications.length > 0;
  const offers = trpc.offer.list.useQuery({ candidateId, pageSize: 100 }, { enabled });
  // Stable: Modal re-runs its focus effect when onClose changes identity (this button re-renders on refetch).
  const closeModal = useCallback(() => setShowModal(false), []);

  if (!enabled) return null;

  const openOffers = (offers.data?.items ?? []).filter((offer) => isOpenOffer(offer));
  const available = applications.filter(
    (application) => !openOffers.some((offer) => offer.vacancyId === application.vacancy.id),
  );

  if (available.length === 0 && openOffers[0]) {
    return (
      <Link href={offerDetailHref(openOffers[0].id)} title={t.offers.openOfferExistsHint} className={BUTTON}>
        {t.offers.viewExistingOffer}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={offers.isLoading || available.length === 0}
        onClick={() => setShowModal(true)}
        className={BUTTON}
      >
        {t.offers.createOffer}
      </button>
      {showModal && (
        <CreateOfferModal candidateId={candidateId} applications={available} onClose={closeModal} />
      )}
    </>
  );
}
