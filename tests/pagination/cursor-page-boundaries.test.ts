/**
 * Cursor pagination at page boundaries (#318, #246) — every `take: limit + 1` list endpoint.
 *
 * The defect: endpoints popped the look-ahead row (row limit+1) and returned ITS id as `nextCursor`; the next
 * page then applied `cursor: { id }, skip: 1`, which starts AFTER that row, so it was shown on neither page.
 * Second defect: a single non-unique `orderBy` column, which Prisma's positional cursor cannot page over
 * deterministically — rows sharing a timestamp could repeat or vanish.
 *
 * `findMany` is faked with Prisma's cursor semantics (modelled on tests/settings/user-list-cursor.test.ts):
 * the rows are sorted by the call's `orderBy` (Postgres NULL placement: NULLS LAST for ASC, NULLS FIRST for
 * DESC); the cursor row is INCLUSIVE; `skip` drops rows from there; an unresolvable cursor yields []. Ties the
 * `orderBy` leaves unresolved are broken by a hash that CHANGES ON EVERY CALL — modelling a database that owes
 * no stable order to rows it considers equal — so an endpoint without an `id` tie-break loses or repeats rows
 * here exactly as it can in production.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };
type Direction = 'asc' | 'desc';
type OrderBy = Record<string, Direction> | Array<Record<string, Direction>>;
type FindManyArgs = { take: number; cursor?: { id: string }; skip?: number; orderBy: OrderBy };

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown> & { id: string }>,
  calls: [] as unknown[],
  callNo: 0,
  /** Rows that still exist but no longer match the endpoint's `where` (archived, status changed, …). */
  stale: new Set<string>(),
}));

function tieHash(id: string, salt: number): number {
  let h = salt * 2654435761;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

function compareKey(a: unknown, b: unknown, dir: Direction): number {
  if (a === b) return 0;
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  // Postgres: NULL sorts as larger than any value → last for ASC, first for DESC.
  if (aNull || bNull) return (aNull ? 1 : -1) * (dir === 'asc' ? 1 : -1);
  const av = a instanceof Date ? a.getTime() : (a as string);
  const bv = b instanceof Date ? b.getTime() : (b as string);
  if (av === bv) return 0;
  return (av < bv ? -1 : 1) * (dir === 'asc' ? 1 : -1);
}

function prismaFindMany(args: FindManyArgs): Row[] {
  state.calls.push(args);
  const salt = ++state.callNo;
  const orderBy = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
  const sorted = [...state.rows].sort((a, b) => {
    for (const clause of orderBy) {
      const [field, dir] = Object.entries(clause)[0]!;
      const c = compareKey(a[field], b[field], dir);
      if (c !== 0) return c;
    }
    return tieHash(a.id, salt) - tieHash(b.id, salt);
  });
  // Prisma positions on the cursor row even when the `where` excludes it, then filters, then applies `skip`:
  // an excluded cursor therefore makes `skip: 1` drop a genuine row.
  let from = 0;
  if (args.cursor) {
    const index = sorted.findIndex((row) => row.id === args.cursor!.id);
    if (index < 0) return [];
    from = index;
  }
  const visible = sorted.slice(from).filter((row) => !state.stale.has(row.id));
  const start = args.skip ?? 0;
  return visible.slice(start, start + args.take).map((row) => ({ ...row }));
}

vi.mock('@tims/db', () => {
  const model = () => ({
    findMany: (args: FindManyArgs) => Promise.resolve(prismaFindMany(args)),
    count: () => Promise.resolve(state.rows.length),
    // The audit repository checks the cursor row is visible under its filters before paging.
    findFirst: (args: { where: { AND: Array<{ id?: string }> } }) => {
      const id = args.where.AND.find((clause) => clause.id)?.id;
      const match = id !== undefined && !state.stale.has(id) && state.rows.some((row) => row.id === id);
      return Promise.resolve(match ? { id } : null);
    },
  });
  const client = new Proxy({} as Record<string, unknown>, {
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop.startsWith('$')) return vi.fn();
      target[prop] ??= model();
      return target[prop];
    },
  });
  return {
    db: client,
    tenantDb: client,
    runTenantTransaction: vi.fn(),
    runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
    Prisma: {},
    InvoiceStatus: { pending: 'pending' },
  };
});

