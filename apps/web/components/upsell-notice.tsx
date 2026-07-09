'use client';

import React from 'react';

interface UpsellNoticeProps {
  /** The "not included in your plan" message. Caller supplies via i18n — no hardcoded text here. */
  message: string;
  /** Label for the contact-sales affordance. Caller supplies via i18n. */
  ctaLabel: string;
  /** Optional handler for the CTA. If omitted, the CTA renders as inert text (no click affordance). */
  onContact?: () => void;
}

// Small reusable notice for entitlement-gated surfaces: communicates that a
// feature isn't included in the tenant's plan and offers a contact-sales CTA.
// Purely presentational — all copy comes from props so it can be reused
// across any gated feature without duplicating i18n keys or markup.
export function UpsellNotice({ message, ctaLabel, onContact }: UpsellNoticeProps) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] text-[#8B8B8B]">
      <span>{message}</span>
      {onContact ? (
        <button
          type="button"
          onClick={onContact}
          className="text-[#1F114C] font-medium hover:underline"
        >
          {ctaLabel}
        </button>
      ) : (
        <span className="text-[#1F114C] font-medium">{ctaLabel}</span>
      )}
    </div>
  );
}
