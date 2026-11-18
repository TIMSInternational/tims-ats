import 'server-only';
import type { MetadataRoute } from 'next';
import { db } from '@tims/db';
import { buildCareersSitemap, isListableCareersSlug } from './careers-seo';

// Reads behind /sitemap.xml (app/sitemap.ts). The same visibility rules as the careers pages themselves: an
// ACTIVE organization (careers/[orgSlug]/layout.tsx answers 404 otherwise) and PUBLISHED, non-deleted
// vacancies (portal.getVacancy). Only boards with at least one open vacancy are listed.

/** Bounds keep one sitemap file well under the 50,000-URL protocol limit. */
export const MAX_SITEMAP_BOARDS = 1_000;
export const MAX_SITEMAP_VACANCIES = 10_000;

const PUBLISHED_VACANCY = { status: 'published', deletedAt: null } as const;

export async function loadCareersSitemap(origin: string): Promise<MetadataRoute.Sitemap> {
  const boards = await db.organization.findMany({
    where: { isActive: true, deletedAt: null, vacancies: { some: PUBLISHED_VACANCY } },
    select: { id: true, slug: true, updatedAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_SITEMAP_BOARDS,
  });
  const listed = boards.filter((board) => isListableCareersSlug(board.slug));
  if (listed.length === 0) return [];

  const vacancies = await db.vacancy.findMany({
    where: { ...PUBLISHED_VACANCY, organizationId: { in: listed.map((board) => board.id) } },
    select: { id: true, organizationId: true, updatedAt: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: MAX_SITEMAP_VACANCIES,
  });
  return buildCareersSitemap(origin, listed, vacancies);
}
