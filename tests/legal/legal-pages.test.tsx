import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import LegalDocumentPage, { generateMetadata } from '../../apps/web/app/legal/[doc]/page';
import LegalLayout from '../../apps/web/app/legal/layout';
import {
  LEGAL_DOCUMENT_SLUGS,
  LEGAL_DRAFT_MARKER,
  LEGAL_MAX_CONTENT_CHARS,
  type LegalDocumentSlug,
} from '../../apps/web/lib/legal/documents';
import { SUBPROCESSORS } from '../../apps/web/lib/legal/subprocessors';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

const CONTENT = resolve(__dirname, '../../apps/web/content/legal');
const source = (locale: 'es' | 'en', slug: LegalDocumentSlug) =>
  readFileSync(resolve(CONTENT, locale, `${slug}.md`), 'utf8');
const titleOf = (md: string) =>
  md
    .split('\n')
    .find((l) => l.startsWith('# '))!
    .slice(2)
    .trim();
const sectionHeadings = (md: string) =>
  md
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim());

const params = (doc: string) => ({ params: Promise.resolve({ doc }) });

// next/navigation's real notFound() throws an error whose digest marks it as an HTTP 404.
const NOT_FOUND = { digest: expect.stringContaining('404') };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('legal pages — flag off (default)', () => {
  it.each(LEGAL_DOCUMENT_SLUGS)('/legal/%s is a 404 when the flag is unset', async (slug) => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', undefined as unknown as string);
    await expect(LegalDocumentPage(params(slug))).rejects.toMatchObject(NOT_FOUND);
  });

  it.each(['', 'false', '1', 'TRUE', ' true', 'yes'])(
    'only the exact string "true" enables them (%j => 404)',
    async (value) => {
      vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', value);
      await expect(LegalDocumentPage(params('terms'))).rejects.toMatchObject(NOT_FOUND);
    },
  );

  it('emits no metadata while off', async () => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'false');
    expect(await generateMetadata(params('privacy'))).toEqual({});
  });
});

describe('legal pages — flag on', () => {
  it.each(['cookies', 'TERMS', '../es/terms', 'terms.md', ''])('unknown document %j is a 404', async (doc) => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'true');
    await expect(LegalDocumentPage(params(doc))).rejects.toMatchObject(NOT_FOUND);
  });

  const cases = LEGAL_DOCUMENT_SLUGS.flatMap((slug) => [
    { slug, locale: 'es' as const, stored: 'ES', t: es },
    { slug, locale: 'en' as const, stored: 'EN', t: en },
  ]);

  it.each(cases)(
    '/legal/$slug renders the $locale content file, with a DRAFT banner exactly while it is a draft',
    async ({ slug, locale, stored, t }) => {
      vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'true');
      localStorage.setItem('tims-locale', stored);
      const md = source(locale, slug);

      const element = await LegalDocumentPage(params(slug));
      const { container } = render(<LegalLayout>{element}</LegalLayout>);

      expect(await screen.findByRole('heading', { level: 1, name: titleOf(md) })).toBeInTheDocument();
      expect(container.querySelector('main')?.getAttribute('lang')).toBe(locale);
      expect([...container.querySelectorAll('main h2')].map((h) => h.textContent)).toEqual(sectionHeadings(md));
      // Draft-agnostic (tier-1 review): finalised counsel text must not break CI. The banner follows the file.
      if (md.includes(LEGAL_DRAFT_MARKER)) {
        expect(screen.getByRole('note')).toHaveTextContent(t.legal.draftBanner);
        // The marker is shown verbatim (draft text is visible as draft, never hidden).
        expect(container.textContent).toContain(LEGAL_DRAFT_MARKER);
      } else {
        expect(screen.queryByRole('note')).toBeNull();
      }
      // Navigation offers every legal document, current one marked.
      const nav = screen.getByRole('navigation', { name: t.legal.navLabel });
      expect(
        within(nav)
          .getAllByRole('link')
          .map((a) => a.getAttribute('href')),
      ).toEqual(LEGAL_DOCUMENT_SLUGS.map((s) => `/legal/${s}`));
      expect(within(nav).getByRole('link', { current: 'page' })).toHaveAttribute('href', `/legal/${slug}`);
    },
  );

  it.each(['es', 'en'] as const)('/legal/subprocessors renders every inventory entry (%s)', async (locale) => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'true');
    localStorage.setItem('tims-locale', locale.toUpperCase());
    const element = await LegalDocumentPage(params('subprocessors'));
    const { container } = render(<LegalLayout>{element}</LegalLayout>);
    await screen.findByRole('heading', { level: 1, name: titleOf(source(locale, 'subprocessors')) });

    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.getAttribute('data-subprocessor-id'))).toEqual(SUBPROCESSORS.map((s) => s.id));
    SUBPROCESSORS.forEach((sp, i) => {
      expect(rows[i]).toHaveTextContent(sp.purpose[locale]);
      expect(rows[i]).toHaveTextContent(sp.dataCategories[locale]);
    });
  });

  it('only the subprocessors page carries the table', async () => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'true');
    const { container } = render(<LegalLayout>{await LegalDocumentPage(params('terms'))}</LegalLayout>);
    expect(container.querySelector('table')).toBeNull();
  });

  it.each(LEGAL_DOCUMENT_SLUGS)('%s is noindex exactly while either language is a draft', async (slug) => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'true');
    const meta = await generateMetadata(params(slug));
    expect(meta.title).toBe(titleOf(source('es', slug)));
    const draft = source('es', slug).includes(LEGAL_DRAFT_MARKER) || source('en', slug).includes(LEGAL_DRAFT_MARKER);
    expect(meta.robots).toEqual(draft ? { index: false, follow: false } : undefined);
  });
});

describe('legal content files', () => {
  // Draft-agnostic (tier-1 review): these hold for counsel's final text as well as for the drafts, so
  // following the README (replace the text, remove the markers) cannot break CI.
  it.each(LEGAL_DOCUMENT_SLUGS)('%s: es and en have a title, matching structure, no HTML, and fit the limit', (slug) => {
    const esMd = source('es', slug);
    const enMd = source('en', slug);
    for (const md of [esMd, enMd]) {
      expect(titleOf(md)).not.toBe('');
      expect(md).not.toMatch(/<[a-z!/]/i);
      expect(md.length).toBeLessThanOrEqual(LEGAL_MAX_CONTENT_CHARS);
    }
    expect(sectionHeadings(esMd).length).toBe(sectionHeadings(enMd).length);
    // Both languages move from draft to final together.
    expect(esMd.includes(LEGAL_DRAFT_MARKER)).toBe(enMd.includes(LEGAL_DRAFT_MARKER));
    if (esMd.includes(LEGAL_DRAFT_MARKER)) {
      expect(esMd).toContain('BORRADOR');
      expect(enMd).toContain('DRAFT');
      expect(esMd.split(LEGAL_DRAFT_MARKER).length).toBe(enMd.split(LEGAL_DRAFT_MARKER).length);
    }
  });
});
