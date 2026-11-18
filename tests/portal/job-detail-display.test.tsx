import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

const mocks = vi.hoisted(() => ({
  vacancy: null as Record<string, unknown> | null,
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    portal: {
      getVacancy: { useQuery: () => ({ data: mocks.vacancy, isLoading: false, isError: false, refetch: vi.fn() }) },
      listVacancies: {
        useQuery: () => ({
          data: { items: mocks.vacancy ? [mocks.vacancy] : [] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal', () => ({
  ApplyModal: () => null,
}));

import { JobDetailView } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/job-detail-view';
import { VacancyCard } from '../../apps/web/app/(portal)/careers/[orgSlug]/_components/vacancy-card';
import { PortalOrgBrandProvider } from '../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-org-brand';

// Intl separates es-CR digit groups with a (narrow) no-break space; compare on plain spaces.
const plain = (text: string | null) => (text ?? '').replace(/[\u00a0\u202f]/g, ' ');

const BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  title: 'Analista de Logística',
  description: '**Responsabilidades:**\n- Coordinar despachos',
  location: 'Bogotá',
  remotePolicy: 'onsite',
  contractType: 'indefinido',
  salary: { min: 4500000, max: 6000000, currency: 'COP', period: 'monthly' },
  priority: 'medium',
  positions: 2,
  createdAt: new Date().toISOString(),
  company: { id: 'c1', name: 'Acme' },
  unit: null,
  organization: { name: 'Acme', logo: null },
  jobProfile: null,
  applicantCount: 3,
};

describe('public job detail', () => {
  beforeEach(() => {
    mocks.vacancy = { ...BASE };
  });

  it('shows the stored monthly period, localized amounts and enum labels instead of raw values', () => {
    const { container } = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    const text = plain(container.textContent);
    expect(text).toContain('COP 4 500 000 – COP 6 000 000 / mes');
    expect(text).not.toContain('/ ano');
    expect(text).not.toContain('/ año');
    expect(screen.getAllByText('Plazo indefinido').length).toBeGreaterThan(0);
    expect(screen.queryByText('indefinido')).toBeNull();
    expect(text).toContain('Bogotá (Presencial)');
    expect(text).not.toContain('onsite');
    expect(text).toContain('Ubicación');
    expect(text).not.toContain('**');
    expect(container.querySelector('main strong')?.textContent).toBe('Responsabilidades:');
  });

  it('shows "/ año" only for a yearly salary and no period when it is missing', () => {
    mocks.vacancy = { ...BASE, salary: { min: 90000000, currency: 'COP', period: 'yearly' } };
    const yearly = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(plain(yearly.container.textContent)).toContain('Desde COP 90 000 000 / año');
    yearly.unmount();

    mocks.vacancy = { ...BASE, salary: { min: 4500000, currency: 'CRC' } };
    const noPeriod = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(plain(noPeriod.container.textContent)).toContain('Desde ₡4 500 000');
    expect(noPeriod.container.textContent).not.toMatch(/\/ (mes|año)/);
    noPeriod.unmount();

    mocks.vacancy = { ...BASE, salary: null };
    const none = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(none.container.textContent).not.toContain(es.portal.salaryLabel);
  });

  it('names the organization (not "TIMS ATS") and keeps an apply button pinned for phones', () => {
    mocks.vacancy = { ...BASE, company: null, organization: { name: 'Instituto Ejemplo', logo: null } };
    const { container } = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    // The sticky header used to read "TIMS ATS"; it now names the organization.
    expect(screen.queryByText('TIMS ATS')).toBeNull();
    expect(container.querySelector('.h-14')?.textContent).toContain('Instituto Ejemplo');
    expect(screen.getAllByText('Instituto Ejemplo').length).toBeGreaterThan(0);
    expect(screen.queryByText(es.portal.companyFallback)).toBeNull();
    // The header button plus the phone bar (hidden from lg up).
    const applyButtons = screen.getAllByRole('button', { name: es.portal.applyNow });
    expect(applyButtons).toHaveLength(2);
    expect(applyButtons[1]!.closest('div')!.className).toContain('lg:hidden');
    // The header one is hidden below lg by a wrapper: Button's own inline-flex would beat a "hidden" class.
    expect(applyButtons[0]!.className).not.toContain('hidden');
    expect(applyButtons[0]!.parentElement!.className.split(' ')).toEqual(['hidden', 'lg:block']);
  });

  it('links the privacy notice before applying', () => {
    render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(screen.getByRole('link', { name: es.portal.footerPrivacy })).toHaveAttribute('href', '/careers/acme/privacy');
  });

  it('renders job-profile requirements and competencies by their text, never "[object Object]"', () => {
    mocks.vacancy = {
      ...BASE,
      jobProfile: {
        requirements: [{ text: 'Excel avanzado', isRequired: true }],
        competencies: [{ name: 'Liderazgo', level: 4 }],
      },
    };
    const { container } = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(container.textContent).toContain('Excel avanzado');
    expect(container.textContent).toContain('Liderazgo');
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('says a closed vacancy no longer takes applications, with a way back to the board', () => {
    mocks.vacancy = { closed: true };
    render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(screen.getByText(es.portal.vacancyClosedTitle)).toBeInTheDocument();
    expect(screen.queryByText(es.portal.vacancyNotFound)).toBeNull();
    expect(screen.getByRole('link', { name: es.portal.seeOtherVacancies })).toHaveAttribute('href', '/careers/acme');
    expect(screen.queryByRole('button', { name: es.portal.applyNow })).toBeNull();
  });

  it('keeps the organization in the top bar of a closed or missing vacancy (from the careers layout)', () => {
    for (const data of [{ closed: true }, null]) {
      mocks.vacancy = data;
      const { container, unmount } = render(
        <PortalOrgBrandProvider brand={{ name: 'Andina Logística', logo: null }}>
          <JobDetailView orgSlug="acme" vacancyId={BASE.id} />
        </PortalOrgBrandProvider>,
      );
      expect(container.querySelector('header')?.textContent).toContain('Andina Logística');
      unmount();
    }
  });
});

describe('public job detail under the pilot launch scope', () => {
  beforeEach(() => {
    mocks.vacancy = { ...BASE };
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('drops the "Sobre la empresa" section and its "evaluaciones científicas" vendor blurb', () => {
    const { container } = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(screen.queryByText(es.portal.aboutCompany)).toBeNull();
    expect(container.textContent).not.toContain(es.portal.companyUsesTimsSuffix);
  });
});

describe('public vacancy card', () => {
  it('shows the stored period, labels and a markdown-free preview', () => {
    const { container } = render(<VacancyCard vacancy={{ ...BASE }} orgSlug="acme" orgName="Acme" />);
    const text = plain(container.textContent);
    expect(text).toContain('COP 4 500 000 – COP 6 000 000');
    expect(text).toContain('/ mes');
    expect(text).not.toContain('/ ano');
    expect(text).toContain('Plazo indefinido');
    expect(text).toContain('Presencial');
    expect(text).not.toContain('onsite');
    expect(text).not.toContain('**');
    expect(text).toContain('Responsabilidades: Coordinar despachos');
  });

  it('shows the negotiable copy when there is no salary', () => {
    render(<VacancyCard vacancy={{ ...BASE, salary: null }} orgSlug="acme" orgName="Acme" />);
    expect(screen.getByText(es.portal.salaryNegotiable)).toBeInTheDocument();
  });

  it('names a client company with its initial, and does not repeat the board organization', () => {
    const client = render(<VacancyCard vacancy={{ ...BASE, company: { name: 'Cliente SA' } }} orgSlug="acme" orgName="Instituto Ejemplo" />);
    expect(screen.getByText('Cliente SA')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    client.unmount();

    // A single-employer board: the nav already shows the organization, so the card starts at the location.
    const { container } = render(
      <VacancyCard vacancy={{ ...BASE, company: null }} orgSlug="acme" orgName="Instituto Ejemplo" />,
    );
    expect(screen.queryByText('Instituto Ejemplo')).toBeNull();
    expect(screen.getByText('Bogotá')).toBeInTheDocument();
    expect(container.textContent).not.toContain(es.portal.companyFallback);
  });

  it('is one link named by the job title, not the whole card', () => {
    render(<VacancyCard vacancy={{ ...BASE }} orgSlug="acme" orgName="Acme" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(BASE.title);
    expect(links[0]).toHaveAttribute('href', `/careers/acme/${BASE.id}`);
  });
});
