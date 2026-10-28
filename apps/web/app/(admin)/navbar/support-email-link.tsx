'use client';

import { useI18n } from '../../../lib/i18n';
import { getSupportEmail } from '../../../lib/support-email';

/**
 * Top-bar support entry: a plain `mailto:` link to the configured support
 * address. Renders nothing when NEXT_PUBLIC_SUPPORT_EMAIL is not configured.
 */
export function SupportEmailLink() {
  const { t } = useI18n();
  const email = getSupportEmail();
  if (!email) return null;

  return (
    <a
      href={`mailto:${email}`}
      aria-label={`${t.nav.contactSupport}: ${email}`}
      title={`${t.nav.contactSupport}: ${email}`}
      className="w-8 h-8 rounded-[var(--r-md)] hidden md:flex items-center justify-center hover:bg-[var(--chrome-hover)] transition-colors"
    >
      <svg aria-hidden="true" className="w-[16px] h-[16px] text-[var(--chrome-text-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
      </svg>
    </a>
  );
}
