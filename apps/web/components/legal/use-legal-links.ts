'use client';

import { useI18n } from '../../lib/i18n';
import { legalDocumentHref, type LegalDocumentSlug } from '../../lib/legal/documents';

export interface LegalLinkItem {
  slug: LegalDocumentSlug;
  href: string;
  label: string;
}

/** Localized label + href for each platform legal document, in the order given. */
export function useLegalLinks(slugs: readonly LegalDocumentSlug[]): LegalLinkItem[] {
  const { t } = useI18n();
  const labels: Record<LegalDocumentSlug, string> = {
    terms: t.legal.termsLink,
    privacy: t.legal.privacyLink,
    subprocessors: t.legal.subprocessorsLink,
    'ai-processing': t.legal.aiProcessingLink,
  };
  return slugs.map((slug) => ({ slug, href: legalDocumentHref(slug), label: labels[slug] }));
}
