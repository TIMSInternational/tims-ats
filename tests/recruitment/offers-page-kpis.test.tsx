import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

type OfferRow = { id: string; status: string; salary: number; currency: string | null };
type QueryResult = {
  data?: { items: OfferRow[]; total: number };
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
};

const listInputs: Array<Record<string, unknown>> = [];
let filteredQuery: QueryResult;
let allQuery: QueryResult;

// The page issues two offer.list queries: the table's (carries a `status` key, possibly undefined)
// and the KPI query (`{ pageSize: 100 }` only). Route each to different data so the test can prove
// which one feeds the KPIs.
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    offer: {
      list: {
        useQuery: (input: Record<string, unknown>) => {
          listInputs.push(input);
          return 'status' in input ? filteredQuery : allQuery;
        },
      },
    },
  },
}));

vi.mock('../../apps/web/app/(admin)/recruitment/offers/_components/offer-table', () => ({
  OfferTable: ({ items }: { items: OfferRow[] }) => <div data-testid="offer-table">{items.length} rows</div>,
}));

vi.mock('../../apps/web/app/(admin)/recruitment/offers/_components/offer-detail-view', () => ({
  OfferDetailView: () => null,
}));

import OffersPage from '../../apps/web/app/(admin)/recruitment/offers/page';

const refetch = () => Promise.resolve(undefined);
const ALL: OfferRow[] = [
  { id: 'o1', status: 'accepted', salary: 100, currency: 'USD' },
  { id: 'o2', status: 'accepted', salary: 300, currency: 'USD' },
  { id: 'o3', status: 'declined', salary: 50_000, currency: 'USD' },
  { id: 'o4', status: 'sent', salary: 50_000, currency: 'USD' },
  { id: 'o5', status: 'pending_approval', salary: 50_000, currency: 'USD' },
];

function renderPage() {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <OffersPage />
    </I18nProvider>,
  );
}

function card(label: string) {
  const el = screen.getByText(label).parentElement?.parentElement;
  if (!el) throw new Error(`KPI card ${label} not found`);
  return el;
}

describe('Offers page KPIs', () => {
  beforeEach(() => {
    listInputs.length = 0;
    filteredQuery = {
      data: { items: [{ id: 'o9', status: 'draft', salary: 9_999_999, currency: 'USD' }], total: 1 },
      isLoading: false,
      isError: false,
      refetch,
    };
    allQuery = { data: { items: ALL, total: ALL.length }, isLoading: false, isError: false, refetch };
  });

  it('computes KPIs from the unfiltered list, not the table list', () => {
    renderPage();

    expect(listInputs).toContainEqual({ pageSize: 100 });
    expect(screen.getByTestId('offer-table')).toHaveTextContent('1 rows');
    // active = sent + pending_approval; acceptance = 2 accepted / 4 sent-or-resolved; avg = (100+300)/2
    expect(card(en.offers.kpiActive)).toHaveTextContent('2');
    expect(card(en.offers.kpiAcceptance)).toHaveTextContent('50%');
    expect(card(en.offers.kpiAvgSalary)).toHaveTextContent('$200.00');
    expect(card(en.offers.kpiPending)).toHaveTextContent('1');
    expect(screen.queryByText(en.offers.kpiIncomplete)).not.toBeInTheDocument();
  });

  it('withholds KPIs when the unfiltered list is larger than what was loaded (uses its total)', () => {
    allQuery = { ...allQuery, data: { items: ALL, total: 101 } };
    filteredQuery = { ...filteredQuery, data: { items: ALL, total: ALL.length } };
    renderPage();

    for (const label of [en.offers.kpiActive, en.offers.kpiAcceptance, en.offers.kpiAvgSalary, en.offers.kpiPending]) {
      expect(card(label)).toHaveTextContent(en.offers.notAvailable);
      expect(card(label)).toHaveTextContent(en.offers.kpiIncomplete);
    }
  });

  it('does not gate the KPIs on the filtered table query loading or failing', () => {
    filteredQuery = { data: undefined, isLoading: false, isError: true, refetch };
    renderPage();
    expect(card(en.offers.kpiActive)).toHaveTextContent('2');

    filteredQuery = { data: undefined, isLoading: true, isError: false, refetch };
    renderPage();
    expect(screen.getAllByText(en.offers.kpiActive).length).toBeGreaterThan(0);
  });
});
