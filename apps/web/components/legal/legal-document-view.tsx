'use client';

import Link from 'next/link';
import { useI18n } from '../../lib/i18n';
import { LEGAL_DOCUMENT_SLUGS, type LegalDocumentSlug, type LegalLocale } from '../../lib/legal/documents';
import type { LegalDocumentBundle } from '../../lib/legal/content';
import { MarkdownText } from '../markdown-text';
import { SubprocessorTable } from './subprocessor-table';
import { useLegalLinks } from './use-legal-links';

interface LegalDocumentViewProps {
  slug: LegalDocumentSlug;
  content: LegalDocumentBundle;
}

/** Drops the first `# ` heading line: it is rendered as the page's own <h1>. */
function bodyWithoutTitle(source: string): string {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => /^#\s+/.test(line.trim()));
  return index === -1 ? source : [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n');
}

export function LegalDocumentView({ slug, content }: LegalDocumentViewProps) {
  const { t, locale, setLocale } = useI18n();
  const lang: LegalLocale = locale === 'EN' ? 'en' : 'es';
  const doc = content[lang];
  const links = useLegalLinks(LEGAL_DOCUMENT_SLUGS);

  return (
    <main lang={lang} className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t.legal.navLabel} className="flex flex-wrap gap-x-4 gap-y-1">
          {links.map((link) => (
            <Link
              key={link.slug}
              href={link.href}
              aria-current={link.slug === slug ? 'page' : undefined}
              className={`text-[12px] ${link.slug === slug ? 'font-semibold text-[#1F114C]' : 'text-[#585858] hover:text-[#1F114C]'}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div role="group" aria-label={t.legal.languageLabel} className="flex gap-1">
          {(['ES', 'EN'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={locale === code}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${locale === code ? 'bg-[#1F114C] text-white' : 'text-[#585858] hover:bg-[#EDEDED]'}`}
            >
              {code}
            </button>
          ))}
        </div>
      </div>

      {doc.isDraft && (
        <p
          role="note"
          className="mt-6 rounded-lg border border-[#F5C26B] bg-[#FFF8E6] px-3 py-2 text-[12px] font-medium text-[#7A4E00]"
        >
          {t.legal.draftBanner}
        </p>
      )}

      <h1 className="mt-6 text-[24px] font-bold text-[#1F114C]">{doc.title}</h1>
      <MarkdownText
        source={bodyWithoutTitle(doc.source)}
        headingBase={1}
        className="mt-4 space-y-3 text-[13px] leading-relaxed text-[#585858]"
      />
      {slug === 'subprocessors' && <SubprocessorTable locale={lang} />}
    </main>
  );
}
