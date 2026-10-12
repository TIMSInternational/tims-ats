'use client';

import { Fragment } from 'react';
import { useLegalLinks } from '../../../../../../components/legal/use-legal-links';
import { useI18n } from '../../../../../../lib/i18n';
import { isLegalPagesEnabled } from '../../../../../../lib/legal/documents';

const APPLY_LEGAL_SLUGS = ['terms', 'privacy', 'ai-processing'] as const;

// Platform terms / privacy / AI-processing links on the apply consent step. Deliberately rendered
// OUTSIDE ApplyConsentCheckbox's <label>: the label text is the versioned consent sentence the
// server hashes (APPLICATION_CONSENT_TEXT_VERSION), and these links must not change it.
// Renders nothing unless NEXT_PUBLIC_LEGAL_PAGES_ENABLED.
export function ApplyLegalLinks() {
  const { t } = useI18n();
  const links = useLegalLinks(APPLY_LEGAL_SLUGS);
  if (!isLegalPagesEnabled()) return null;

  return (
    <p className="pl-6 text-[11px] text-[#8B8B8B]" data-testid="apply-legal-links">
      {t.legal.consentLinksPrefix}{' '}
      {links.map((link, index) => (
        <Fragment key={link.slug}>
          {index > 0 && ' · '}
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#1F114C] underline hover:text-[#DD0C15]"
          >
            {link.label}
          </a>
        </Fragment>
      ))}
    </p>
  );
}
