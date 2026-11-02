import { beforeEach, describe, expect, it, vi } from 'vitest';

// Publishing re-checks the vacancy status INSIDE its transaction, conditionally, before creating the
// channel: a hire that closed the vacancy after the pre-read (closure holds the row lock until commit) makes
// the write match 0 rows, so a fully staffed vacancy is never reopened and no channel is created.

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const VAC_ID = '22222222-2222-4222-8222-222222222222';
const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  txVacancyUpdateMany: vi.fn(),
  txChannelCreate: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: { vacancy: { findFirst: m.findFirst } },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runTenantTransaction: async (_org: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ vacancy: { updateMany: m.txVacancyUpdateMany }, publicationChannel: { create: m.txChannelCreate } }),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertScoped: vi.fn().mockResolvedValue(undefined),
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyChannelsRouter } = await import('../../packages/api/src/routers/vacancy/channels');
  return createCallerFactory(router({ vacancy: vacancyChannelsRouter }))({
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

const input = { vacancyId: VAC_ID, channelName: 'Portal', channelType: 'internal' as const };

beforeEach(() => {
  vi.clearAllMocks();
  m.findFirst.mockResolvedValue({ id: VAC_ID, status: 'approved' });
  m.txChannelCreate.mockResolvedValue({ id: 'ch1' });
});

describe('vacancy.publish', () => {
  it('writes the status conditionally first, then creates the channel', async () => {
    m.txVacancyUpdateMany.mockResolvedValue({ count: 1 });
    await (await caller()).vacancy.publish(input);
    expect(m.txVacancyUpdateMany).toHaveBeenCalledWith({
      where: { id: VAC_ID, organizationId: ORG_ID, status: { in: ['approved', 'published'] }, deletedAt: null },
      data: { status: 'published' },
    });
    expect(m.txVacancyUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      m.txChannelCreate.mock.invocationCallOrder[0]!,
    );
  });

  it('refuses (no channel) when the vacancy was closed after the pre-read', async () => {
    m.txVacancyUpdateMany.mockResolvedValue({ count: 0 });
    await expect((await caller()).vacancy.publish(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(m.txChannelCreate).not.toHaveBeenCalled();
  });
});
