import type { MetadataRoute } from 'next';
import { careersSiteOrigin, isCareersSeoEnabled } from '../lib/careers-seo';
import { loadCareersSitemap } from '../lib/careers-sitemap';

// /sitemap.xml: the opted-in public careers boards and their open vacancies (lib/careers-sitemap.ts). Empty unless
// CAREERS_SEO_ENABLED is 'true', CAREERS_SEO_ORG_SLUGS names at least one organization and the canonical origin is
// configured. Read per request (never at build time), so it always reflects what the careers pages currently serve.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isCareersSeoEnabled()) return [];
  const origin = careersSiteOrigin();
  return origin ? loadCareersSitemap(origin) : [];
}
