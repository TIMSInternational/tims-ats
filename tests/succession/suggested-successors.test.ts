import { describe, it, expect, vi, beforeEach } from 'vitest';

// getSuggestedSuccessors (Sprint 1.4 Task 1) — Nine Box "star"/"high_potential"
// placements surface as suggested successors for a Critical Role. READ-ONLY:
// this query must never touch db.successor.create/update/delete — it only
// reads NineBoxEvaluation + Successor to compute suggestions.

const nineBoxFindMany = vi.fn();
const successorFindMany = vi.fn();
const successorCreate = vi.fn();
const successorUpdate = vi.fn();
const successorDelete = vi.fn();
const criticalRoleFindFirst = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    nineBoxEvaluation: { findMany: (...a: unknown[]) => nineBoxFindMany(...a) },
    successor: {
      findMany: (...a: unknown[]) => successorFindMany(...a),
      create: (...a: unknown[]) => successorCreate(...a),
      update: (...a: unknown[]) => successorUpdate(...a),
      delete: (...a: unknown[]) => successorDelete(...a),
    },
    criticalRole: { findFirst: (...a: unknown[]) => criticalRoleFindFirst(...a) },
  },
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn(async () => ({ allowed: true, scope: 'organization', roles: ['hr_admin'] })),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertSubjectInScope: vi.fn().mockResolvedValue(undefined),
  requireOrgScope: vi.fn(),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ROLE_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function evalRow(overrides: Partial<{
  userId: string;
  quadrant: string;
  potentialScore: number;
  performanceScore: number;
  evaluatedAt: Date;
}> = {}) {
  return {
    userId: 'user-1',
    quadrant: 'star',
    potentialScore: 90,
    performanceScore: 90,
    evaluatedAt: new Date('2026-06-01'),
    user: { id: 'user-1', firstName: 'Ana', lastName: 'Gomez', avatar: null, jobTitle: 'Engineer' },
    ...overrides,
  };
}

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { successionRouter } = await import('../../packages/api/src/routers/succession');
  const testRouter = router({ succession: successionRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'user-caller', organizationId: ORG_ID, roles: ['hr_admin'],
      isPlatformOwner: false, impersonatorId: null, email: 'hr@tims.co', isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as {
    succession: {
      getSuggestedSuccessors(input: { criticalRoleId: string }): Promise<
        Array<{
          userId: string;
          quadrant: string;
          suggestedReadiness: string;
          potentialScore: number;
          performanceScore: number;
        }>
      >;
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  successorFindMany.mockResolvedValue([]);
});

describe('succession.getSuggestedSuccessors', () => {
  it('returns star and high_potential evaluees mapped to suggested readiness', async () => {
    nineBoxFindMany.mockResolvedValue([
      evalRow({ userId: 'user-1', quadrant: 'star' }),
      evalRow({ userId: 'user-2', quadrant: 'high_potential', potentialScore: 80, performanceScore: 70 }),
    ]);

    const caller = await makeCaller();
    const result = await caller.succession.getSuggestedSuccessors({ criticalRoleId: ROLE_ID });

    expect(result).toHaveLength(2);
    const byUser = Object.fromEntries(result.map((r) => [r.userId, r]));
    expect(byUser['user-1'].suggestedReadiness).toBe('ready_now');
    expect(byUser['user-2'].suggestedReadiness).toBe('ready_1_year');
  });

  it('excludes quadrants other than star/high_potential', async () => {
    nineBoxFindMany.mockResolvedValue([
      evalRow({ userId: 'user-1', quadrant: 'core_player' }),
      evalRow({ userId: 'user-2', quadrant: 'developing' }),
    ]);

    const caller = await makeCaller();
    const result = await caller.succession.getSuggestedSuccessors({ criticalRoleId: ROLE_ID });

    expect(result).toHaveLength(0);
  });

  it('excludes users who are already a Successor for this critical role', async () => {
    nineBoxFindMany.mockResolvedValue([
      evalRow({ userId: 'user-1', quadrant: 'star' }),
      evalRow({ userId: 'user-2', quadrant: 'high_potential' }),
    ]);
    successorFindMany.mockResolvedValue([{ userId: 'user-1' }]);

    const caller = await makeCaller();
    const result = await caller.succession.getSuggestedSuccessors({ criticalRoleId: ROLE_ID });

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('user-2');
  });

  it('respects most-recent-period only: a stale star placement is dropped once a later evaluation moved the user off it', async () => {
    // Same user, two periods. The LATEST (by evaluatedAt) is 'developing' — not a
    // star anymore — so the user must NOT be suggested even though an older row
    // was 'star'.
    nineBoxFindMany.mockResolvedValue([
      evalRow({ userId: 'user-1', quadrant: 'developing', evaluatedAt: new Date('2026-06-01') }),
      evalRow({ userId: 'user-1', quadrant: 'star', evaluatedAt: new Date('2025-06-01') }),
    ]);

    const caller = await makeCaller();
    const result = await caller.succession.getSuggestedSuccessors({ criticalRoleId: ROLE_ID });

    expect(result).toHaveLength(0);
  });

  it('the inverse: a later evaluation that newly moved the user INTO star is suggested', async () => {
    nineBoxFindMany.mockResolvedValue([
      evalRow({ userId: 'user-1', quadrant: 'star', evaluatedAt: new Date('2026-06-01') }),
      evalRow({ userId: 'user-1', quadrant: 'developing', evaluatedAt: new Date('2025-06-01') }),
    ]);

    const caller = await makeCaller();
    const result = await caller.succession.getSuggestedSuccessors({ criticalRoleId: ROLE_ID });

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('user-1');
  });

  it('orders by evaluatedAt desc THEN createdAt desc — deterministic tiebreak for same-user rows sharing an identical evaluatedAt (Codex finding)', async () => {
    // NineBoxEvaluation's unique constraint is (organizationId, userId, period) —
    // NOT evaluatedAt — so two rows for the same user (different periods, e.g. a
    // backfill/correction) can legitimately share an identical evaluatedAt. Without
    // a deterministic secondary sort, which row Postgres/Prisma returns first for
    // that tie is undefined. Assert the orderBy clause sent to Prisma includes both
    // fields, in order, so ties resolve to the most-recently-inserted row.
    nineBoxFindMany.mockResolvedValue([]);

    const caller = await makeCaller();
    await caller.succession.getSuggestedSuccessors({ criticalRoleId: ROLE_ID });

    expect(nineBoxFindMany).toHaveBeenCalledTimes(1);
    const call = nineBoxFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ evaluatedAt: 'desc' }, { createdAt: 'desc' }]);
  });

  it('never calls a Successor write method — suggestion-only, read-only query', async () => {
    nineBoxFindMany.mockResolvedValue([evalRow({ userId: 'user-1', quadrant: 'star' })]);

    const caller = await makeCaller();
    await caller.succession.getSuggestedSuccessors({ criticalRoleId: ROLE_ID });

    expect(successorCreate).not.toHaveBeenCalled();
    expect(successorUpdate).not.toHaveBeenCalled();
    expect(successorDelete).not.toHaveBeenCalled();
  });

  it('orders by potential score then performance score, descending', async () => {
    nineBoxFindMany.mockResolvedValue([
      evalRow({ userId: 'user-low', quadrant: 'star', potentialScore: 60, performanceScore: 60 }),
      evalRow({ userId: 'user-high', quadrant: 'star', potentialScore: 95, performanceScore: 80 }),
      evalRow({ userId: 'user-mid', quadrant: 'high_potential', potentialScore: 80, performanceScore: 90 }),
    ]);

    const caller = await makeCaller();
    const result = await caller.succession.getSuggestedSuccessors({ criticalRoleId: ROLE_ID });

    expect(result.map((r) => r.userId)).toEqual(['user-high', 'user-mid', 'user-low']);
  });
});
