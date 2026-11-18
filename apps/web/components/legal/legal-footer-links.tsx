'use client';

import Link from 'next/link';
import { useI18n } from '../../lib/i18n';
import { LEGAL_DOCUMENT_SLUGS, isLegalPagesEnabled } from '../../lib/legal/documents';
import { useLegalLinks } from './use-legal-links';

/** Compact row of platform legal links. Renders nothing unless NEXT_PUBLIC_LEGAL_PAGES_ENABLED. */
export function LegalFooterLinks({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const links = useLegalLinks(LEGAL_DOCUMENT_SLUGS);
  if (!isLegalPagesEnabled()) return null;

  return (
    <nav
      aria-label={t.legal.navLabel}
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 ${className}`}
    >
      {links.map((link) => (
        <Link
          key={link.slug}
          href={link.href}
          className="inline-flex min-h-7 items-center text-caption text-muted underline-offset-2 hover:text-brand hover:underline pointer-coarse:min-h-11"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
