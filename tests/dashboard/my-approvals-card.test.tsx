import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// Pilot UX audit B-01 / B-27: "Pendientes de mi aprobación" lists every vacancy AND offer waiting for
// the viewer, oldest first, each row linking to the item itself; it stays out of the way for users who
// cannot approve, and only queries the half the user can act on.

const VACANCY_ID = '11111111-aaaa-4aaa-8aaa-111111111111';
const OFFER_ID = '22222222-bbbb-4bbb-8bbb-222222222222';

type Q = { data?: unknown; isLoading: boolean; isError: boolean };
const state = vi.hoisted(() => ({
  grants: new Set<string>(),
  permissionsLoading: false,
  vacancies: { isLoading: false, isError: false } as Q,
  offers: { isLoading: false, isError: false } as Q,
  enabled: {} as Record<string, boolean | undefined>,
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({
    can: (module: string, action = 'read') => state.grants.has(`${module}:${action}`),
    isLoading: state.permissionsLoading,
  }),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    vacancy: {
      getPending: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
          state.enabled.vacancy = opts?.enabled;
          return state.vacancies;
        },
      },
    },
    offer: {
      getPending: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
          state.enabled.offer = opts?.enabled;
          return state.offers;
        },
      },
    },
  },
}));

import { MyApprovalsCard } from '../../apps/web/app/(admin)/dashboard/my-approvals-card';

const VACANCY_ROWS = [
  {
    approvalId: 'va-1',
    step: 1,
    requestedAt: '2026-11-03T10:00:00.000Z',
    vacancy: { id: VACANCY_ID, title: 'Data Analyst', creator: { id: 'u1', firstName: 'Rita', lastName: 'Recruiter' } },
  },
];
const OFFER_ROWS = [
  {
    approvalId: 'oa-1',
    step: 1,
    requestedAt: '2026-11-02T10:00:00.000Z',
    offer: {
      id: OFFER_ID,
      candidate: { firstName: 'María', lastName: 'Pérez' },
      vacancy: { id: VACANCY_ID, title: 'Data Analyst' },
    },
  },
];

beforeEach(() => {
  state.grants = new Set(['vacancy:approve', 'offer:approve']);
  state.permissionsLoading = false;
  state.vacancies = { data: VACANCY_ROWS, isLoading: false, isError: false };
  state.offers = { data: OFFER_ROWS, isLoading: false, isError: false };
  state.enabled = {};
});

describe('MyApprovalsCard', () => {
  it('lists offers and vacancies oldest first, each linking to the item itself', () => {
    render(<MyApprovalsCard />);
    expect(screen.getByRole('heading', { name: en.managerDashboard.approvalsInboxTitle })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/recruitment/offers?offer=${OFFER_ID}`,
      `/recruitment/vacancies/${VACANCY_ID}`,
    ]);
    expect(within(links[0]!).getByText('María Pérez')).toBeInTheDocument();
    expect(within(links[0]!).getByText(en.managerDashboard.approvalKindOffer)).toBeInTheDocument();
    expect(within(links[1]!).getByText('Data Analyst')).toBeInTheDocument();
    expect(within(links[1]!).getByText('Created by Rita Recruiter')).toBeInTheDocument();
    expect(screen.getByLabelText('2 awaiting your approval')).toHaveTextContent('2');
  });

  it('renders nothing (and queries nothing) for a user who cannot approve', () => {
    state.grants = new Set(['offer:read', 'vacancy:read']);
    const { container } = render(<MyApprovalsCard />);
    expect(container).toBeEmptyDOMElement();
    expect(state.enabled).toEqual({ vacancy: false, offer: false });
  });

  it('does not query while permissions are still loading', () => {
    state.permissionsLoading = true;
    const { container } = render(<MyApprovalsCard />);
    expect(container).toBeEmptyDOMElement();
    expect(state.enabled).toEqual({ vacancy: false, offer: false });
  });

  it('queries only the half the user can approve', () => {
    state.grants = new Set(['offer:approve']);
    render(<MyApprovalsCard />);
    expect(state.enabled).toEqual({ vacancy: false, offer: true });
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('shows an empty state when nothing is waiting', () => {
    state.vacancies = { data: [], isLoading: false, isError: false };
    state.offers = { data: [], isLoading: false, isError: false };
    render(<MyApprovalsCard />);
    expect(screen.getByText(en.managerDashboard.approvalsInboxEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows an error instead of a misleading empty list when a query fails', () => {
    state.offers = { isLoading: false, isError: true };
    render(<MyApprovalsCard />);
    expect(screen.getByText(en.managerDashboard.loadError)).toBeInTheDocument();
    expect(screen.queryByText(en.managerDashboard.approvalsInboxEmpty)).toBeNull();
  });
});
