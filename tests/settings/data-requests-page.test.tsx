import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

type QueryState = { isLoading: boolean; isError: boolean; error: unknown; data: unknown; refetch: () => void };

const mocks = vi.hoisted(() => ({
  enabled: true,
  canUpdate: true,
  statuses: [] as string[],
  query: {} as QueryState,
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t, locale: 'es' }) };
});
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({
    can: (module: string, action?: string) => module === 'candidate' && (action === 'read' || mocks.canUpdate),
    isLoading: false,
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../apps/web/lib/platform-api/candidate-consent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/lib/platform-api/candidate-consent')>();
  return {
    ...actual,
    isCandidateConsentEnabled: () => mocks.enabled,
    useDataSubjectRequests: (status: string) => {
      mocks.statuses.push(status);
      return mocks.query;
    },
  };
});

import es from '../../apps/web/lib/i18n/es.json';
import { PlatformApiError } from '../../apps/web/lib/platform-api/client';
import { dataSubjectRequestListSchema } from '../../apps/web/lib/platform-api/candidate-consent';
import DataRequestsPage from '../../apps/web/app/(admin)/settings/data-requests/page';

const m = es.dataSubjectRequests;
const DAY = 86_400_000;
const PAST_ID = '22222222-2222-4222-8222-222222222222';
const FUTURE_ID = '33333333-3333-4333-8333-333333333333';
const item = (n: number, candidateId: string, first: string, dueOffsetMs: number, source: string) => ({
  id: `1111111${n}-1111-4111-8111-111111111111`,
  candidateId,
  candidateFirstName: first,
  candidateLastName: 'Pérez',
  requestType: 'deletion',
  status: 'pending',
  source,
  createdAt: new Date(Date.now() - 30 * DAY).toISOString(),
  dueAt: new Date(Date.now() + dueOffsetMs).toISOString(),
});
const loaded = (items: unknown[]): QueryState => ({
  isLoading: false,
  isError: false,
  error: null,
  data: dataSubjectRequestListSchema.parse({ items }),
  refetch: vi.fn(),
});

beforeEach(() => {
  mocks.enabled = true;
  mocks.canUpdate = true;
  mocks.statuses = [];
  mocks.query = loaded([
    item(1, PAST_ID, 'Laura', -2 * DAY, 'candidate_portal'),
    item(2, FUTURE_ID, 'Carlos', 5 * DAY, 'staff'),
  ]);
});

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;

describe('/settings/data-requests', () => {
  it('lists pending requests with a link to the candidate profile, type, source and the due-date note', () => {
    render(<DataRequestsPage />);
    expect(mocks.statuses).toContain('pending');
    expect(screen.getByRole('link', { name: 'Laura Pérez' }).getAttribute('href')).toBe(`/recruitment/candidates/${PAST_ID}`);
    expect(screen.getByRole('link', { name: 'Carlos Pérez' }).getAttribute('href')).toBe(`/recruitment/candidates/${FUTURE_ID}`);
    expect(within(rowOf('Laura Pérez')).getByText(m.sourceCandidatePortal)).toBeTruthy();
    expect(within(rowOf('Carlos Pérez')).getByText(m.sourceStaff)).toBeTruthy();
    expect(screen.getAllByText(m.typeDeletion)).toHaveLength(2);
    expect(screen.getByText(m.dueDateNote)).toBeTruthy();
  });

  it('shows the text overdue badge only for a past dueAt', () => {
    render(<DataRequestsPage />);
    expect(within(rowOf('Laura Pérez')).getByText(m.overdue)).toBeTruthy();
    expect(within(rowOf('Carlos Pérez')).queryByText(m.overdue)).toBeNull();
  });

  it('renders the empty state when there are no pending requests', () => {
    mocks.query = loaded([]);
    render(<DataRequestsPage />);
    expect(screen.getByText(m.emptyTitle)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders the error state with retry on a failed load', () => {
    mocks.query = { isLoading: false, isError: true, error: new Error('boom'), data: undefined, refetch: vi.fn() };
    render(<DataRequestsPage />);
    expect(screen.getByText(m.loadError)).toBeTruthy();
    expect(screen.queryByText(m.emptyTitle)).toBeNull();
  });

  it('renders the no-permission state when the API answers 403', () => {
    mocks.query = {
      isLoading: false,
      isError: true,
      error: new PlatformApiError(403, 'forbidden', 'forbidden'),
      data: undefined,
      refetch: vi.fn(),
    };
    render(<DataRequestsPage />);
    expect(screen.getByText(m.noPermissionTitle)).toBeTruthy();
  });

  it('renders the loading skeleton (no rows, no empty state) while fetching', () => {
    mocks.query = { isLoading: true, isError: false, error: null, data: undefined, refetch: vi.fn() };
    const { container } = render(<DataRequestsPage />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText(m.emptyTitle)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the unavailable state while the candidate-consent flag is off', () => {
    mocks.enabled = false;
    render(<DataRequestsPage />);
    expect(screen.getByText(m.unavailableTitle)).toBeTruthy();
    expect(screen.queryByText(m.colCandidate)).toBeNull();
  });

  it('shows the no-permission state without candidate:update', () => {
    mocks.canUpdate = false;
    render(<DataRequestsPage />);
    expect(screen.getByText(m.noPermissionTitle)).toBeTruthy();
    expect(screen.queryByText(m.colCandidate)).toBeNull();
  });
});
