import type { MetadataRoute } from 'next';

// Only the public careers portal is meant to be crawled. Everything else is the
// signed-in staff app or auth pages.
//
// Bearer-token landing pages (invitation, password reset, offer signing,
// interview join) are deliberately NOT disallowed: they answer with
// `X-Robots-Tag: noindex` (middleware), and a crawler can only honour that
// header if robots.txt lets it fetch the page. Disallowing them would let a
// search engine index the bare URL — token included — if it is linked anywhere.
//
// The careers pages render their vacancies client-side, so crawlers must also
// be able to fetch the Next.js assets and the public `portal.*` tRPC reads
// (batched calls share the `/api/trpc/portal.` prefix).
const CRAWLABLE_PATHS = ['/careers', '/_next/static/', '/_next/image', '/api/trpc/portal.'];
const NOINDEX_BEARER_PATHS = ['/accept-invitation', '/reset-password', '/offers/sign/', '/interview/join/'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [...CRAWLABLE_PATHS, ...NOINDEX_BEARER_PATHS],
      disallow: ['/'],
    },
  };
}
