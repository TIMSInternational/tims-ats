import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    const text = container.textContent ?? '';
    expect(text).toContain('COP 4.500.000 – 6.000.000 / mes');
    expect(text).not.toContain('/ ano');
    expect(text).not.toContain('/ año');
    expect(screen.getAllByText('Término indefinido').length).toBeGreaterThan(0);
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
    expect(yearly.container.textContent).toContain('Desde COP 90.000.000 / año');
    yearly.unmount();

    mocks.vacancy = { ...BASE, salary: { min: 4500000, currency: 'COP' } };
    const noPeriod = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(noPeriod.container.textContent).toContain('Desde COP 4.500.000');
    expect(noPeriod.container.textContent).not.toMatch(/\/ (mes|año)/);
    noPeriod.unmount();

    mocks.vacancy = { ...BASE, salary: null };
    const none = render(<JobDetailView orgSlug="acme" vacancyId={BASE.id} />);
    expect(none.container.textContent).not.toContain(es.portal.salaryLabel);
  });
});

describe('public vacancy card', () => {
  it('shows the stored period, labels and a markdown-free preview', () => {
    const { container } = render(<VacancyCard vacancy={{ ...BASE }} orgSlug="acme" />);
    const text = container.textContent ?? '';
    expect(text).toContain('COP 4.500.000 – 6.000.000');
    expect(text).toContain('/ mes');
    expect(text).not.toContain('/ ano');
    expect(text).toContain('Término indefinido');
    expect(text).toContain('Presencial');
    expect(text).not.toContain('onsite');
    expect(text).not.toContain('**');
    expect(text).toContain('Responsabilidades: Coordinar despachos');
  });

  it('shows the negotiable copy when there is no salary', () => {
    render(<VacancyCard vacancy={{ ...BASE, salary: null }} orgSlug="acme" />);
    expect(screen.getByText(es.portal.salaryNegotiable)).toBeInTheDocument();
  });
});
