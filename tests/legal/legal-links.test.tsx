import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PortalFooter } from '../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-footer';
import { ApplyLegalLinks } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-legal-links';
import { LegalFooterLinks } from '../../apps/web/components/legal/legal-footer-links';
import { I18nProvider } from '../../apps/web/lib/i18n';
import es from '../../apps/web/lib/i18n/es.json';

vi.mock('next/image', () => ({ default: () => null }));

afterEach(() => {
  vi.unstubAllEnvs();
});

const withI18n = (node: React.ReactNode) => render(<I18nProvider>{node}</I18nProvider>);
const hrefs = (root: HTMLElement) => [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('legal links — flag off', () => {
  it('portal footer links only the organization privacy notice, never a platform legal page', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'false');
    const { container } = withI18n(<PortalFooter orgName="Acme" orgSlug="acme" />);
    const nav = screen.getByRole('navigation', { name: es.portal.footerLegal });
    expect(hrefs(nav)).toEqual(['/careers/acme/privacy']);
    expect(hrefs(container).filter((h) => h?.startsWith('/legal/'))).toEqual([]);
  });

  it('apply consent step and auth footer render nothing', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', '');
    const { container } = withI18n(
      <>
        <ApplyLegalLinks />
        <LegalFooterLinks />
      </>,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('legal links — flag on', () => {
  it('portal footer keeps the organization notice first, then the four platform legal pages', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'true');
    withI18n(<PortalFooter orgName="Acme" orgSlug="acme" />);
    const nav = screen.getByRole('navigation', { name: es.portal.footerLegal });
    expect(hrefs(nav)).toEqual([
      '/careers/acme/privacy',
      '/legal/terms',
      '/legal/privacy',
      '/legal/subprocessors',
      '/legal/ai-processing',
    ]);
    expect(nav.textContent).toContain(es.legal.termsLink);
    // The platform notice is labelled as the platform's, so it is never mistaken for the organization's.
    expect(within(nav).getByRole('link', { name: es.legal.platformPrivacyLink })).toHaveAttribute(
      'href',
      '/legal/privacy',
    );
    expect(within(nav).getByRole('link', { name: es.portal.footerPrivacy })).toHaveAttribute(
      'href',
      '/careers/acme/privacy',
    );
  });

  it('apply consent step links terms, privacy and AI processing in a new tab', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'true');
    withI18n(<ApplyLegalLinks />);
    const block = screen.getByTestId('apply-legal-links');
    const links = within(block).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/legal/terms',
      '/legal/privacy',
      '/legal/ai-processing',
    ]);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('auth footer renders all four links', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_PAGES_ENABLED', 'true');
    const { container } = withI18n(<LegalFooterLinks />);
    expect(hrefs(container)).toEqual([
      '/legal/terms',
      '/legal/privacy',
      '/legal/subprocessors',
      '/legal/ai-processing',
    ]);
  });
});
