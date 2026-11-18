import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { orgFindMany, vacancyFindMany } = vi.hoisted(() => ({ orgFindMany: vi.fn(), vacancyFindMany: vi.fn() }));
vi.mock('@tims/db', () => ({
  db: { organization: { findMany: orgFindMany }, vacancy: { findMany: vacancyFindMany } },
}));

import { createOrganizationSchema, isOrganizationSlugShape } from '@tims/shared';
import {
  buildCareersSitemap,
  careersSeoOrgSlugs,
  careersSiteOrigin,
  isCareersSeoEnabled,
  isListableCareersSlug,
  MAX_CAREERS_SEO_ORGS,
} from '../../apps/web/lib/careers-seo';
import { loadCareersSitemap, MAX_SITEMAP_BOARDS, MAX_SITEMAP_VACANCIES } from '../../apps/web/lib/careers-sitemap';
import sitemap from '../../apps/web/app/sitemap';

const ORIGIN = 'https://ats.example.com';
const T1 = new Date('2026-11-01T00:00:00.000Z');
const T2 = new Date('2026-11-10T00:00:00.000Z');
const T3 = new Date('2026-11-15T00:00:00.000Z');
const ACME_ONLY: ReadonlySet<string> = new Set(['acme']);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('which careers boards may be listed (opt-in per organization)', () => {
  it('lists nothing unless CAREERS_SEO_ORG_SLUGS names the organization', () => {
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', '');
    expect(careersSeoOrgSlugs().size).toBe(0);
    // A well-formed slug is not enough: demo and test organizations have ordinary slugs too.
    for (const slug of ['acme', 'tims-international', 'invu']) expect(isListableCareersSlug(slug)).toBe(false);

    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
    expect(isListableCareersSlug('acme')).toBe(true);
    expect(isListableCareersSlug('tims-international')).toBe(false);
  });

  it('reads a comma-separated list, trimming spaces and ignoring entries that are not organization slugs', () => {
    expect([...careersSeoOrgSlugs(' acme , invu,,acme-2 ')]).toEqual(['acme', 'invu', 'acme-2']);
    expect([...careersSeoOrgSlugs('__parity_a,Acme,a,acme/evil,x b,acme')]).toEqual(['acme']);
    expect(careersSeoOrgSlugs(undefined).size).toBe(0);
  });

  it('is bounded', () => {
    const many = Array.from({ length: MAX_CAREERS_SEO_ORGS + 20 }, (_, i) => `org-${i}`).join(',');
    expect(careersSeoOrgSlugs(many).size).toBe(MAX_CAREERS_SEO_ORGS);
  });

  it('the slug-shape helper and the create schema can never disagree', () => {
    for (const slug of ['ok-1', '__x', '-', 'ab', 'á', 'a b', 'Acme', 'x'.repeat(50), 'x'.repeat(51)]) {
      expect(isOrganizationSlugShape(slug)).toBe(createOrganizationSchema.shape.slug.safeParse(slug).success);
    }
  });
});

describe('sitemap entries', () => {
  const boards = [
    { id: 'org-a', slug: 'acme', updatedAt: T1 },
    { id: 'org-d', slug: 'demo-org', updatedAt: T1 },
  ];

  it('lists each opted-in board and its vacancies on the canonical origin', () => {
    const entries = buildCareersSitemap(
      `${ORIGIN}/`,
      boards,
      [
        { id: 'v-1', organizationId: 'org-a', updatedAt: T2 },
        { id: 'v-2', organizationId: 'org-a', updatedAt: T3 },
      ],
      ACME_ONLY,
    );
    expect(entries).toEqual([
      { url: `${ORIGIN}/careers/acme`, lastModified: T3 },
      { url: `${ORIGIN}/careers/acme/v-1`, lastModified: T2 },
      { url: `${ORIGIN}/careers/acme/v-2`, lastModified: T3 },
    ]);
  });

  it('never lists a board that did not opt in, or a vacancy whose board was not resolved as public', () => {
    const entries = buildCareersSitemap(
      ORIGIN,
      boards,
      [
        { id: 'v-d', organizationId: 'org-d', updatedAt: T2 },
        { id: 'v-x', organizationId: 'org-unknown', updatedAt: T2 },
      ],
      ACME_ONLY,
    );
    expect(entries.map((e) => e.url)).toEqual([`${ORIGIN}/careers/acme`]);
    expect(JSON.stringify(entries)).not.toContain('demo-org');
  });

  it('keeps the board date when it changed after its vacancies', () => {
    const entries = buildCareersSitemap(
      ORIGIN,
      [{ id: 'org-a', slug: 'acme', updatedAt: T3 }],
      [{ id: 'v-1', organizationId: 'org-a', updatedAt: T1 }],
      ACME_ONLY,
    );
    expect(entries[0]).toEqual({ url: `${ORIGIN}/careers/acme`, lastModified: T3 });
  });
});

