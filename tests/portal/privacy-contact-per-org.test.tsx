import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// The Ley N.° 8968 privacy notice is ONE text shared by every organization's careers portal, so the "Cómo
// ejercer sus derechos" contact is resolved per organization from settings.candidateContactEmail, else no
// address at all — never one organization's mailbox on another organization's notice. The page is anonymous
// and enumerable by slug, so billing_email (often a person's account address) is never published there.
// The notice is the 'ley8968' consent variant (off by default); the default variant is main's country-neutral
// notice, which reads no settings and shows no mailbox.

type OrgRow = { name: string; isActive: boolean; settings: unknown; billingEmail: string | null };

// Rows carry billingEmail on purpose: even if a query returned it, the page must not publish it.
const ORGS: Record<string, OrgRow> = {
  alpha: {
    name: 'Alpha S.A.',
    isActive: true,
    settings: { candidateContactEmail: 'Talento@Alpha.example ' },
    billingEmail: 'facturas@alpha.example',
  },
  beta: {
    name: 'Beta S.A.',
    isActive: true,
    settings: { candidateContactEmail: 'seleccion@beta.example' },
    billingEmail: 'admin@beta.example',
  },
  gamma: { name: 'Gamma S.A.', isActive: true, settings: { theme: 'dark' }, billingEmail: 'founder@gamma.example' },
  delta: { name: 'Delta S.A.', isActive: true, settings: {}, billingEmail: null },
  closed: { name: 'Closed S.A.', isActive: false, settings: {}, billingEmail: 'x@closed.example' },
};

const { findUnique, state } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  state: { variant: 'ley8968' as 'default' | 'ley8968' },
}));

vi.mock('@tims/db', () => ({ db: { organization: { findUnique } } }));
vi.mock('@tims/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    get ACTIVE_APPLICATION_CONSENT_VARIANT() {
      return state.variant;
    },
  };
});
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import CareersPrivacyPage from '../../apps/web/app/(portal)/careers/[orgSlug]/privacy/page';
import { publicCandidateContactEmail } from '../../apps/web/app/(portal)/careers/[orgSlug]/privacy/candidate-contact-email';

const pp = es.portalPrivacyLey8968;

async function renderPage(orgSlug: string) {
  const ui = await CareersPrivacyPage({ params: Promise.resolve({ orgSlug }) });
  const view = render(<I18nProvider>{ui}</I18nProvider>);
  const heading = await screen.findByRole('heading', { level: 2, name: pp.exerciseHeading });
  const section = heading.closest('section');
  if (!section) throw new Error('exercise section not rendered');
  return { ui, view, section };
}

beforeEach(() => {
  localStorage.clear();
  state.variant = 'ley8968';
  findUnique.mockReset();
  findUnique.mockImplementation(({ where }: { where: { slug: string } }) => Promise.resolve(ORGS[where.slug] ?? null));
});

describe('publicCandidateContactEmail (privacy notice contact resolution)', () => {
  it('returns settings.candidateContactEmail, normalized', () => {
    expect(publicCandidateContactEmail({ candidateContactEmail: '  RRHH@Org.example ' })).toBe('rrhh@org.example');
  });

  it('returns null when the setting is missing, not a string or not an email (no platform-wide default)', () => {
    for (const settings of [
      {},
      { candidateContactEmail: 42 },
      { candidateContactEmail: 'not-an-email' },
      { candidateContactEmail: '' },
      ['a@org.example'],
      'a@org.example',
      null,
      undefined,
    ]) {
      expect(publicCandidateContactEmail(settings)).toBeNull();
    }
  });

  it('accepts a bare mailbox only: no display name, list, CR/LF or oversized value', () => {
    for (const bad of [
      'Ana <ana@org.example>',
      'a@org.example, b@org.example',
      'a@org.example\r\nBcc: z@evil.example',
      `${'a'.repeat(250)}@org.example`,
    ]) {
      expect(publicCandidateContactEmail({ candidateContactEmail: bad })).toBeNull();
    }
  });
});

describe('/careers/[orgSlug]/privacy — default variant (flag off)', () => {
  it("renders main's country-neutral notice and reads no settings, so no mailbox can be published", async () => {
    state.variant = 'default';
    const ui = await CareersPrivacyPage({ params: Promise.resolve({ orgSlug: 'alpha' }) });
    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: 'alpha' },
      select: { name: true, isActive: true, settings: false },
    });
    expect(Object.keys(ui.props as Record<string, unknown>).sort()).toEqual(['orgName', 'orgSlug']);
    const view = render(<I18nProvider>{ui}</I18nProvider>);
    expect(await screen.findByRole('heading', { level: 1, name: es.portalPrivacy.title })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: pp.aiHeading })).toBeNull();
    expect(view.container.textContent).not.toMatch(/@|8968/);
  });
});

describe('/careers/[orgSlug]/privacy — Ley 8968 variant: contact channel per organization', () => {
  it('reads no billing email and hands the client component the resolved address, not the settings', async () => {
    const { ui } = await renderPage('alpha');
    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: 'alpha' },
      select: { name: true, isActive: true, settings: true },
    });
    expect(Object.keys(ui.props as Record<string, unknown>).sort()).toEqual(['contactEmail', 'orgName', 'orgSlug']);
  });

  it('an organization with candidateContactEmail shows that mailbox, not its billing email', async () => {
    const { section, view } = await renderPage('alpha');
    const link = within(section).getByRole('link', { name: 'talento@alpha.example' });
    expect(link.getAttribute('href')).toBe('mailto:talento@alpha.example');
    expect(section.textContent).toContain(pp.exerciseBody.replace('{email}', 'talento@alpha.example'));
    expect(view.container.textContent).not.toContain('facturas@alpha.example');
  });

  it("two organizations show different contact lines — never the other organization's mailbox", async () => {
    const alpha = await renderPage('alpha');
    const alphaText = alpha.section.textContent ?? '';
    alpha.view.unmount();

    const beta = await renderPage('beta');
    const betaText = beta.section.textContent ?? '';
    expect(within(beta.section).getByRole('link', { name: 'seleccion@beta.example' }).getAttribute('href')).toBe(
      'mailto:seleccion@beta.example',
    );
    expect(betaText).not.toEqual(alphaText);
    expect(beta.view.container.textContent).not.toMatch(/alpha\.example|admin@beta\.example/);
  });

  it.each(['gamma', 'delta'])(
    '%s: an organization with no candidate contact shows no address at all — not even its billing email',
    async (slug) => {
      const { section, view } = await renderPage(slug);
      expect(section.textContent).toContain(pp.exerciseBodyNoContact);
      expect(within(section).queryByRole('link')).toBeNull();
      expect(view.container.textContent).not.toMatch(/@|\{email\}/);
    },
  );

  it('unknown and inactive organizations 404', async () => {
    await expect(CareersPrivacyPage({ params: Promise.resolve({ orgSlug: 'nope' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    await expect(CareersPrivacyPage({ params: Promise.resolve({ orgSlug: 'closed' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
