'use client';

import { useState } from 'react';
import { Modal } from '../../../../../components';
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
    <Modal title={t.offers.signingLinkTitle} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg ${emailDeliveryAccepted ? 'bg-green-100' : 'bg-amber-100'} flex items-center justify-center`}
            aria-hidden="true"
          >
            <svg
              className={`w-5 h-5 ${emailDeliveryAccepted ? 'text-green-600' : 'text-amber-600'}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 00-6.364-6.364L4.5 8.25a4.5 4.5 0 006.364 6.364l4.5-4.5z" />
            </svg>
          </div>
          <p className="text-[13px] font-medium text-[#585858]">
            {emailDeliveryAccepted ? t.offers.offerEmailProviderAccepted : t.offers.offerEmailUnconfirmed}
          </p>
        </div>

        {signingUrl && (
          <div>
            <label htmlFor="offer-signing-link" className="block text-xs text-[#8B8B8B] mb-1.5">
              {t.offers.signingLinkLabel}
            </label>
            <div className="flex gap-2">
              <input
                id="offer-signing-link"
                type="text"
                value={signingUrl}
                readOnly
                className="flex-1 h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm text-[#333] bg-[#FAFAFA] truncate"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 h-10 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition"
              >
                {copied ? t.common.copied : t.common.copy}
              </button>
            </div>
          </div>
        )}

        <div className={`${emailDeliveryAccepted ? 'bg-green-50' : 'bg-amber-50'} rounded-xl p-4`}>
          <p className="text-[12px] text-[#585858] leading-relaxed">
            {emailDeliveryAccepted
              ? t.offers.offerEmailAcceptedDetail
              : signingUrl
                ? t.offers.offerEmailUnconfirmedDetail
                : t.offers.offerEmailUnconfirmedNoLinkDetail}
          </p>
          <p className="text-[11px] text-[#585858] mt-2">{recipientEmail}</p>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-5 rounded-lg text-[13px] font-medium text-[#585858] hover:bg-[#F6F6F6] transition"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </Modal>
  );
}
