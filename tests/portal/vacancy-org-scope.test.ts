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
    findFirst.mockResolvedValue({ id: VACANCY_ID, organizationId: 'tims-org' });
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
});
