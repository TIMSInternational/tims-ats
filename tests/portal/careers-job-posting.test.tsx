import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type * as ReactDomServer from '../../apps/web/node_modules/@types/react-dom/server';

// The server renderer from apps/web's copy (the repo root has no react-dom of its own), typed by its
// @types package: a relative import of the runtime module has no declaration file.
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  '../../apps/web/node_modules/react-dom/server',
) as typeof ReactDomServer;

const { findFirst, warn } = vi.hoisted(() => ({ findFirst: vi.fn(), warn: vi.fn() }));
vi.mock('@tims/db', () => ({ db: { vacancy: { findFirst } } }));
vi.mock('@tims/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tims/shared')>();
  return { ...actual, logger: { ...actual.logger, warn } };
});

import {
  buildJobPosting,
  serializeJsonLd,
  type JobPostingSource,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/_lib/job-posting';
import {
  loadJobPosting,
  loadJobPostingSource,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/_lib/job-posting-source';
import { JobPostingJsonLd } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/job-posting-json-ld';

const VACANCY_ID = '11111111-1111-4111-8111-111111111111';

function source(overrides: Partial<JobPostingSource> = {}): JobPostingSource {
  return {
    title: 'Analista de Datos',
    description: '## Sobre el puesto\n\n**Responsabilidades:** analizar datos.',
    socialDescription: null,
    location: 'San José, Costa Rica',
    remotePolicy: 'onsite',
    contractType: 'termino_fijo',
    salary: null,
    createdAt: new Date('2026-11-01T12:00:00.000Z'),
    company: null,
    organization: { name: 'Instituto Ejemplo', logo: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('JobPosting structured data (what the page shows, nothing more)', () => {
  it('describes the vacancy with schema.org JobPosting fields', () => {
    const posting = buildJobPosting(source());
    expect(posting).toEqual({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Analista de Datos',
      description: expect.any(String),
      datePosted: '2026-11-01T12:00:00.000Z',
      hiringOrganization: { '@type': 'Organization', name: 'Instituto Ejemplo' },
      employmentType: 'TEMPORARY',
      jobLocation: {
        '@type': 'Place',
        address: { '@type': 'PostalAddress', addressLocality: 'San José, Costa Rica' },
      },
    });
  });

  it('uses a plain-text description (no markdown), falling back to the social description', () => {
    const description = String(buildJobPosting(source())?.description);
    expect(description).toContain('Responsabilidades');
    expect(description).not.toMatch(/[#*]/);
    expect(buildJobPosting(source({ description: '  ', socialDescription: 'Únase al equipo.' }))?.description).toBe(
      'Únase al equipo.',
    );
  });

  it('emits nothing for a vacancy with no description at all', () => {
    expect(buildJobPosting(source({ description: null, socialDescription: ' ' }))).toBeNull();
  });

  it('names the client company when the vacancy has one, without the organization logo (as the page does)', () => {
    const logo = 'https://example.supabase.co/storage/v1/object/public/logos/acme.png';
    const withCompany = buildJobPosting(
      source({ company: { name: 'Cliente S.A.' }, organization: { name: 'Instituto Ejemplo', logo } }),
    );
    expect(withCompany?.hiringOrganization).toEqual({ '@type': 'Organization', name: 'Cliente S.A.' });
  });

  it('includes the organization logo only when the page could show it (CSP-allowed image)', () => {
    const allowed = buildJobPosting(
      source({
        organization: { name: 'Instituto Ejemplo', logo: 'https://abc.supabase.co/storage/v1/object/public/l.png' },
      }),
    );
    expect(allowed?.hiringOrganization).toMatchObject({
      logo: 'https://abc.supabase.co/storage/v1/object/public/l.png',
    });
    const blocked = buildJobPosting(
      source({ organization: { name: 'Instituto Ejemplo', logo: 'https://evil.example/logo.png' } }),
    );
    expect(blocked?.hiringOrganization).toEqual({ '@type': 'Organization', name: 'Instituto Ejemplo' });
  });

  it('adds baseSalary only when the page shows a salary with a currency', () => {
    expect(buildJobPosting(source())?.baseSalary).toBeUndefined();
    expect(buildJobPosting(source({ salary: { min: 900000, max: 1200000 } }))?.baseSalary).toBeUndefined();
    expect(
      buildJobPosting(source({ salary: { min: 900000, max: 1200000, currency: 'crc', period: 'monthly' } }))
        ?.baseSalary,
    ).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'CRC',
      value: { '@type': 'QuantitativeValue', minValue: 900000, maxValue: 1200000, unitText: 'MONTH' },
    });
    // "Desde X" is a minimum, not an exact amount; an unknown period gets no unit.
    expect(buildJobPosting(source({ salary: { min: 50000, currency: 'USD', period: 'weekly' } }))?.baseSalary).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: { '@type': 'QuantitativeValue', minValue: 50000 },
    });
    expect(
      buildJobPosting(source({ salary: { min: 1000, max: 1000, currency: 'USD', period: 'yearly' } }))?.baseSalary,
    ).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: { '@type': 'QuantitativeValue', value: 1000, unitText: 'YEAR' },
    });
  });

  it('maps contract types without guessing full/part time, and marks fully remote work', () => {
    expect(buildJobPosting(source({ contractType: 'indefinido' }))?.employmentType).toBeUndefined();
    expect(buildJobPosting(source({ contractType: 'practicas' }))?.employmentType).toBe('INTERN');
    expect(buildJobPosting(source({ contractType: 'prestacion' }))?.employmentType).toBe('CONTRACTOR');
    expect(buildJobPosting(source({ contractType: 'constructor' }))?.employmentType).toBeUndefined();
    expect(buildJobPosting(source({ contractType: '__proto__' }))?.employmentType).toBeUndefined();
    expect(buildJobPosting(source({ remotePolicy: 'remote' }))?.jobLocationType).toBe('TELECOMMUTE');
    expect(buildJobPosting(source({ remotePolicy: 'hybrid' }))?.jobLocationType).toBeUndefined();
    expect(buildJobPosting(source({ location: '  ' }))?.jobLocation).toBeUndefined();
  });
});

describe('JobPosting serialization (no script breakout)', () => {
  const hostile = source({
    title: '</script><script>alert(1)</script>',
    description: 'A & B <img src=x onerror=alert(1)> \u2028 end',
  });

  it('escapes < > & and line separators, and still parses back to the same value', () => {
    const posting = buildJobPosting(hostile);
    expect(posting).not.toBeNull();
    const json = serializeJsonLd(posting!);
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(json).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(json)).toEqual(posting);
  });

  it('renders as a JSON-LD data block whose body is the escaped JSON, verbatim', () => {
    const posting = buildJobPosting(hostile)!;
    const html = renderToStaticMarkup(<JobPostingJsonLd posting={posting} />);
    const match = /^<script type="application\/ld\+json">([\s\S]*)<\/script>$/.exec(html);
    expect(match).not.toBeNull();
    const body = match?.[1] ?? '';
    expect(body).not.toContain('<');
    expect(body).not.toContain('&quot;');
    expect(JSON.parse(body)).toEqual(posting);
  });

  it('the component file never sets inner HTML (the banned prop is not even mentioned)', () => {
    const src = readFileSync(
      resolve(
        __dirname,
        '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/job-posting-json-ld.tsx',
      ),
      'utf8',
    );
    expect(src).not.toMatch(/dangerously|innerHTML/);
  });
});

