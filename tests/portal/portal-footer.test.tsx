import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PortalFooter } from '../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-footer';
import { PortalNav } from '../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-nav';
import { I18nProvider } from '../../apps/web/lib/i18n';
import es from '../../apps/web/lib/i18n/es.json';

function renderFooter(logo: string | null = null) {
  return render(
    <I18nProvider>
      <PortalFooter orgName="Acme" orgSlug="acme" orgLogo={logo} />
    </I18nProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PortalFooter', () => {
  it('has one working link — the privacy notice — and no dead placeholder entries', () => {
    const { container } = renderFooter();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent(es.portal.footerPrivacy);
    expect(links[0]).toHaveAttribute('href', '/careers/acme/privacy');
    // Every footer entry used to be a <span class="cursor-pointer"> with no href.
    expect(container.querySelector('span.cursor-pointer')).toBeNull();
    for (const placeholder of ['Blog', 'Socios', 'Licencias', 'Cookies', 'Evaluaciones']) {
      expect(container.textContent).not.toContain(placeholder);
    }
  });

  it('brands the footer with the organization, not the TIMS logo', () => {
    const { container } = renderFooter();
    expect(container.querySelector('img[src="/logo_tims.png"]')).toBeNull();
    expect(container.textContent).toContain('Acme');
  });

  it('shows an allowed organization logo, and never an image the CSP would block', () => {
    const allowed = renderFooter('https://abc.supabase.co/storage/v1/object/public/logos/acme.png');
    expect(allowed.container.querySelector('img')).toHaveAttribute(
      'src',
      'https://abc.supabase.co/storage/v1/object/public/logos/acme.png',
    );
    allowed.unmount();
    const blocked = renderFooter('https://www.example.go.cr/logo.png');
    expect(blocked.container.querySelector('img')).toBeNull();
    expect(blocked.container.textContent).toContain('A');
  });

  it('drops the "evaluaciones científicas" vendor blurb under the pilot launch scope', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    const { container } = renderFooter();
    expect(container.textContent).not.toContain(es.portal.footerUsesTimsSuffix);
  });
});

describe('PortalNav', () => {
  it('shows the organization (no TIMS logo, no dead "ES | EN" text) and a link to the candidate portal', () => {
    const { container } = render(
      <I18nProvider>
        <PortalNav orgName="Acme" orgSlug="acme" />
      </I18nProvider>,
    );
    expect(container.querySelector('img[src="/logo_tims.png"]')).toBeNull();
    expect(container.textContent).not.toMatch(/ES\s*\|\s*EN/);
    expect(screen.getByRole('link', { name: es.portal.signInNav })).toHaveAttribute('href', '/careers/acme/dashboard');
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });
});
