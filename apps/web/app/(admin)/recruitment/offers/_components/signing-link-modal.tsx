'use client';

import { useState } from 'react';
import { Modal } from '../../../../../components';
import { Button } from '../../../../../components/button';
import { FIELD_LABEL_CLASSES, inputClasses } from '../../../../../components/field-styles';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';

interface SigningLinkModalProps {
  /** Empty when the caller may not see the bearer link (offer:create without offer:update). */
  signingUrl: string;
  emailDeliveryAccepted: boolean;
  recipientEmail: string;
  onClose: () => void;
}

// E-30: on the shared Modal (dialog semantics, focus trap, Escape) instead of a hand-rolled overlay.
export function SigningLinkModal({
  signingUrl,
  emailDeliveryAccepted,
  recipientEmail,
  onClose,
}: SigningLinkModalProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(signingUrl);
      setCopied(true);
      toast(t.offers.linkCopied, { type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(t.offers.linkCopyError, { type: 'error' });
    }
  };

  return (
    <Modal
      title={t.offers.signingLinkTitle}
      onClose={onClose}
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.common.close}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex size-10 items-center justify-center rounded-lg ${emailDeliveryAccepted ? 'bg-success-bg' : 'bg-warning-bg'}`}
            aria-hidden="true"
          >
            <svg
              className={`size-5 ${emailDeliveryAccepted ? 'text-success' : 'text-warning'}`}
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 00-6.364-6.364L4.5 8.25a4.5 4.5 0 006.364 6.364l4.5-4.5z" />
            </svg>
          </div>
          <p className="text-body font-medium text-secondary">
            {emailDeliveryAccepted ? t.offers.offerEmailProviderAccepted : t.offers.offerEmailUnconfirmed}
          </p>
        </div>

        {signingUrl && (
          <div>
            <label htmlFor="offer-signing-link" className={FIELD_LABEL_CLASSES}>
              {t.offers.signingLinkLabel}
            </label>
            <div className="flex gap-2">
              <input
                id="offer-signing-link"
                type="text"
                value={signingUrl}
                readOnly
                className={inputClasses('md', 'flex-1 truncate bg-surface-hover')}
              />
              <Button className="shrink-0" onClick={handleCopy}>
                {copied ? t.common.copied : t.common.copy}
              </Button>
            </div>
          </div>
        )}

        <div className={`${emailDeliveryAccepted ? 'bg-success-bg' : 'bg-warning-bg'} rounded-xl p-4`}>
          <p className="text-callout text-secondary leading-relaxed">
            {emailDeliveryAccepted
              ? t.offers.offerEmailAcceptedDetail
              : signingUrl
                ? t.offers.offerEmailUnconfirmedDetail
                : t.offers.offerEmailUnconfirmedNoLinkDetail}
          </p>
          <p className="text-callout text-secondary mt-2">{recipientEmail}</p>
        </div>

      </div>
    </Modal>
  );
}
