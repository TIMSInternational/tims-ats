import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PortalFooter } from '../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-footer';
import { I18nProvider } from '../../apps/web/lib/i18n';
import es from '../../apps/web/lib/i18n/es.json';

vi.mock('next/image', () => ({ default: () => null }));

describe('PortalFooter', () => {
  it('renders its link columns from the locale file, with Spanish accents', () => {
    const { container } = render(
      <I18nProvider>
        <PortalFooter orgName="Acme" />
      </I18nProvider>,
    );
    const text = container.textContent ?? '';
    expect(text).toContain(es.portal.footerTerms);
    expect(text).toContain('Términos');
    expect(text).not.toMatch(/\bTerminos\b/);
    expect([...container.querySelectorAll('h4')].map((h) => h.textContent)).toEqual([
      es.portal.footerPlatform,
      es.portal.footerCompany,
      es.portal.footerLegal,
    ]);
  });
});
