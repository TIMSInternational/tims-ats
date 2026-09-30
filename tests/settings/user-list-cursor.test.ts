/**
 * user.list cursor contract (Codex r1 on PR #307).
 *
 * The /settings/users members table is the first `useInfiniteQuery` consumer of `user.list`. The router
 * used to return the popped look-ahead row as `nextCursor` and then apply `skip: 1` to it, so with 51
 * members "load more" returned nothing and member 51 was never shown.
 *
 * `findMany` is faked with Prisma's real cursor semantics — the cursor row is INCLUSIVE, `skip` drops rows
 * from there, and an unresolvable cursor yields [] — over rows already in the router's (createdAt DESC,
 * id DESC) order. Pattern (db + access shims, createCallerFactory) mirrors tests/organization/setup-status.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Member = { id: string; firstName: string; lastName: string; email: string; avatar: null; jobTitle: null };
type FindManyArgs = { take: number; cursor?: { id: string }; skip?: number; orderBy: unknown };

const state = vi.hoisted(() => ({ members: [] as Member[], calls: [] as unknown[] }));

function prismaFindMany(args: FindManyArgs): Member[] {
  state.calls.push(args);
  let start = 0;
  if (args.cursor) {
    const index = state.members.findIndex((member) => member.id === args.cursor!.id);
    if (index < 0) return [];
    start = index;
  }
  start += args.skip ?? 0;
  return state.members.slice(start, start + args.take).map((member) => ({ ...member }));
}

vi.mock('@tims/db', () => ({
  tenantDb: { user: { findMany: (args: FindManyArgs) => Promise.resolve(prismaFindMany(args)) } },
  runTenantTransaction: vi.fn(),
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

const allow = { allowed: true, scope: 'organization', roles: ['super_admin'] };
vi.mock('../../packages/api/src/access/build', () => ({ buildAccessForUser: vi.fn().mockResolvedValue(allow) }));
vi.mock('../../packages/api/src/access/anchors', () => ({ createAnchorLoader: vi.fn().mockReturnValue(null) }));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue(allow),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function member(n: number): Member {
  const hex = n.toString(16).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${hex}`,
    firstName: `M${n}`,
    lastName: 'Test',
    email: `m${n}@example.test`,
    avatar: null,
    jobTitle: null,
  };
}

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { userRouter } = await import('../../packages/api/src/routers/user');
  const ctx = {
    user: {
      id: 'b1ffcd00-0d1c-4f09-cc7e-7cc0ce491b22',
      organizationId: ORG_ID,
      roles: ['super_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'admin@example.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  };
  return createCallerFactory(router({ user: userRouter }))(ctx as never);
}

async function pageThrough(limit: number) {
  const caller = await makeCaller();
  const pages: string[][] = [];
  let cursor: string | undefined;
  do {
    const page = await caller.user.list({ limit, ...(cursor ? { cursor } : {}) });
    pages.push(page.users.map((user) => user.id));
    cursor = page.nextCursor;
  } while (cursor && pages.length < 10);
  return { pages, cursor };
}

beforeEach(() => {
  state.calls = [];
});

describe('user.list cursor pagination', () => {
  it('shows all 51 members across two pages of 50 (the second page is not empty)', async () => {
    state.members = Array.from({ length: 51 }, (_, i) => member(i));
    const { pages, cursor } = await pageThrough(50);
    expect(pages.map((page) => page.length)).toEqual([50, 1]);
    expect(pages[1]).toEqual([state.members[50].id]);
    expect(pages.flat()).toEqual(state.members.map((m) => m.id));
    expect(cursor).toBeUndefined();
  });

  it('returns the last DISPLAYED member as nextCursor, never the look-ahead row', async () => {
    state.members = Array.from({ length: 51 }, (_, i) => member(i));
    const caller = await makeCaller();
    const first = await caller.user.list({ limit: 50 });
    expect(first.users).toHaveLength(50);
    expect(first.nextCursor).toBe(state.members[49].id);
  });

  it('pages an exact multiple with no trailing empty page and no cursor on the last page', async () => {
    state.members = Array.from({ length: 100 }, (_, i) => member(i));
    const { pages, cursor } = await pageThrough(50);
    expect(pages.map((page) => page.length)).toEqual([50, 50]);
    expect(new Set(pages.flat()).size).toBe(100);
    expect(cursor).toBeUndefined();
  });

  it('asks for limit+1 rows with a total (createdAt, id) order and skips the cursor row', async () => {
    state.members = Array.from({ length: 3 }, (_, i) => member(i));
    const caller = await makeCaller();
    await caller.user.list({ limit: 2, cursor: state.members[0].id });
    expect(state.calls[0]).toMatchObject({
      take: 3,
      cursor: { id: state.members[0].id },
      skip: 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { organizationId: ORG_ID },
    });
  });
});
