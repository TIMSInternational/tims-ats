import { beforeEach, describe, expect, it, vi } from 'vitest';

const VACANCY_ID = '11111111-1111-1111-1111-111111111111';

const findFirst = vi.fn();
const count = vi.fn();

vi.mock('@tims/db', () => ({
  db: {
    vacancy: { findFirst },
    application: { count },
  },
}));

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { portalRouter } = await import('../../packages/api/src/routers/portal');
  return createCallerFactory(router({ portal: portalRouter }))({
    user: null,
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('portal.getVacancy organization scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries a published vacancy only within the careers URL organization', async () => {
    findFirst.mockResolvedValue({ id: VACANCY_ID, organizationId: 'tims-org', organization: { name: 'TIMS' } });
    count.mockResolvedValue(3);

    const caller = await makeCaller();
    const vacancy = await caller.portal.getVacancy({ id: VACANCY_ID, orgSlug: 'tims-international' });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: VACANCY_ID,
          status: 'published',
          deletedAt: null,
          organization: { is: { slug: 'tims-international' } },
        },
      }),
    );
    expect(vacancy?.applicantCount).toBe(3);
  });

  it('returns no vacancy and never counts applicants when the URL organization does not match', async () => {
    findFirst.mockResolvedValue(null);

    const caller = await makeCaller();
    const vacancy = await caller.portal.getVacancy({ id: VACANCY_ID, orgSlug: 'another-company' });

    expect(vacancy).toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  it('returns only the public careers-page fields — never settings or other internal columns', async () => {
    // Even if the row (or a future select) carries internal data, the response is built field by field.
    findFirst.mockResolvedValue({
      id: VACANCY_ID,
      organizationId: 'tims-org',
      title: 'Analista',
      description: 'Descripcion',
      location: 'Bogota',
      remotePolicy: 'hybrid',
      contractType: 'full_time',
      salary: { min: 1, max: 2, currency: 'COP', period: 'monthly' },
      positions: 2,
      priority: 'urgent',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      settings: { requireApproval: true, internalNote: 'do-not-leak' },
      hiringManagerId: 'hm-1',
      company: { id: 'company-1', name: 'Acme' },
      unit: { name: 'Data' },
      organization: { name: 'TIMS', logo: 'logo.png' },
      jobProfile: { competencies: ['SQL'], requirements: ['Excel'], salaryBand: 'secret' },
    });
    count.mockResolvedValue(4);

    const caller = await makeCaller();
    const vacancy = await caller.portal.getVacancy({ id: VACANCY_ID, orgSlug: 'tims-international' });

    expect(vacancy).toEqual({
      id: VACANCY_ID,
      organizationId: 'tims-org',
      title: 'Analista',
      description: 'Descripcion',
      location: 'Bogota',
      remotePolicy: 'hybrid',
      contractType: 'full_time',
      salary: { min: 1, max: 2, currency: 'COP', period: 'monthly' },
      positions: 2,
      priority: 'urgent',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      company: { name: 'Acme' },
      unit: { name: 'Data' },
      organization: { name: 'TIMS' },
      jobProfile: { competencies: ['SQL'], requirements: ['Excel'] },
      applicantCount: 4,
    });
    expect(JSON.stringify(vacancy)).not.toContain('do-not-leak');
    // The query itself no longer asks for settings.
    const select = (findFirst.mock.calls[0]?.[0] as { select: Record<string, unknown> }).select;
    expect(select).not.toHaveProperty('settings');
  });
});
