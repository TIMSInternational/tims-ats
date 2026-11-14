'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button } from '../../../../components/button';
import { BUTTON_GROUP_CLASSES } from '../../../../components/button-styles';

interface OfferSignDeclineProps {
  isPending: boolean;
  onDecline: () => void;
}

/**
 * "Rechazar oferta" with an in-page confirmation (title, one consequence sentence, Cancelar + a named
 * destructive verb) instead of the browser's unbranded confirm() (alerts.md › Buttons).
 */
export function OfferSignDecline({ isPending, onDecline }: OfferSignDeclineProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="destructive-secondary" size="lg" fullWidth disabled={isPending} onClick={() => setConfirming(true)}>
        {t.offers.signDeclineButton}
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby="offer-decline-title" aria-describedby="offer-decline-body" className="rounded-xl border border-border bg-surface-hover p-4">
      <h2 id="offer-decline-title" className="text-heading font-semibold text-primary">
        {t.offers.signDeclineConfirmTitle}
      </h2>
      <p id="offer-decline-body" className="mt-1 text-base text-secondary sm:text-body">
        {t.offers.signDeclineConfirmBody}
      </p>
      <div className={`${BUTTON_GROUP_CLASSES} mt-4`}>
        <Button variant="secondary" size="lg" disabled={isPending} onClick={() => setConfirming(false)} autoFocus>
          {t.common.cancel}
        </Button>
        <Button variant="destructive" size="lg" loading={isPending} onClick={onDecline}>
          {t.offers.signDeclineConfirmButton}
        </Button>
      </div>
    </div>
  );
}
