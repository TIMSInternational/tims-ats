import type { MetadataRoute } from 'next';

// Only the public careers portal is meant to be crawled. Everything else is the
// signed-in staff app, auth pages, or bearer-token links (offer signing,
// interview join, AI interview) that must never be indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/careers'],
      disallow: ['/'],
    },
  };
}
