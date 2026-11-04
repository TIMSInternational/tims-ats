import { beforeEach, describe, expect, it, vi } from 'vitest';

// The approver email links must land on the item even when the approver is signed out when clicking
// (an email client, often on a phone). Signed-out requests go to /login?redirect=<pathname>, so both links
// are PATH-shaped; the offer path then opens the offers page on that offer.

const state = vi.hoisted(() => ({ user: null as null | { id: string }, redirect: vi.fn() }));
vi.mock('@tims/auth/middleware', () => ({
  updateSession: async () => ({ supabaseResponse: new Response(null), user: state.user }),
}));
vi.mock('next/navigation', () => ({ redirect: state.redirect }));

import { middleware } from '../../apps/web/middleware';
import { NextRequest } from '../../apps/web/node_modules/next/server';
import OfferLinkPage from '../../apps/web/app/(admin)/recruitment/offers/[id]/page';
import { offerDetailHref, offerLinkPath, offerLinkTarget } from '../../apps/web/lib/offer-deep-link';

const OFFER_ID = 'abcdef01-1111-4222-8333-444455556666';
const VACANCY_ID = '12345678-aaaa-4bbb-8ccc-ddddeeeeffff';

async function loginRedirectFor(path: string): Promise<string | null> {
  const response = await middleware(
    new NextRequest(`https://app.tims.com${path}`, { headers: { host: 'app.tims.com' } }),
  );
  const location = response.headers.get('location');
  if (!location) return null;
  const url = new URL(location);
  expect(url.pathname).toBe('/login');
  return url.searchParams.get('redirect');
}

beforeEach(() => {
  state.user = null;
  state.redirect.mockReset();
});

describe('approver email link, signed out', () => {
  it('keeps the offer link through the sign-in redirect', async () => {
    expect(await loginRedirectFor(offerLinkPath(OFFER_ID))).toBe(`/recruitment/offers/${OFFER_ID}`);
  });

  it('keeps the vacancy link through the sign-in redirect', async () => {
    expect(await loginRedirectFor(`/recruitment/vacancies/${VACANCY_ID}`)).toBe(`/recruitment/vacancies/${VACANCY_ID}`);
  });
});

describe('offer link route', () => {
  it('opens the offers page on that offer', async () => {
    await OfferLinkPage({ params: Promise.resolve({ id: OFFER_ID }) });
    expect(state.redirect).toHaveBeenCalledWith(`/recruitment/offers?offer=${OFFER_ID}`);
  });

  it('shows the offers list for a mangled id', async () => {
    await OfferLinkPage({ params: Promise.resolve({ id: 'not-an-offer' }) });
    expect(state.redirect).toHaveBeenCalledWith('/recruitment/offers');
  });

  it('maps a path link to the in-app detail URL', () => {
    expect(offerLinkTarget(OFFER_ID)).toBe(offerDetailHref(OFFER_ID));
    expect(offerLinkTarget('')).toBe('/recruitment/offers');
    expect(offerLinkTarget(undefined)).toBe('/recruitment/offers');
  });
});
