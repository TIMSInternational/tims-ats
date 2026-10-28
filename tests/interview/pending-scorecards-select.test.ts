import { beforeEach, describe, expect, it, vi } from 'vitest';

// getPendingScorecards must never return the candidate join-token columns (#308 follow-up).
// The procedure used `include` on the interview row, which returned every scalar —
// candidateJoinTokenHash and candidateJoinTokenExpiresAt included — to any interview:read holder.

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '66666666-6666-6666-6666-666666666666';
const FORBIDDEN = ['candidateJoinTokenHash', 'candidateJoinTokenExpiresAt'] as const;

const m = vi.hoisted(() => ({ evaluatorFindMany: vi.fn() }));

vi.mock('@tims/db', () => ({
  tenantDb: { interviewEvaluator: { findMany: m.evaluatorFindMany } },
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
  const { interviewScorecardsRouter } = await import('../../packages/api/src/routers/interview/scorecards');
  return createCallerFactory(router({ interview: interviewScorecardsRouter }))({
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

/** Emulates Prisma projection: keep only keys the `select` tree asks for. */
function project(row: Record<string, unknown>, select: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = row[k];
    else if (v && typeof v === 'object' && 'select' in v) {
      const child = row[k];
      const sub = (v as { select: Record<string, unknown> }).select;
      out[k] = Array.isArray(child)
        ? child.map((c) => project(c as Record<string, unknown>, sub))
        : project(child as Record<string, unknown>, sub);
    }
  }
  return out;
}

const FULL_ROW = {
  id: 'e1',
  interviewId: 'i1',
  userId: USER_ID,
  role: 'evaluator',
  status: 'pending',
  createdAt: new Date(),
  interview: {
    id: 'i1',
    organizationId: ORG_ID,
    type: 'video',
    status: 'scheduled',
    scheduledAt: new Date(),
    duration: 60,
    candidateJoinTokenHash: 'a'.repeat(64),
    candidateJoinTokenExpiresAt: new Date(),
    notes: 'internal',
    candidate: { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', avatar: null, email: 'ana@x.test' },
    vacancy: { id: 'v1', title: 'Dev' },
    scorecards: [],
  },
};

describe('interview.getPendingScorecards — join-token exposure', () => {
  beforeEach(() => {
    m.evaluatorFindMany.mockReset();
    m.evaluatorFindMany.mockImplementation(async (args: { select?: Record<string, unknown>; include?: unknown }) => {
      // A query without a select tree returns full rows — that is the defect being guarded.
      if (!args.select || args.include) return [FULL_ROW];
      return [project(FULL_ROW, args.select)];
    });
  });

  it('queries with an explicit select (no include) that never names the token columns', async () => {
    await (await caller()).interview.getPendingScorecards();
    const args = m.evaluatorFindMany.mock.calls[0][0];
    expect(args.include).toBeUndefined();
    const interviewSelect = args.select.interview.select as Record<string, unknown>;
    for (const f of FORBIDDEN) expect(interviewSelect).not.toHaveProperty(f);
    // The scorecards relation is also narrowed.
    expect(interviewSelect.scorecards).toMatchObject({ select: { id: true, submittedAt: true } });
  });

  it('the response never contains candidateJoinTokenHash / candidateJoinTokenExpiresAt', async () => {
    const res = await (await caller()).interview.getPendingScorecards();
    expect(res).toHaveLength(1);
    const json = JSON.stringify(res);
    for (const f of FORBIDDEN) expect(json).not.toContain(f);
    expect(json).not.toContain('a'.repeat(64));
    // What the dashboards render is still present.
    expect(res[0]).toMatchObject({
      id: 'e1',
      role: 'evaluator',
      interview: { id: 'i1', candidate: { firstName: 'Ana' }, vacancy: { title: 'Dev' } },
    });
  });
});
