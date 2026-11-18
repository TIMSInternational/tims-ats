import type { MetadataRoute } from 'next';
import { careersSiteOrigin, isCareersSeoEnabled } from '../lib/careers-seo';

// Only the public careers portal is meant to be crawled. Everything else is the
// signed-in staff app or auth pages, and inside the portal the candidate's own
// signed-in pages (login, dashboard, the legacy /me redirect) are not crawled.
//
// Bearer-token landing pages (invitation, password reset, offer signing,
// interview join, AI interview) are deliberately NOT disallowed: they answer with
// `X-Robots-Tag: noindex` (middleware), and a crawler can only honour that
// header if robots.txt lets it fetch the page. Disallowing them would let a
// search engine index the bare URL — token included — if it is linked anywhere.
//
// The careers pages render their vacancies client-side, so crawlers must also
// be able to fetch the Next.js assets and the public `portal.*` tRPC reads
// (batched calls share the `/api/trpc/portal.` prefix).
//
// The candidate pages use `*` (honoured by the major crawlers); being longer
// than the `/careers` allow, they win over it.
const CRAWLABLE_PATHS = ['/careers', '/_next/static/', '/_next/image', '/api/trpc/portal.', '/sitemap.xml'];
const NOINDEX_BEARER_PATHS = [
  '/accept-invitation',
  '/reset-password',
  '/offers/sign/',
  '/interview/join/',
  '/ai-interview/',
];
const CANDIDATE_SIGNED_IN_PATHS = ['/careers/*/login', '/careers/*/dashboard', '/careers/*/me'];

export default function robots(): MetadataRoute.Robots {
  // The sitemap line only when the careers SEO surfaces are on (lib/careers-seo.ts) and the canonical
  // origin is configured: an absolute sitemap URL on a guessed host would point crawlers elsewhere.
  const origin = isCareersSeoEnabled() ? careersSiteOrigin() : null;
  return {
    rules: {
      userAgent: '*',
      allow: [...CRAWLABLE_PATHS, ...NOINDEX_BEARER_PATHS],
      disallow: ['/', ...CANDIDATE_SIGNED_IN_PATHS],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