describe('JobPosting read (same visibility as the page and the sitemap)', () => {
  it('reads only a PUBLISHED vacancy of an ACTIVE, opted-in organization, with an explicit select', async () => {
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
    findFirst.mockResolvedValueOnce(null);
    await loadJobPostingSource('acme', VACANCY_ID);
    const args = findFirst.mock.calls[0]?.[0];
    expect(args.where).toEqual({
      id: VACANCY_ID,
      status: 'published',
      deletedAt: null,
      organization: { is: { slug: 'acme', isActive: true, deletedAt: null } },
    });
    expect(Object.keys(args.select).sort()).toEqual(
      [
        'company',
        'contractType',
        'createdAt',
        'description',
        'location',
        'organization',
        'remotePolicy',
        'salary',
        'socialDescription',
        'title',
      ].sort(),
    );
    expect(args.select.company).toEqual({ select: { name: true } });
    expect(args.select.organization).toEqual({ select: { name: true, logo: true } });
  });

  it('never queries for a non-UUID id or an organization that did not opt in', async () => {
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme,__parity_a');
    expect(await loadJobPostingSource('acme', 'not-a-uuid')).toBeNull();
    // Not a valid organization slug, so the opt-in list ignores it even when named.
    expect(await loadJobPostingSource('__parity_a', VACANCY_ID)).toBeNull();
    expect(await loadJobPostingSource('Acme', VACANCY_ID)).toBeNull();
    // A well-formed slug that is not in the list (a demo organization, say).
    expect(await loadJobPostingSource('tims-international', VACANCY_ID)).toBeNull();
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', '');
    expect(await loadJobPostingSource('acme', VACANCY_ID)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('is off unless CAREERS_SEO_ENABLED is exactly "true"', async () => {
    findFirst.mockResolvedValue(source());
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
    vi.stubEnv('CAREERS_SEO_ENABLED', '');
    expect(await loadJobPosting('acme', VACANCY_ID)).toBeNull();
    vi.stubEnv('CAREERS_SEO_ENABLED', 'TRUE');
    expect(await loadJobPosting('acme', VACANCY_ID)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();

    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    expect(await loadJobPosting('acme', VACANCY_ID)).toMatchObject({ '@type': 'JobPosting' });
  });

  it('is off for an organization that did not opt in, even with the switch on', async () => {
    findFirst.mockResolvedValue(source());
    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'invu');
    expect(await loadJobPosting('acme', VACANCY_ID)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('a failed read yields no structured data instead of breaking the vacancy page', async () => {
    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
    findFirst.mockRejectedValueOnce(new Error('connection reset'));
    await expect(loadJobPosting('acme', VACANCY_ID)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
