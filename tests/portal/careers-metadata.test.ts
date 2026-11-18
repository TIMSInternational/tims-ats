import { beforeEach, describe, expect, it, vi } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

const { findFirst, findUnique } = vi.hoisted(() => ({ findFirst: vi.fn(), findUnique: vi.fn() }));
vi.mock('@tims/db', () => ({
  db: { vacancy: { findFirst }, organization: { findUnique } },
}));

import {
  buildBoardMetadata,
  buildVacancyMetadata,
  excerpt,
  loadBoardMetadataSource,
  loadVacancyMetadataSource,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/_lib/careers-metadata';

const ORG = { name: 'Instituto Ejemplo', logo: null };
const VACANCY_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('careers link previews (server metadata)', () => {
  it('titles a vacancy "<vacancy> — <organization>" with Open Graph tags, preferring socialDescription', () => {
    const meta = buildVacancyMetadata({
      title: 'Analista de Datos',
      description: '**Responsabilidades:** muchas cosas',
      socialDescription: 'Únase a nuestro equipo de datos.',
      organization: ORG,
    });
    expect(meta.title).toBe('Analista de Datos — Instituto Ejemplo');
    expect(meta.description).toBe('Únase a nuestro equipo de datos.');
    expect(meta.openGraph).toMatchObject({
      title: 'Analista de Datos — Instituto Ejemplo',
      description: 'Únase a nuestro equipo de datos.',
      siteName: 'Instituto Ejemplo',
    });
    expect(JSON.stringify(meta)).not.toMatch(/TIMS/);
  });

  it('falls back to a plain-text excerpt of the description, then to a generic line', () => {
    const fromDescription = buildVacancyMetadata({
      title: 'Analista',
      description: `## Sobre el puesto\n\n**Responsabilidades:** ${'coordinar despachos '.repeat(20)}`,
      socialDescription: '  ',
      organization: ORG,
    });
    const description = String(fromDescription.description);
    expect(description).not.toContain('**');
    expect(description).not.toContain('##');
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.endsWith('…')).toBe(true);

    const generic = buildVacancyMetadata({
      title: 'Analista',
      description: null,
      socialDescription: null,
      organization: ORG,
    });
    expect(generic.description).toBe(es.portal.metaVacancyDescription.replace('{org}', 'Instituto Ejemplo'));
  });

  it('only previews a logo the CSP would let browsers load', () => {
    const allowed = buildBoardMetadata({ name: 'Instituto Ejemplo', logo: 'https://abc.supabase.co/logo.png' });
    expect(allowed.openGraph).toMatchObject({ images: [{ url: 'https://abc.supabase.co/logo.png' }] });
    const blocked = buildBoardMetadata({ name: 'Instituto Ejemplo', logo: 'http://example.go.cr/logo.png' });
    expect(blocked.openGraph).not.toHaveProperty('images');
  });

  it('titles the board after the organization, and never indexes a missing board or vacancy', () => {
    expect(buildBoardMetadata(ORG).title).toBe(es.portal.metaBoardTitle.replace('{org}', 'Instituto Ejemplo'));
    expect(buildBoardMetadata(null).robots).toEqual({ index: false, follow: false });
    expect(buildVacancyMetadata(null).robots).toEqual({ index: false, follow: false });
  });

  it('cuts an excerpt on a word boundary', () => {
    expect(excerpt('uno dos tres', 160)).toBe('uno dos tres');
    expect(excerpt('palabra '.repeat(40), 30)).toBe('palabra palabra palabra…');
  });
});

describe('careers metadata reads', () => {
  it('reads only a PUBLISHED vacancy of the URL organization, with an explicit select', async () => {
    findFirst.mockResolvedValue({ title: 'Analista', description: null, socialDescription: null, organization: ORG });
    await loadVacancyMetadataSource('acme', VACANCY_ID);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: VACANCY_ID,
        status: 'published',
        deletedAt: null,
        organization: { is: { slug: 'acme', isActive: true } },
      },
      select: {
        title: true,
        description: true,
        socialDescription: true,
        organization: { select: { name: true, logo: true } },
      },
    });
  });

  it('never queries with an id that is not a UUID (a Prisma uuid column would throw a 500)', async () => {
    expect(await loadVacancyMetadataSource('acme', 'not-a-uuid')).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('treats an inactive organization as missing', async () => {
    findUnique.mockResolvedValue({ name: 'Acme', logo: null, isActive: false });
    expect(await loadBoardMetadataSource('acme')).toBeNull();
  });
});
