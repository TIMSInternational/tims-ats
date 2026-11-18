import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Pilot UX audit B-14 + Codex review: "Pendientes de mi aprobación" shows every offer offer.getPending returns
// for the viewer, not only those that happen to be on the newest page of offer.list.

const listInputs: Array<{ input: Record<string, unknown>; options?: { enabled?: boolean } }> = [];
const pendingRow = {
  approvalId: 'ap-1',
  step: 1,
  requestedAt: '2026-11-01T10:00:00Z',
  offer: {
    id: 'old-offer',
    salary: 12_000_000,
    currency: 'CRC',
    status: 'pending_approval',
    sentAt: null,
    expiresAt: null,
    candidate: { id: 'c1', firstName: 'Ana', lastName: 'Mora', email: 'ana@x.test', avatar: null },
    vacancy: { id: 'v1', title: 'Analista' },
  },
};

vi.mock('../../apps/web/lib/i18n/index', async () => {
  const es = (await import('../../apps/web/lib/i18n/es.json')).default;
  return { useI18n: () => ({ t: es, locale: 'ES' }) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('../../apps/web/lib/permissions', () => ({ useCan: () => () => true }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    offer: {
      list: {
        useQuery: (input: Record<string, unknown>, options?: { enabled?: boolean }) => {
          listInputs.push({ input, options });
          return { data: { items: [], total: 0 }, isLoading: false, isError: false, refetch: vi.fn() };
        },
      },
      getPending: {
        useQuery: (_input: undefined, options: { enabled: boolean }) =>
          options.enabled
            ? { data: [pendingRow], isLoading: false, isError: false, refetch: vi.fn() }
            : { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
      },
    },
  },
}));
vi.mock('../../apps/web/app/(admin)/recruitment/offers/_components/offer-table', () => ({
  OfferTable: ({
    items,
    onStatusChange,
    showMinePendingFilter,
  }: {
    items: Array<{ id: string; approvals: unknown[] }>;
    onStatusChange: (status: string) => void;
    showMinePendingFilter: boolean;
  }) => (
    <div>
      <span data-testid="rows">{items.map((item) => `${item.id}:${item.approvals.length}`).join(',')}</span>
      <span data-testid="mine-offered">{String(showMinePendingFilter)}</span>
      <button type="button" onClick={() => onStatusChange('mine_pending')}>
        mine
      </button>
    </div>
  ),
}));
vi.mock('../../apps/web/app/(admin)/recruitment/offers/_components/offer-detail-view', () => ({
  OfferDetailView: () => null,
}));

import OffersPage from '../../apps/web/app/(admin)/recruitment/offers/page';

describe('offers page "Pendientes de mi aprobación"', () => {
  it('lists the getPending rows (unpaginated) and pauses the paginated list query', () => {
    render(<OffersPage />);
    expect(screen.getByTestId('mine-offered').textContent).toBe('true');
    expect(screen.getByTestId('rows').textContent).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'mine' }));
    expect(screen.getByTestId('rows').textContent).toBe('old-offer:0');
    const tableQuery = listInputs.filter(({ input }) => 'status' in input).at(-1)!;
    expect(tableQuery.options?.enabled).toBe(false);
  });
});
