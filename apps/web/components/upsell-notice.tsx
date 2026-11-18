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
    <div className="inline-flex flex-wrap items-center gap-1.5 text-callout text-secondary">
      <span>{message}</span>
      {onContact ? (
        <button
          type="button"
          onClick={onContact}
          className="text-brand font-medium underline-offset-2 hover:underline pointer-coarse:min-h-11"
        >
          {ctaLabel}
        </button>
      ) : (
        <span className="text-brand font-medium">{ctaLabel}</span>
      )}
    </div>
  );
}