const allow = { allowed: true, scope: 'organization', roles: ['super_admin'] };
vi.mock('../../packages/api/src/access/build', () => ({ buildAccessForUser: vi.fn().mockResolvedValue(allow) }));
vi.mock('../../packages/api/src/access/anchors', () => ({ createAnchorLoader: vi.fn().mockReturnValue(null) }));
vi.mock('../../packages/api/src/access', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildAccessForUser: vi.fn().mockResolvedValue(allow),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  selectFor: vi.fn().mockReturnValue({ id: true }),
  logDataAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/api/src/middleware/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const OTHER_ID = 'c2ffde11-1e2d-4f1a-8d8f-8dd1df5a2c33';

type Page = { ids: string[]; nextCursor: string | undefined };
type Caller = Record<string, Record<string, (input: Record<string, unknown>) => Promise<Record<string, unknown>>>>;

interface EndpointCase {
  name: string;
  /** Sort column the endpoint pages over, and its direction. */
  sortBy: string;
  dir: Direction;
  /** `limit` or `take`. */
  sizeKey: 'limit' | 'take';
  /** Extra required input. */
  input?: Record<string, unknown>;
  /** Response key holding the page rows. */
  itemsKey: string;
  call: (caller: Caller, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const ENDPOINTS: EndpointCase[] = [
  {
    name: 'assessment.getResults',
    sortBy: 'completedAt',
    dir: 'desc',
    sizeKey: 'limit',
    input: { vacancyId: OTHER_ID },
    itemsKey: 'items',
    call: (c, i) => c.assessment!.getResults!(i),
  },
  {
    name: 'assessment.listPending',
    sortBy: 'assignedAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'items',
    call: (c, i) => c.assessment!.listPending!(i),
  },
  {
    name: 'onboarding.list',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'plans',
    call: (c, i) => c.onboarding!.list!(i),
  },
  {
    name: 'performance.listCoachingSessions',
    sortBy: 'scheduledAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'sessions',
    call: (c, i) => c.coaching!.listCoachingSessions!(i),
  },
  {
    name: 'performance.listCommitments',
    sortBy: 'dueDate',
    dir: 'asc',
    sizeKey: 'limit',
    itemsKey: 'commitments',
    call: (c, i) => c.coaching!.listCommitments!(i),
  },
  {
    name: 'performance.myCommitments',
    sortBy: 'dueDate',
    dir: 'asc',
    sizeKey: 'limit',
    itemsKey: 'commitments',
    call: (c, i) => c.coaching!.myCommitments!(i),
  },
  {
    name: 'performance.listFeedback',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'feedbacks',
    call: (c, i) => c.feedback!.listFeedback!(i),
  },
  {
    name: 'performance.listRecognitions',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'recognitions',
    call: (c, i) => c.feedback!.listRecognitions!(i),
  },
  {
    name: 'performance.myRecognitions',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'recognitions',
    call: (c, i) => c.feedback!.myRecognitions!(i),
  },
  {
    name: 'performance.listOkrs',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'okrs',
    call: (c, i) => c.okrs!.listOkrs!(i),
  },
  {
    name: 'vacancy.list',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'items',
    call: (c, i) => c.vacancy!.list!(i),
  },
  {
    name: 'candidate.list',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'items',
    call: (c, i) => c.candidate!.list!(i),
  },
  {
    name: 'notification.list',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'limit',
    itemsKey: 'notifications',
    call: (c, i) => c.notification!.list!(i),
  },
  {
    name: 'integration.getSyncHistory',
    sortBy: 'startedAt',
    dir: 'desc',
    sizeKey: 'take',
    input: { connectorId: OTHER_ID },
    itemsKey: 'items',
    call: (c, i) => c.integration!.getSyncHistory!(i),
  },
  {
    name: 'integration.getErrorLog',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'take',
    itemsKey: 'items',
    call: (c, i) => c.integration!.getErrorLog!(i),
  },
  {
    name: 'portal.listVacancies',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'take',
    input: { organizationId: ORG_ID },
    itemsKey: 'items',
    call: (c, i) => c.portal!.listVacancies!(i),
  },
  {
    name: 'audit.listLogs',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'take',
    itemsKey: 'items',
    call: (c, i) => c.audit!.listLogs!(i),
  },
  {
    name: 'audit.getChangesByEntity',
    sortBy: 'createdAt',
    dir: 'desc',
    sizeKey: 'take',
    input: { entity: 'vacancy', entityId: OTHER_ID },
    itemsKey: 'items',
    call: (c, i) => c.audit!.getChangesByEntity!(i),
  },
];

// Only `AssessmentAssignment.completedAt` is nullable among the paged sort keys (`Commitment.dueDate` is NOT NULL).
const NULLABLE_SORT = new Set(['completedAt']);

/**
 * N rows whose sort key repeats in runs of three (ties straddle every page boundary for limit 2 and 3), with
 * ids deliberately NOT in sort order. Nullable sort columns get one NULL key too.
 */
function makeRows(n: number, sortBy: string): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const hex = ((i * 7919) % 4096).toString(16).padStart(12, '0');
    const key = NULLABLE_SORT.has(sortBy) && i === 1 ? null : new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 3)));
    return {
      id: `00000000-0000-4000-8000-${hex}`,
      [sortBy]: key,
      createdAt: sortBy === 'createdAt' ? key : new Date(Date.UTC(2026, 0, 1)),
      isAnonymous: false,
      fromUser: null,
      fromUserId: null,
      result: null,
    };
  });
}

