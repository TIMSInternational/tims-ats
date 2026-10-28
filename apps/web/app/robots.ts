import type { MetadataRoute } from 'next';

// Only the public careers portal is meant to be crawled. Everything else is the
// signed-in staff app, auth pages, or bearer-token links (offer signing,
// interview join, AI interview) that must never be indexed.
//
// The careers pages render their vacancies client-side, so crawlers must also
// be able to fetch the Next.js assets and the public `portal.*` tRPC reads
// (batched calls share the `/api/trpc/portal.` prefix).
const CRAWLABLE_PATHS = ['/careers', '/_next/static/', '/_next/image', '/api/trpc/portal.'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: CRAWLABLE_PATHS,
      disallow: ['/'],
    },
  };
}
