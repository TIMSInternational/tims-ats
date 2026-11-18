import type { MetadataRoute } from 'next';
import { getAppUrl, isOrganizationSlugShape } from '@tims/shared';

// Search-engine surfaces of the public careers portal: the sitemap entries, the robots.txt sitemap line and
// the JobPosting structured data on vacancy pages. Two deploy-time settings, both needed, off by default:
//
//   CAREERS_SEO_ENABLED=true         → the master switch.
//   CAREERS_SEO_ORG_SLUGS=a,b        → the organizations that opted in. Only these boards are listed in
//                                      /sitemap.xml and only their vacancy pages carry JobPosting data.
//   either unset (or anything else)  → /sitemap.xml is empty, robots.txt has no sitemap line, no JobPosting data.
//
// Pure module (no database, no React): the loaders live in lib/careers-sitemap.ts and the careers _lib.

/** Only the exact string 'true' turns the careers SEO surfaces on. */
export function isCareersSeoEnabled(raw: string | undefined = process.env.CAREERS_SEO_ENABLED): boolean {
  return raw === 'true';
}

/**
 * The canonical public origin for absolute sitemap URLs (getAppUrl: NEXT_PUBLIC_APP_URL, validated), or null
 * when it is missing or invalid. A sitemap built on a guessed host would point crawlers at the wrong site.
 */
export function careersSiteOrigin(resolve: () => string = getAppUrl): string | null {
  try {
    return resolve().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Most organizations CAREERS_SEO_ORG_SLUGS can name; entries past it are ignored. */
export const MAX_CAREERS_SEO_ORGS = 100;

/**
 * The organizations whose careers pages may be offered to search engines: the comma-separated slugs in
 * CAREERS_SEO_ORG_SLUGS, keeping only entries shaped like a slug an organization can be created with. Empty
 * when unset. Listing is opt-in per organization because the slug shape alone says nothing about who an
 * organization is: demo and test organizations have ordinary slugs too.
 */
export function careersSeoOrgSlugs(raw: string | undefined = process.env.CAREERS_SEO_ORG_SLUGS): ReadonlySet<string> {
  if (!raw) return new Set();
  const slugs = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => isOrganizationSlugShape(entry));
  return new Set(slugs.slice(0, MAX_CAREERS_SEO_ORGS));
}

/**
 * Whether an organization's careers pages may be listed: it is in the opt-in list. Inactive organizations
 * never get further than this check: their careers pages answer 404 (careers/[orgSlug]/layout.tsx) and the
 * loaders only read active ones.
 */
export function isListableCareersSlug(slug: string, listed: ReadonlySet<string> = careersSeoOrgSlugs()): boolean {
  return listed.has(slug);
}

export function careersBoardPath(slug: string): string {
  return `/careers/${encodeURIComponent(slug)}`;
}

export interface SitemapBoard {
  id: string;
  slug: string;
  updatedAt: Date;
}

export interface SitemapVacancy {
  id: string;
  organizationId: string;
  updatedAt: Date;
}

/**
 * Sitemap entries for the given boards and their published vacancies, on `origin`. Boards that are not in
 * `listedSlugs` are dropped along with their vacancies; a vacancy of a board that is not in `boards` is dropped
 * too, so nothing is listed that the caller did not resolve as a public board. A board's lastModified is its
 * most recent vacancy change (or its own, if later).
 */
export function buildCareersSitemap(
  origin: string,
  boards: readonly SitemapBoard[],
  vacancies: readonly SitemapVacancy[],
  listedSlugs: ReadonlySet<string> = careersSeoOrgSlugs(),
): MetadataRoute.Sitemap {
  const base = origin.replace(/\/+$/, '');
  const listed = boards.filter((board) => isListableCareersSlug(board.slug, listedSlugs));
  const boardById = new Map(listed.map((board) => [board.id, board]));
  const latestChange = new Map(listed.map((board) => [board.id, board.updatedAt]));

  const vacancyEntries: MetadataRoute.Sitemap = [];
  for (const vacancy of vacancies) {
    const board = boardById.get(vacancy.organizationId);
    if (!board) continue;
    vacancyEntries.push({
      url: `${base}${careersBoardPath(board.slug)}/${encodeURIComponent(vacancy.id)}`,
      lastModified: vacancy.updatedAt,
    });
    const latest = latestChange.get(board.id);
    if (!latest || vacancy.updatedAt > latest) latestChange.set(board.id, vacancy.updatedAt);
  }

  const boardEntries: MetadataRoute.Sitemap = listed.map((board) => ({
    url: `${base}${careersBoardPath(board.slug)}`,
    lastModified: latestChange.get(board.id) ?? board.updatedAt,
  }));
  return [...boardEntries, ...vacancyEntries];
}