/** The total order the endpoint must page through: (sort key, id), both in the endpoint's direction. */
function expectedOrder(rows: Row[], sortBy: string, dir: Direction): string[] {
  return [...rows]
    .sort((a, b) => compareKey(a[sortBy], b[sortBy], dir) || compareKey(a.id, b.id, dir))
    .map((row) => row.id);
}

async function makeCaller(): Promise<Caller> {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { assessmentRouter } = await import('../../packages/api/src/routers/assessment');
  const { onboardingRouter } = await import('../../packages/api/src/routers/onboarding');
  const { performanceCoachingRouter } = await import('../../packages/api/src/routers/performance/coaching');
  const { performanceFeedbackRouter } = await import('../../packages/api/src/routers/performance/feedback');
  const { performanceOkrsRouter } = await import('../../packages/api/src/routers/performance/okrs');
  const { vacancyCrudRouter } = await import('../../packages/api/src/routers/vacancy/crud');
  const { candidateCrudRouter } = await import('../../packages/api/src/routers/candidate/crud');
  const { notificationRouter } = await import('../../packages/api/src/routers/notification');
  const { integrationRouter } = await import('../../packages/api/src/routers/integration');
  const { portalRouter } = await import('../../packages/api/src/routers/portal');
  const { auditRouter } = await import('../../packages/api/src/routers/audit');
  const appRouter = router({
    assessment: assessmentRouter,
    onboarding: onboardingRouter,
    coaching: performanceCoachingRouter,
    feedback: performanceFeedbackRouter,
    okrs: performanceOkrsRouter,
    vacancy: vacancyCrudRouter,
    candidate: candidateCrudRouter,
    notification: notificationRouter,
    integration: integrationRouter,
    portal: portalRouter,
    audit: auditRouter,
  });
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
  return createCallerFactory(appRouter)(ctx as never) as unknown as Caller;
}