describe('sitemap reads', () => {
  it('reads only the opted-in ACTIVE organizations with an open vacancy, then their PUBLISHED vacancies, with explicit selects and bounds', async () => {
    orgFindMany.mockResolvedValueOnce([{ id: 'org-a', slug: 'acme', updatedAt: T1 }]);
    vacancyFindMany.mockResolvedValueOnce([{ id: 'v-1', organizationId: 'org-a', updatedAt: T2 }]);

    const entries = await loadCareersSitemap(ORIGIN, new Set(['acme', 'invu']));

    const orgArgs = orgFindMany.mock.calls[0]?.[0];
    expect(orgArgs.where).toEqual({
      slug: { in: ['acme', 'invu'] },
      isActive: true,
      deletedAt: null,
      vacancies: { some: { status: 'published', deletedAt: null } },
    });
    expect(orgArgs.select).toEqual({ id: true, slug: true, updatedAt: true });
    expect(orgArgs.take).toBe(MAX_SITEMAP_BOARDS);

    const vacancyArgs = vacancyFindMany.mock.calls[0]?.[0];
    expect(vacancyArgs.where).toEqual({ status: 'published', deletedAt: null, organizationId: { in: ['org-a'] } });
    expect(vacancyArgs.select).toEqual({ id: true, organizationId: true, updatedAt: true });
    expect(vacancyArgs.take).toBe(MAX_SITEMAP_VACANCIES);
    expect(MAX_SITEMAP_BOARDS + MAX_SITEMAP_VACANCIES).toBeLessThan(50_000);

    expect(entries.map((e) => e.url)).toEqual([`${ORIGIN}/careers/acme`, `${ORIGIN}/careers/acme/v-1`]);
  });

  it('reads nothing when no organization opted in', async () => {
    expect(await loadCareersSitemap(ORIGIN, new Set())).toEqual([]);
    expect(orgFindMany).not.toHaveBeenCalled();
    expect(vacancyFindMany).not.toHaveBeenCalled();
  });

  it('reads no vacancies when no opted-in board is active with an open vacancy', async () => {
    orgFindMany.mockResolvedValueOnce([]);
    expect(await loadCareersSitemap(ORIGIN, ACME_ONLY)).toEqual([]);
    expect(vacancyFindMany).not.toHaveBeenCalled();
  });
});

describe('/sitemap.xml (off by default)', () => {
  it('is empty and touches no data unless CAREERS_SEO_ENABLED is exactly "true"', async () => {
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
    for (const value of ['', 'TRUE', '1', 'yes']) {
      vi.stubEnv('CAREERS_SEO_ENABLED', value);
      expect(isCareersSeoEnabled()).toBe(false);
      expect(await sitemap()).toEqual([]);
    }
    expect(orgFindMany).not.toHaveBeenCalled();
  });

  it('lists the opted-in boards on the configured canonical origin when on', async () => {
    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
    orgFindMany.mockResolvedValueOnce([{ id: 'org-a', slug: 'acme', updatedAt: T1 }]);
    vacancyFindMany.mockResolvedValueOnce([]);
    expect((await sitemap()).map((e) => e.url)).toEqual([`${ORIGIN}/careers/acme`]);
    expect(orgFindMany.mock.calls[0]?.[0].where.slug).toEqual({ in: ['acme'] });
  });

  it('is empty and touches no data when on but no organization opted in', async () => {
    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
    expect(await sitemap()).toEqual([]);
    expect(orgFindMany).not.toHaveBeenCalled();
  });

  it('is empty, not built on a guessed host, when the canonical origin cannot be resolved', async () => {
    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
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
