import React from 'react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import { LegalDocumentView } from '../../apps/web/components/legal/legal-document-view';
import { LEGAL_MAX_CONTENT_CHARS } from '../../apps/web/lib/legal/documents';

// Tier-1 (Codex) review of the legal pages: (1) the renderer silently stopped at 20,000 characters while the
// loader accepted 200,000, so a long counsel document would publish without its final clauses; (2) the only
// tests of finalised content were impossible, because every test required the draft marker. Fixture-based.

vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES', setLocale: vi.fn() }) }));

const finalDoc = (body: string) => ({ source: `# Términos\n\n${body}`, title: 'Términos', isDraft: false });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('finalised legal content', () => {
  it('renders the LAST clause of a document longer than the 20,000-character description limit', () => {
    const filler = Array.from({ length: 300 }, (_, i) => `Cláusula ${i}: ${'texto legal '.repeat(10)}`).join('\n\n');
    expect(filler.length).toBeGreaterThan(30_000);
    const body = `${filler}\n\n## Responsabilidad\n\nCláusula final de responsabilidad.`;
    render(<LegalDocumentView slug="terms" content={{ es: finalDoc(body), en: finalDoc(body) }} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Responsabilidad' })).toBeInTheDocument();
    expect(screen.getByText('Cláusula final de responsabilidad.')).toBeInTheDocument();
  });

  it('shows no draft banner for a finalised document', () => {
    render(<LegalDocumentView slug="privacy" content={{ es: finalDoc('Texto final.'), en: finalDoc('Final text.') }} />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('the loader refuses (never truncates) a file over the limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'legal-'));
    try {
      for (const locale of ['es', 'en']) {
        mkdirSync(join(root, 'apps', 'web', 'content', 'legal', locale), { recursive: true });
        writeFileSync(join(root, 'apps', 'web', 'content', 'legal', locale, 'terms.md'),
          `# T\n\n${'x'.repeat(LEGAL_MAX_CONTENT_CHARS + 1)}`);
      }
      vi.spyOn(process, 'cwd').mockReturnValue(root);
      const { loadLegalDocument, LegalContentTooLongError } = await import('../../apps/web/lib/legal/content');
      await expect(loadLegalDocument('terms')).rejects.toBeInstanceOf(LegalContentTooLongError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
