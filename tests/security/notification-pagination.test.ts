import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initTRPC } from '@trpc/server';

const findMany = vi.fn();
const findFirst = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    notification: {
      findMany: (...args: unknown[]) => findMany(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
    },
  },
  runTenantTransaction: vi.fn(),
}));

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC.context<{ user: { id: string; organizationId: string }; headers: Headers }>().create();
  return { router: t.router, protectedProcedure: t.procedure, permissionProcedure: () => t.procedure };
});

import { notificationRouter } from '../../packages/api/src/routers/notification';

const t = initTRPC.context<{ user: { id: string; organizationId: string }; headers: Headers }>().create();
const createCaller = t.createCallerFactory(notificationRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);
const userId = '11111111-1111-4111-8111-111111111111';
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const row = (number: number) => ({ id: id(number), createdAt: new Date('2026-09-01T00:00:00.000Z') });

interface FindManyArgs {
  where: { userId: string; archived: boolean; read?: boolean };
  take: number;
  cursor?: { id: string };
  skip?: number;
  orderBy: Array<{ createdAt?: 'desc'; id?: 'desc' }>;
}

interface ListCaller {
  list(input: { limit: number; cursor?: string; unreadOnly?: boolean }): Promise<{
    notifications: Array<{ id: string }>;
    nextCursor?: string;
  }>;
}

const caller = () => createCaller({ user: { id: userId, organizationId: id(99) }, headers: new Headers() }) as unknown as ListCaller;

let rows: ReturnType<typeof row>[];
beforeEach(() => {
  vi.clearAllMocks();
  rows = [row(1), row(5), row(3), row(2), row(4)];
  // lib/cursor-page.ts cursorRowMatches: the cursor row must still match the list's own `where`.
  findFirst.mockImplementation(async (args: { where: { AND: Array<{ id?: string }> } }) => {
    const cursorId = args.where.AND.find((clause) => clause.id)?.id;
    return rows.some((item) => item.id === cursorId) ? { id: cursorId } : null;
  });
  findMany.mockImplementation(async (args: FindManyArgs) => {
    const sorted = [...rows].sort((a, b) => {
      const byDate = b.createdAt.getTime() - a.createdAt.getTime();
      return byDate || (args.orderBy.some((part) => part.id === 'desc') ? b.id.localeCompare(a.id) : 0);
    });
    const cursorIndex = args.cursor ? sorted.findIndex((item) => item.id === args.cursor?.id) : -1;
    const start = cursorIndex < 0 ? 0 : cursorIndex + (args.skip ?? 0);
    return sorted.slice(start, start + args.take);
  });
});

describe('notification.list pagination', () => {
  it('returns every row exactly once across page boundaries with tied timestamps', async () => {
    const first = await caller().list({ limit: 2 });
    const second = await caller().list({ limit: 2, cursor: first.nextCursor });
    const third = await caller().list({ limit: 2, cursor: second.nextCursor });

    expect([first, second, third].flatMap((page) => page.notifications.map((item) => item.id)))
      .toEqual([5, 4, 3, 2, 1].map(id));
    expect(first.nextCursor).toBe(id(4));
    expect(second.nextCursor).toBe(id(2));
    expect(third.nextCursor).toBeUndefined();
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { userId, archived: false },
      take: 3,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: id(4) }, skip: 1 });
  });

  it('checks the cursor row against the SAME where before paging', async () => {
    await caller().list({ limit: 2, cursor: id(4), unreadOnly: true });
    expect(findFirst.mock.calls[0][0]).toEqual({
      where: { AND: [{ userId, archived: false, read: false }, { id: id(4) }] },
      select: { id: true },
    });
  });

  it('a cursor row that no longer matches returns an empty page (no skipped row)', async () => {
    findFirst.mockResolvedValueOnce(null);
    const page = await caller().list({ limit: 2, cursor: id(4) });
    expect(page.notifications).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('has no next cursor when the final page has exactly the requested size', async () => {
    rows = rows.filter((item) => item.id !== id(1));

    const first = await caller().list({ limit: 2 });
    const second = await caller().list({ limit: 2, cursor: first.nextCursor });

    expect(second.notifications.map((item) => item.id)).toEqual([id(3), id(2)]);
    expect(second.nextCursor).toBeUndefined();
  });
});
