import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { orgFindMany, vacancyFindMany } = vi.hoisted(() => ({ orgFindMany: vi.fn(), vacancyFindMany: vi.fn() }));
vi.mock('@tims/db', () => ({
  db: { organization: { findMany: orgFindMany }, vacancy: { findMany: vacancyFindMany } },
}));

import { createOrganizationSchema, isCustomerOrganizationSlug } from '@tims/shared';
import {
  buildCareersSitemap,
  careersSiteOrigin,
  isCareersSeoEnabled,
  isListableCareersSlug,
} from '../../apps/web/lib/careers-seo';
import { loadCareersSitemap, MAX_SITEMAP_BOARDS, MAX_SITEMAP_VACANCIES } from '../../apps/web/lib/careers-sitemap';
import sitemap from '../../apps/web/app/sitemap';

const ORIGIN = 'https://ats.example.com';
const T1 = new Date('2026-11-01T00:00:00.000Z');
const T2 = new Date('2026-11-10T00:00:00.000Z');
const T3 = new Date('2026-11-15T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('which careers boards may be listed', () => {
  it('accepts exactly the slugs a customer organization can be created with', () => {
    for (const slug of ['invu', 'tims-international', 'acme-2']) {
      expect(isListableCareersSlug(slug)).toBe(true);
      expect(createOrganizationSchema.shape.slug.safeParse(slug).success).toBe(true);
    }
    // Internal fixture organizations are seeded outside the creatable rule (scripts/parity/seed.ts ORG_SLUGS).
    for (const slug of ['__parity_a', '__parity_b', '__parity_create', 'Acme', 'a', 'x'.repeat(51), 'acme/evil']) {
      expect(isListableCareersSlug(slug)).toBe(false);
      expect(createOrganizationSchema.shape.slug.safeParse(slug).success).toBe(false);
    }
  });

  it('the shared helper and the create schema can never disagree', () => {
    for (const slug of ['ok-1', '__x', '-', 'ab', 'á', 'a b', 'x'.repeat(50), 'x'.repeat(51)]) {
      expect(isCustomerOrganizationSlug(slug)).toBe(createOrganizationSchema.shape.slug.safeParse(slug).success);
    }
  });
});

describe('sitemap entries', () => {
  const boards = [
    { id: 'org-a', slug: 'acme', updatedAt: T1 },
    { id: 'org-p', slug: '__parity_a', updatedAt: T1 },
  ];

  it('lists each board and its vacancies on the canonical origin', () => {
    const entries = buildCareersSitemap(`${ORIGIN}/`, boards, [
      { id: 'v-1', organizationId: 'org-a', updatedAt: T2 },
      { id: 'v-2', organizationId: 'org-a', updatedAt: T3 },
    ]);
    expect(entries).toEqual([
      { url: `${ORIGIN}/careers/acme`, lastModified: T3 },
      { url: `${ORIGIN}/careers/acme/v-1`, lastModified: T2 },
      { url: `${ORIGIN}/careers/acme/v-2`, lastModified: T3 },
    ]);
  });

  it('never lists an internal board, or a vacancy whose board was not resolved as public', () => {
    const entries = buildCareersSitemap(ORIGIN, boards, [
      { id: 'v-p', organizationId: 'org-p', updatedAt: T2 },
      { id: 'v-x', organizationId: 'org-unknown', updatedAt: T2 },
    ]);
    expect(entries.map((e) => e.url)).toEqual([`${ORIGIN}/careers/acme`]);
    expect(JSON.stringify(entries)).not.toContain('parity');
  });

  it('keeps the board date when it changed after its vacancies', () => {
    const entries = buildCareersSitemap(
      ORIGIN,
      [{ id: 'org-a', slug: 'acme', updatedAt: T3 }],
      [{ id: 'v-1', organizationId: 'org-a', updatedAt: T1 }],
    );
    expect(entries[0]).toEqual({ url: `${ORIGIN}/careers/acme`, lastModified: T3 });
  });
});

describe('sitemap reads', () => {
  it('reads ACTIVE organizations with an open vacancy and their PUBLISHED vacancies, with explicit selects and bounds', async () => {
    orgFindMany.mockResolvedValueOnce([
      { id: 'org-a', slug: 'acme', updatedAt: T1 },
      { id: 'org-p', slug: '__parity_a', updatedAt: T1 },
    ]);
    vacancyFindMany.mockResolvedValueOnce([{ id: 'v-1', organizationId: 'org-a', updatedAt: T2 }]);

    const entries = await loadCareersSitemap(ORIGIN);

    const orgArgs = orgFindMany.mock.calls[0]?.[0];
    expect(orgArgs.where).toEqual({
      isActive: true,
      deletedAt: null,
      vacancies: { some: { status: 'published', deletedAt: null } },
    });
    expect(orgArgs.select).toEqual({ id: true, slug: true, updatedAt: true });
    expect(orgArgs.take).toBe(MAX_SITEMAP_BOARDS);

    const vacancyArgs = vacancyFindMany.mock.calls[0]?.[0];
    // The internal board is filtered out BEFORE its vacancies are read.
    expect(vacancyArgs.where).toEqual({ status: 'published', deletedAt: null, organizationId: { in: ['org-a'] } });
    expect(vacancyArgs.select).toEqual({ id: true, organizationId: true, updatedAt: true });
    expect(vacancyArgs.take).toBe(MAX_SITEMAP_VACANCIES);
    expect(MAX_SITEMAP_BOARDS + MAX_SITEMAP_VACANCIES).toBeLessThan(50_000);

    expect(entries.map((e) => e.url)).toEqual([`${ORIGIN}/careers/acme`, `${ORIGIN}/careers/acme/v-1`]);
  });

  it('reads no vacancies when no board is listable', async () => {
    orgFindMany.mockResolvedValueOnce([{ id: 'org-p', slug: '__parity_b', updatedAt: T1 }]);
    expect(await loadCareersSitemap(ORIGIN)).toEqual([]);
    expect(vacancyFindMany).not.toHaveBeenCalled();
  });
});

describe('/sitemap.xml (off by default)', () => {
  it('is empty and touches no data unless CAREERS_SEO_ENABLED is exactly "true"', async () => {
    for (const value of ['', 'TRUE', '1', 'yes']) {
      vi.stubEnv('CAREERS_SEO_ENABLED', value);
      expect(isCareersSeoEnabled()).toBe(false);
      expect(await sitemap()).toEqual([]);
    }
    expect(orgFindMany).not.toHaveBeenCalled();
  });

  it('lists the boards on the configured canonical origin when on', async () => {
    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
    orgFindMany.mockResolvedValueOnce([{ id: 'org-a', slug: 'acme', updatedAt: T1 }]);
    vacancyFindMany.mockResolvedValueOnce([]);
    expect((await sitemap()).map((e) => e.url)).toEqual([`${ORIGIN}/careers/acme`]);
  });

  it('is empty, not built on a guessed host, when the canonical origin cannot be resolved', async () => {
    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'not a url');
    expect(await sitemap()).toEqual([]);
    expect(orgFindMany).not.toHaveBeenCalled();
    expect(
      careersSiteOrigin(() => {
        throw new Error('missing');
      }),
    ).toBeNull();
    expect(careersSiteOrigin(() => `${ORIGIN}/`)).toBe(ORIGIN);
  });
});
