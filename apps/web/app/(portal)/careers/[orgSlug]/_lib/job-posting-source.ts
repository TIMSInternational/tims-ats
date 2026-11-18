import 'server-only';
import { db } from '@tims/db';
import { logger } from '@tims/shared';
import { isCareersSeoEnabled, isListableCareersSlug } from '../../../../../lib/careers-seo';
import { buildJobPosting, type JobPostingSource, type JsonLdObject } from './job-posting';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A PUBLISHED vacancy of an ACTIVE organization with a listable slug: the same visibility rule as the page
 * (portal.getVacancy + careers/[orgSlug]/layout.tsx) and the sitemap. Explicit select of what the builder reads.
 */
export async function loadJobPostingSource(orgSlug: string, vacancyId: string): Promise<JobPostingSource | null> {
  if (!UUID_RE.test(vacancyId) || !isListableCareersSlug(orgSlug)) return null;
  return db.vacancy.findFirst({
    where: {
      id: vacancyId,
      status: 'published',
      deletedAt: null,
      organization: { is: { slug: orgSlug, isActive: true, deletedAt: null } },
    },
    select: {
      title: true,
      description: true,
      socialDescription: true,
      location: true,
      remotePolicy: true,
      contractType: true,
      salary: true,
      createdAt: true,
      company: { select: { name: true } },
      organization: { select: { name: true, logo: true } },
    },
  });
}

/**
 * The JobPosting for a vacancy page, or null when the careers SEO surfaces are off, the vacancy is not public,
 * or the read fails. Structured data is optional: a failed read must never take the vacancy page (and its
 * apply button) down with it.
 */
export async function loadJobPosting(orgSlug: string, vacancyId: string): Promise<JsonLdObject | null> {
  if (!isCareersSeoEnabled()) return null;
  try {
    const source = await loadJobPostingSource(orgSlug, vacancyId);
    return source ? buildJobPosting(source) : null;
  } catch (err) {
    logger.warn({ err }, 'careers: job posting structured data read failed');
    return null;
  }
}