async function pageThrough(endpoint: EndpointCase, size: number): Promise<Page[]> {
  const caller = await makeCaller();
  const pages: Page[] = [];
  let cursor: string | undefined;
  do {
    const result = await endpoint.call(caller, {
      ...endpoint.input,
      [endpoint.sizeKey]: size,
      ...(cursor ? { cursor } : {}),
    });
    const ids = (result[endpoint.itemsKey] as Row[]).map((row) => row.id);
    cursor = result.nextCursor as string | undefined;
    expect(result).toHaveProperty('nextCursor');
    pages.push({ ids, nextCursor: cursor });
  } while (cursor && pages.length < 50);
  return pages;
}

beforeEach(() => {
  state.calls = [];
  state.callNo = 0;
  state.stale = new Set();
});

const SIZES = [2, 3];
const CASES = SIZES.flatMap((limit) => [limit, limit + 1, 2 * limit, 2 * limit + 1].map((n) => ({ limit, n })));

describe.each(ENDPOINTS)('$name cursor pagination', (endpoint) => {
  it.each(CASES)('N=$n rows at limit=$limit: every row exactly once, in (key, id) order', async ({ limit, n }) => {
    state.rows = makeRows(n, endpoint.sortBy);
    const pages = await pageThrough(endpoint, limit);

    expect(pages.flatMap((page) => page.ids)).toEqual(expectedOrder(state.rows, endpoint.sortBy, endpoint.dir));
    expect(pages.map((page) => page.ids.length)).toEqual(
      Array.from({ length: Math.ceil(n / limit) }, (_, i) => Math.min(limit, n - i * limit)),
    );
    // The cursor is the last row SHOWN on its page; the last page carries none.
    for (const page of pages.slice(0, -1)) expect(page.nextCursor).toBe(page.ids[page.ids.length - 1]);
    expect(pages[pages.length - 1]!.nextCursor).toBeUndefined();
  });

  it('a cursor whose row stopped matching the filters returns an empty page, never a page missing a row', async () => {
    state.rows = makeRows(7, endpoint.sortBy);
    const caller = await makeCaller();
    const first = await endpoint.call(caller, { ...endpoint.input, [endpoint.sizeKey]: 2 });
    const cursor = first.nextCursor as string;
    expect(cursor).toBeDefined();
    // The last row shown on page 1 is archived / re-statused before the client asks for page 2.
    state.stale.add(cursor);
    const second = await endpoint.call(caller, { ...endpoint.input, [endpoint.sizeKey]: 2, cursor });
    expect(second[endpoint.itemsKey]).toEqual([]);
    expect(second).toHaveProperty('nextCursor', undefined);
  });

  it('asks for limit+1 rows, skips the cursor row, and orders by (key, id) in one direction', async () => {
    state.rows = makeRows(3, endpoint.sortBy);
    const caller = await makeCaller();
    await endpoint.call(caller, { ...endpoint.input, [endpoint.sizeKey]: 2, cursor: state.rows[0]!.id });
    expect(state.calls[0]).toMatchObject({
      take: 3,
      cursor: { id: state.rows[0]!.id },
      skip: 1,
      orderBy: [{ [endpoint.sortBy]: endpoint.dir }, { id: endpoint.dir }],
    });
  });
});

describe('takeCursorPage / cursorPageArgs', () => {
  it('first page carries no cursor and no skip', async () => {
    const { cursorPageArgs } = await import('../../packages/api/src/lib/cursor-page');
    expect(cursorPageArgs(5, undefined)).toEqual({ take: 6 });
    expect(cursorPageArgs(5, 'x')).toEqual({ take: 6, cursor: { id: 'x' }, skip: 1 });
  });

  it('drops only the look-ahead row and names the last returned row', async () => {
    const { takeCursorPage } = await import('../../packages/api/src/lib/cursor-page');
    const rows = ['a', 'b', 'c'].map((id) => ({ id }));
    expect(takeCursorPage(rows, 2)).toEqual({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' });
    expect(takeCursorPage(rows, 3)).toEqual({ items: rows, nextCursor: undefined });
    expect(takeCursorPage([], 3)).toEqual({ items: [], nextCursor: undefined });
  });
});
