import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

const mocks = vi.hoisted(() => ({
  applications: [] as unknown[],
  movements: [] as unknown[],
  appStatus: 'active',
  interviews: [] as unknown[],
  offers: [] as unknown[],
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      candidatePortal: { myApplications: { invalidate: vi.fn() }, applicationStatus: { invalidate: vi.fn() } },
    }),
    candidatePortal: {
      withdrawMyApplication: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      myApplications: { useQuery: () => ({ data: mocks.applications, isLoading: false, isError: false }) },
      applicationStatus: {
        useQuery: () => ({ data: { status: mocks.appStatus, movements: mocks.movements }, isLoading: false, isError: false }),
      },
      myInterviews: { useQuery: () => ({ data: mocks.interviews, isLoading: false, isError: false }) },
      myOffers: { useQuery: () => ({ data: mocks.offers, isLoading: false, isError: false }) },
    },
  },
}));

import { DashboardApplications } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-applications';
import { DashboardInterviews } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-interviews';
import { DashboardOffer } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-offer';

const plain = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');
const pd = es.portalDashboard;

beforeEach(() => {
  mocks.appStatus = 'active';
  mocks.applications = [
    {
      id: 'a1',
      status: 'active',
      appliedAt: '2026-11-05T03:00:00.000Z', // 4 Nov, 21:00 in Costa Rica
      vacancy: { title: 'Analista', company: null },
      currentStage: { name: 'Prueba Tecnica' },
    },
  ];
  // As the API returns them: newest first (candidate-portal.repository orders movedAt desc).
  mocks.movements = [
    { movedAt: '2026-11-07T15:00:00.000Z', toStage: { name: 'Entrevista Final' } },
    { movedAt: '2026-11-06T15:00:00.000Z', toStage: { name: 'Entrevista RRHH' } },
    { movedAt: '2026-11-05T15:00:00.000Z', toStage: { name: 'Screening' } },
  ];
  mocks.interviews = [
    {
      id: 'i1',
      type: 'technical',
      status: 'scheduled',
      scheduledAt: '2026-11-04T16:00:00.000Z',
      duration: 60,
      location: null,
      meetingUrl: null,
      vacancy: { title: 'Analista' },
    },
  ];
  mocks.offers = [];
});

