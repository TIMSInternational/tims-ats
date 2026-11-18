import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { offerDetailHref, readOfferIdParam } from '../../apps/web/lib/offer-deep-link';

// Pilot UX audit B-27: one offer is addressable by URL, so the approver email, the "Pendientes de mi
// aprobación" card and the browser Back button can open or close it.

const OFFER_ID = 'abcdef01-1111-4222-8333-444455556666';
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => nav.params,
}));
vi.mock('../../apps/web/lib/i18n/index', async () => {
  const en = (await import('../../apps/web/lib/i18n/en.json')).default;
  return { useI18n: () => ({ t: en, locale: 'EN' }) };
});
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    offer: {
      list: {
        useQuery: () => ({ data: { items: [], total: 0 }, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      getPending: {
        useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
      },
    },
  },
}));
vi.mock('../../apps/web/app/(admin)/recruitment/offers/_components/offer-table', () => ({
  OfferTable: ({ onSelectOffer }: { onSelectOffer: (id: string) => void }) => (
    <button type="button" onClick={() => onSelectOffer(OFFER_ID)}>
      open-row
    </button>
  ),
}));
vi.mock('../../apps/web/app/(admin)/recruitment/offers/_components/offer-detail-view', () => ({
  OfferDetailView: ({ offerId, onBack }: { offerId: string; onBack: () => void }) => (
    <div>
      <span data-testid="detail">{offerId}</span>
      <button type="button" onClick={onBack}>
        back
      </button>
    </div>
  ),
}));

import OffersPage from '../../apps/web/app/(admin)/recruitment/offers/page';

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.push.mockReset();
});

describe('offers page deep link', () => {
  it('opens the offer named in ?offer=', () => {
    nav.params = new URLSearchParams({ offer: OFFER_ID });
    render(<OffersPage />);
    expect(screen.getByTestId('detail')).toHaveTextContent(OFFER_ID);
  });

  it('a row click puts the offer in the URL instead of hidden state', () => {
    render(<OffersPage />);
    fireEvent.click(screen.getByRole('button', { name: 'open-row' }));
    expect(nav.push).toHaveBeenCalledWith(`/recruitment/offers?offer=${OFFER_ID}`, { scroll: false });
  });

  it('"Back to offers" returns to the list URL', () => {
    nav.params = new URLSearchParams({ offer: OFFER_ID });
    render(<OffersPage />);
    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(nav.push).toHaveBeenCalledWith('/recruitment/offers', { scroll: false });
  });

  it('a mangled id shows the list, not a broken detail view', () => {
    nav.params = new URLSearchParams({ offer: 'not-a-uuid' });
    render(<OffersPage />);
    expect(screen.queryByTestId('detail')).toBeNull();
    expect(screen.getByRole('button', { name: 'open-row' })).toBeInTheDocument();
  });
});

describe('offer deep-link helpers', () => {
  it('accepts only a UUID and builds the same URL the email and the card use', () => {
    expect(readOfferIdParam(` ${OFFER_ID} `)).toBe(OFFER_ID);
    expect(readOfferIdParam('1; drop')).toBeNull();
    expect(readOfferIdParam(null)).toBeNull();
    expect(offerDetailHref(OFFER_ID)).toBe(`/recruitment/offers?offer=${OFFER_ID}`);
  });
});
