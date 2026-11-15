'use client';

import { useI18n } from '../../../../lib/i18n';
import { getSupportEmail } from '../../../../lib/support-email';
import { TEXT_LINK_CLASSES } from '../../../../components';

/** Stripe self-serve billing is not configured for this deploy (settings-03). */
export function NotConfiguredNotice() {
  const { t } = useI18n();
  const supportEmail = getSupportEmail();
  return (
    <div role="status" className="flex gap-3 rounded-xl border border-warning/30 bg-warning-bg p-4">
      <svg
        className="mt-0.5 size-4 shrink-0 text-warning"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
      <div>
        <p className="text-subheading font-semibold text-warning">{t.billing.notConfiguredTitle}</p>
        <p className="mt-1 text-callout text-primary">
          {t.billing.notConfiguredDesc}{' '}
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`} className={TEXT_LINK_CLASSES}>
              {t.billing.contactSupport}
            </a>
          ) : (
            t.billing.notConfiguredNextStep
          )}
        </p>
      </div>
    </div>
  );
}