describe('candidate portal — applications', () => {
  it('shows a candidate phase (not the internal stage name) and the date in the organization zone', () => {
    const { container } = render(<DashboardApplications orgSlug="acme" timeZone="America/Costa_Rica" />);
    expect(container.textContent).not.toContain('Prueba Tecnica');
    expect(container.textContent).toContain(pd.phaseReview);
    expect(container.textContent).toContain(pd.phaseReviewDesc);
    expect(container.textContent).toContain(`${pd.appliedOn} 4 de noviembre de 2026`);
  });

  it('collapses the stage history into phases, each dated by when it began, newest first', () => {
    const { container } = render(<DashboardApplications orgSlug="acme" timeZone="America/Costa_Rica" />);
    fireEvent.click(screen.getByRole('button', { name: pd.viewTimeline }));
    const items = [...container.querySelectorAll('ol li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(2);
    // Interviews began with "Entrevista RRHH" on 6 Nov — not the later "Entrevista Final" on 7 Nov.
    expect(items[0]).toContain(pd.phaseInterviews);
    expect(items[0]).toContain('6 de noviembre de 2026');
    expect(items[1]).toContain(pd.phaseReview);
    expect(items[1]).toContain('5 de noviembre de 2026');
    expect(container.textContent).not.toMatch(/Screening|Entrevista RRHH/);
  });
});

describe('candidate portal — hiring is announced by status, never by a stage name', () => {
  it('an active application in "Contratado" / "No contratado" is not shown as selected', () => {
    mocks.applications = [
      { id: 'a1', status: 'active', appliedAt: '2026-11-05T15:00:00.000Z', vacancy: { title: 'Analista', company: null }, currentStage: { name: 'No contratado' } },
    ];
    mocks.movements = [{ movedAt: '2026-11-07T15:00:00.000Z', toStage: { name: 'Contratado' } }];
    const { container } = render(<DashboardApplications orgSlug="acme" timeZone="America/Costa_Rica" />);
    fireEvent.click(screen.getByRole('button', { name: pd.viewTimeline }));
    expect(container.textContent).not.toContain(pd.phaseHired);
    expect(container.textContent).not.toContain(pd.phaseHiredDesc);
  });

  it('a hired application shows the hire on its latest move', () => {
    mocks.appStatus = 'hired';
    mocks.applications = [
      { id: 'a1', status: 'hired', appliedAt: '2026-11-05T15:00:00.000Z', vacancy: { title: 'Analista', company: null }, currentStage: { name: 'Contratado' } },
    ];
    mocks.movements = [
      { movedAt: '2026-11-07T15:00:00.000Z', toStage: { name: 'Contratado' } },
      { movedAt: '2026-11-06T15:00:00.000Z', toStage: { name: 'Oferta' } },
    ];
    const { container } = render(<DashboardApplications orgSlug="acme" timeZone="America/Costa_Rica" />);
    fireEvent.click(screen.getByRole('button', { name: pd.viewTimeline }));
    const items = [...container.querySelectorAll('ol li')].map((li) => li.textContent ?? '');
    expect(items[0]).toContain(pd.phaseHired);
    expect(items[1]).toContain(pd.phaseOffer);
  });
});

describe('candidate portal — interviews', () => {
  it('shows the time in the organization zone with "hora de Costa Rica (GMT-6)" — never the device locale', () => {
    const { container } = render(<DashboardInterviews orgSlug="acme" timeZone="America/Costa_Rica" />);
    const text = plain(container.textContent);
    expect(text).toContain('4 de noviembre de 2026');
    expect(text).toContain('10:00');
    expect(text).toContain('hora de Costa Rica (GMT-6)');
    expect(text).not.toMatch(/10:00:00/);
  });

  it('says UTC explicitly when the organization has no time zone', () => {
    const { container } = render(<DashboardInterviews orgSlug="acme" />);
    expect(plain(container.textContent)).toMatch(/4:00 p\. m\., UTC/);
  });
});

describe('candidate portal — offer', () => {
  it('shows an expired offer as expired, with what to do, instead of "Pendiente de respuesta"', () => {
    mocks.offers = [
      {
        id: 'o1',
        status: 'sent',
        salary: 10_200_000,
        currency: 'CRC',
        startDate: '2026-11-09T18:00:00.000Z',
        contractType: 'Plazo indefinido',
        expiresAt: '2026-01-01T00:00:00.000Z',
        signingToken: null,
        vacancy: { title: 'Analista', company: null },
      },
    ];
    const { container } = render(<DashboardOffer orgSlug="acme" timeZone="America/Costa_Rica" />);
    expect(container.textContent).toContain(pd.offerStatusExpired);
    expect(container.textContent).toContain(pd.offerExpiredNote);
    expect(container.textContent).not.toContain(pd.offerStatusSent);
    expect(container.textContent).not.toContain(pd.offerExpiresOn);
    expect(plain(container.textContent)).toContain('₡850 000');
    expect(container.textContent).toContain('9 de noviembre de 2026');
  });

  it('keeps a pending offer pending, with its expiry date', () => {
    mocks.offers = [
      {
        id: 'o2',
        status: 'sent',
        salary: 10_200_000,
        currency: 'CRC',
        startDate: '2026-11-09T18:00:00.000Z',
        contractType: 'Plazo fijo',
        expiresAt: '2999-01-01T18:00:00.000Z',
        signingToken: 'tok',
        vacancy: { title: 'Analista', company: null },
      },
    ];
    const { container } = render(<DashboardOffer orgSlug="acme" timeZone="America/Costa_Rica" />);
    expect(container.textContent).toContain(pd.offerStatusSent);
    expect(container.textContent).toContain(`${pd.offerExpiresOn} 1 de enero de 2999`);
    expect(screen.getByRole('link', { name: pd.offerReviewSign })).toHaveAttribute('href', '/offers/sign/tok');
  });
});
