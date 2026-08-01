/**
 * compare-field-gating.test.ts (issue #14 — Assessment Player Slice 5
 * whole-branch-review follow-up).
 *
 * The `compare` procedure (packages/api/src/routers/assessment.ts) had no
 * test asserting its exact ranked-output shape: that an entitled role sees
 * band/normSampleSize/percentile, and a non-super role never sees the
 * restricted rawScore/breakdown fields. tests/access/select-for.test.ts
 * covers `selectFor` in isolation; this exercises the ACTUAL router output
 * through a real tRPC caller (mirroring tests/access/ai-interview-router.test.ts'
 * mock-everything-external pattern), with `selectFor`/`classification` left
 * UN-mocked so the real field-gating logic is what's under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — everything trpc.ts's middleware chain touches, EXCEPT the access
// module's selectFor/classification (real field-gating logic stays live).
// ---------------------------------------------------------------------------

vi.mock('../../packages/api/src/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/api/src/access')>();
  return {
    ...actual,
    // Grant access using whatever roles the test's ctx.user carries — lets
    // each test case control which roles selectFor sees, same as the real
    // requirePermission middleware would for an allowed caller.
    buildAccessForUser: vi.fn(async (user: { roles: string[] }) => ({
      allowed: true,
      scope: 'organization' as const,
      roles: user.roles,
    })),
    createAnchorLoader: vi.fn().mockReturnValue(null),
    assertScoped: vi.fn().mockResolvedValue(undefined),
    scopeWhereFor: vi.fn().mockResolvedValue({}),
    logDataAccess: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

vi.mock('@tims/db', () => ({
  // trpc.ts's withAudit middleware writes here on every successful call.
  db: {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
  // assessment.ts imports `tenantDb as db` — the router's actual query target.
  tenantDb: {
    assessmentAssignment: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

import { tenantDb } from '@tims/db';

const ASSIGNMENT_1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ASSIGNMENT_2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';

// Full DB row shape for the `result` relation — a real Prisma `select` would
// only return the keys the caller's role is entitled to; this mock findMany
// simulates that by filtering FULL_RESULT down to whatever `resultSelect` the
// router actually passed in `include.result.select`, exactly like Postgres
// would filtering columns for a SELECT list.
const FULL_RESULT = {
  id: 'result-1',
  organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01',
  assignmentId: ASSIGNMENT_1,
  normalizedScore: 72,
  percentile: 80,
  band: 'above_average',
  normSampleSize: 12,
  interpretation: 'strong performance',
  rawScore: 50,
  breakdown: { verbal: 10, numerical: 8 },
} as Record<string, unknown>;

function applySelect(select: Record<string, true>) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (key in FULL_RESULT) out[key] = FULL_RESULT[key];
  }
  return out;
}

async function makeCaller(roles: string[]) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { assessmentRouter } = await import('../../packages/api/src/routers/assessment');
  const testRouter = router({ assessment: assessmentRouter });
  const callerFactory = createCallerFactory(testRouter);

  const ctx = {
    user: {
      id: 'user-uuid-1',
      organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01',
      roles,
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'staff@tims.co',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  };

  return callerFactory(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenantDb.assessmentAssignment.count).mockResolvedValue(2);
  vi.mocked(tenantDb.assessmentAssignment.findMany).mockImplementation((async (args: {
    include: { result: { select: Record<string, true> } };
  }) => {
    const resultSelect = args.include.result.select;
    return [
      {
        id: ASSIGNMENT_1,
        candidate: { id: 'cand-1', firstName: 'Ana', lastName: 'Gomez', avatar: null },
        assessmentType: { id: 'type-1', name: 'Cognitive Battery', code: 'cog' },
        status: 'completed',
        result: applySelect(resultSelect),
      },
      {
        id: ASSIGNMENT_2,
        candidate: { id: 'cand-2', firstName: 'Beto', lastName: 'Diaz', avatar: null },
        assessmentType: { id: 'type-1', name: 'Cognitive Battery', code: 'cog' },
        status: 'completed',
        result: { ...applySelect(resultSelect), assignmentId: ASSIGNMENT_2, normalizedScore: 60 },
      },
    ];
  }) as never);
});

describe('assessment.compare — field-level gating on the ranked output (issue #14)', () => {
  it('super_admin: ranked output includes band/normSampleSize/percentile AND the restricted rawScore/breakdown', async () => {
    const caller = await makeCaller(['super_admin']);
    const result = await caller.assessment.compare({ assignmentIds: [ASSIGNMENT_1, ASSIGNMENT_2] });

    expect(result.ranked).toHaveLength(2);
    const top = result.ranked[0];
    expect(top.band).toBe('above_average');
    expect(top.normSampleSize).toBe(12);
    expect(top.percentile).toBe(80);
    expect(top.rawScore).toBe(50);
    expect(top.breakdown).toEqual({ verbal: 10, numerical: 8 });
  });

  it('recruiter (non-super, assessment:read): ranked output includes band/normSampleSize/percentile but OMITS rawScore/breakdown', async () => {
    const caller = await makeCaller(['recruiter']);
    const result = await caller.assessment.compare({ assignmentIds: [ASSIGNMENT_1, ASSIGNMENT_2] });

    expect(result.ranked).toHaveLength(2);
    const top = result.ranked[0];
    // Entitled confidential fields (classification.ts: RECRUITER is granted
    // normalizedScore/percentile/band/normSampleSize/interpretation).
    expect(top.band).toBe('above_average');
    expect(top.normSampleSize).toBe(12);
    expect(top.percentile).toBe(80);
    expect(top.normalizedScore).toBe(72);
    // Restricted (super_admin/external only) — never selected from the DB for
    // a recruiter, so the mapped output must never carry the real values.
    expect(top.rawScore).toBeUndefined();
    expect(top.breakdown).toBeUndefined();
    // Belt-and-suspenders: the restricted VALUES must not appear anywhere in
    // the serialized payload (guards against a future accidental re-add).
    expect(JSON.stringify(result)).not.toContain('"rawScore":50');
    expect(JSON.stringify(result)).not.toContain('"verbal"');
  });

  it('ranks by normalizedScore descending regardless of role (rank assignment unaffected by field gating)', async () => {
    const caller = await makeCaller(['recruiter']);
    const result = await caller.assessment.compare({ assignmentIds: [ASSIGNMENT_1, ASSIGNMENT_2] });

    expect(result.ranked[0].rank).toBe(1);
    expect(result.ranked[0].normalizedScore).toBe(72);
    expect(result.ranked[1].rank).toBe(2);
    expect(result.ranked[1].normalizedScore).toBe(60);
  });
});
