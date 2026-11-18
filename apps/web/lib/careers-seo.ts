import type { MetadataRoute } from 'next';
import { getAppUrl, isCustomerOrganizationSlug } from '@tims/shared';

// Search-engine surfaces of the public careers portal: the sitemap entries, the robots.txt sitemap line and
// the JobPosting structured data on vacancy pages. One deploy-time switch, off by default:
//
//   CAREERS_SEO_ENABLED=true  → /sitemap.xml lists the boards and vacancies, robots.txt points at it, and a
//                               vacancy page carries schema.org JobPosting data.
//   unset (or anything else)  → /sitemap.xml is empty, robots.txt has no sitemap line, no JobPosting data.
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

/**
 * Organizations whose careers pages may be listed: a slug a customer organization can have. Internal fixture
 * organizations are seeded with slugs outside that rule, so their boards are never advertised. Inactive
 * organizations never reach this check: their careers pages answer 404 (careers/[orgSlug]/layout.tsx) and the
 * loaders only read active ones.
 */
export function isListableCareersSlug(slug: string): boolean {
  return isCustomerOrganizationSlug(slug);
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
 * Sitemap entries for the given boards and their published vacancies, on `origin`. Boards whose slug is not
 * listable are dropped along with their vacancies; a vacancy of a board that is not in `boards` is dropped
 * too, so nothing is listed that the caller did not resolve as a public board. A board's lastModified is its
 * most recent vacancy change (or its own, if later).
 */
export function buildCareersSitemap(
  origin: string,
  boards: readonly SitemapBoard[],
  vacancies: readonly SitemapVacancy[],
): MetadataRoute.Sitemap {
  const base = origin.replace(/\/+$/, '');
  const listed = boards.filter((board) => isListableCareersSlug(board.slug));
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
