import { beforeEach, describe, expect, it, vi } from 'vitest';

// vacancy.list orders by createdAt by default. The dashboard funnel asks for orderBy: 'closed' so a
// vacancy filled today (an old row, closed just now) is first among closed vacancies, not cut off by
// newer-created ones.

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const m = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));

vi.mock('@tims/db', () => ({
  tenantDb: { vacancy: { findMany: m.findMany, findFirst: m.findFirst } },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runTenantTransaction: vi.fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertScoped: vi.fn().mockResolvedValue(undefined),
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyCrudRouter } = await import('../../packages/api/src/routers/vacancy/crud');
  return createCallerFactory(router({ vacancy: vacancyCrudRouter }))({
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@acme.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

beforeEach(() => {
  m.findMany.mockReset().mockResolvedValue([]);
  m.findFirst.mockReset().mockResolvedValue(null);
});

describe('vacancy.list ordering', () => {
  it('defaults to newest created first', async () => {
    await (await caller()).vacancy.list({ limit: 10 });
    expect(m.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    );
  });

  it("orders by most recently closed with orderBy: 'closed'", async () => {
    await (await caller()).vacancy.list({ limit: 10, status: 'closed', orderBy: 'closed' });
    expect(m.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ closedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }] }),
    );
  });
});
