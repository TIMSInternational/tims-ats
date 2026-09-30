/**
 * Blind evaluation is enforced by the SERVER, not just hidden by the room UI
 * (PR #303, codex r3 P1). Before this, interview.getById returned every
 * evaluator's ratings/notes/recommendation to any interview:read caller, and
 * interview.getScorecard accepted any evaluatorId — so a panel evaluator who had
 * not submitted could read the others' feedback straight off the network tab.
 *
 * The fake db below honours the `where` clauses the routers actually send
 * (organizationId included), so the tenant-isolation cases fail if a query drops
 * its org predicate instead of passing vacuously.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_A = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ORG_B = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22';
const INTERVIEW = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c33';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RECRUITER = '33333333-3333-4333-8333-333333333333';

interface Card {
  id: string;
  organizationId: string;
  interviewId: string;
  evaluatorId: string;
  ratings: Record<string, number>;
  recommendation: string;
  overallNotes: string | null;
  biasFlags: unknown;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const store = vi.hoisted(() => ({
  cards: [] as Card[],
  panel: [] as Array<{ id: string; interviewId: string; userId: string; orgId: string }>,
  summary: null as null | { id: string; summary: string },
}));

type Where = Record<string, unknown>;

function cardMatches(c: Card, where: Where): boolean {
  if ('organizationId' in where && where.organizationId !== c.organizationId) return false;
  if ('interviewId' in where && where.interviewId !== c.interviewId) return false;
  if ('evaluatorId' in where && where.evaluatorId !== c.evaluatorId) return false;
  if ('submittedAt' in where && c.submittedAt === null) return false; // only { not: null } is used
  return true;
}

function evaluatorUser(id: string) {
  return { id, firstName: id.slice(0, 4), lastName: 'X', avatar: null };
}

vi.mock('@tims/db', () => ({
  tenantDb: {
    interview: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
        if (where.id !== INTERVIEW || where.organizationId !== ORG_A) return null;
        return {
          id: INTERVIEW,
          organizationId: ORG_A,
          evaluators: store.panel
            .filter((p) => p.orgId === ORG_A)
            .map((p) => ({ id: p.id, interviewId: p.interviewId, userId: p.userId, user: evaluatorUser(p.userId) })),
          scorecards: store.cards
            .filter((c) => c.organizationId === ORG_A && c.interviewId === INTERVIEW)
            .map((c) => ({ ...c, evaluator: evaluatorUser(c.evaluatorId) })),
          summary: store.summary,
        };
      },
    },
    interviewScorecard: {
      findFirst: async ({ where }: { where: Where }) => {
        const c = store.cards.find((x) => cardMatches(x, where));
        return c ? { ...c, evaluator: evaluatorUser(c.evaluatorId) } : null;
      },
      findMany: async ({ where }: { where: Where }) =>
        store.cards
          .filter((x) => cardMatches(x, where))
          .map((c) => ({ ...c, evaluator: evaluatorUser(c.evaluatorId) })),
    },
    interviewEvaluator: {
      findFirst: async ({
        where,
      }: {
        where: { interviewId: string; userId: string; interview?: { organizationId: string } };
      }) => {
        const row = store.panel.find(
          (p) =>
            p.interviewId === where.interviewId &&
            p.userId === where.userId &&
            (where.interview === undefined || where.interview.organizationId === p.orgId),
        );
        return row ? { id: row.id } : null;
      },
    },
  },
  runTenantTransaction: vi.fn(),
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['recruiter'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/access/build', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['recruiter'] }),
}));
vi.mock('../../packages/api/src/access/anchors', () => ({ createAnchorLoader: vi.fn().mockReturnValue(null) }));
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));
vi.mock('../../packages/api/src/services/email.service', () => ({ emailService: {} }));

const aiSummary = vi.fn();
const aiBias = vi.fn();
vi.mock('../../packages/api/src/services/interview-ai.service', () => ({
  interviewAiService: {
    generateGuide: vi.fn(),
    generateSummary: (...a: unknown[]) => aiSummary(...a),
    detectBias: (...a: unknown[]) => aiBias(...a),
  },
}));

interface ScorecardOut {
  evaluatorId: string;
  ratings: unknown;
  recommendation: string;
  overallNotes: string | null;
  submittedAt: Date | null;
  isWithheld: boolean;
}
interface Caller {
  interview: {
    getById(i: { id: string }): Promise<{ scorecards: ScorecardOut[]; summary: unknown }>;
    getScorecard(i: { interviewId: string; evaluatorId?: string }): Promise<ScorecardOut | null>;
    compareEvaluators(i: { interviewId: string }): Promise<{ evaluators: unknown[] }>;
    generateSummary(i: { interviewId: string }): Promise<unknown>;
    detectBias(i: { interviewId: string }): Promise<unknown>;
  };
}

async function callerAs(userId: string, orgId = ORG_A): Promise<Caller> {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { interviewRouter } = await import('../../packages/api/src/routers/interview');
  const factory = createCallerFactory(router({ interview: interviewRouter }));
  return factory({
    user: {
      id: userId,
      organizationId: orgId,
      roles: ['recruiter'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'u@example.com',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as Caller;
}

function card(evaluatorId: string, submitted: boolean, over: Partial<Card> = {}): Card {
  return {
    id: `card-${evaluatorId}-${over.organizationId ?? ORG_A}`,
    organizationId: ORG_A,
    interviewId: INTERVIEW,
    evaluatorId,
    ratings: { SQL: 2 },
    recommendation: 'no',
    overallNotes: `secret notes from ${evaluatorId}`,
    biasFlags: { flagged: true },
    submittedAt: submitted ? new Date('2026-09-29T10:00:00Z') : null,
    createdAt: new Date('2026-09-29T09:00:00Z'),
    updatedAt: new Date('2026-09-29T10:00:00Z'),
    ...over,
  };
}

const otherCard = () => store.cards.find((c) => c.evaluatorId === OTHER && c.organizationId === ORG_A);

beforeEach(() => {
  aiSummary.mockReset().mockResolvedValue({ ok: true });
  aiBias.mockReset().mockResolvedValue({ ok: true });
  store.panel = [
    { id: 'p1', interviewId: INTERVIEW, userId: ME, orgId: ORG_A },
    { id: 'p2', interviewId: INTERVIEW, userId: OTHER, orgId: ORG_A },
  ];
  store.cards = [card(OTHER, true, { ratings: { SQL: 2, Storytelling: 1 }, recommendation: 'strong_no' })];
  store.summary = { id: 's1', summary: 'AI debrief built from OTHER' };
});

function expectWithheld(sc: ScorecardOut | undefined | null) {
  expect(sc).toBeTruthy();
  expect(sc?.isWithheld).toBe(true);
  expect(sc?.ratings).toEqual({});
  expect(sc?.recommendation).toBe('');
  expect(sc?.overallNotes).toBeNull();
  // Status stays visible so the room can say "submitted" without the content.
  expect(sc?.submittedAt).toEqual(otherCard()?.submittedAt);
  expect(JSON.stringify(sc)).not.toContain('secret notes');
  expect(JSON.stringify(sc)).not.toContain('strong_no');
}

describe('blind evaluation — panel evaluator who has NOT submitted', () => {
  it("getById withholds other evaluators' ratings, notes, recommendation and the AI summary", async () => {
    const res = await (await callerAs(ME)).interview.getById({ id: INTERVIEW });
    expectWithheld(res.scorecards.find((s) => s.evaluatorId === OTHER));
    expect(res.summary).toBeNull();
  });

  it('getById still returns the viewer their OWN in-progress card in full', async () => {
    store.cards.push(card(ME, false, { ratings: { SQL: 4 }, overallNotes: 'mine' }));
    const res = await (await callerAs(ME)).interview.getById({ id: INTERVIEW });
    const mine = res.scorecards.find((s) => s.evaluatorId === ME);
    expect(mine).toMatchObject({ isWithheld: false, ratings: { SQL: 4 }, overallNotes: 'mine' });
    expectWithheld(res.scorecards.find((s) => s.evaluatorId === OTHER));
  });

  it("getScorecard with someone else's evaluatorId returns only a status stub", async () => {
    expectWithheld(await (await callerAs(ME)).interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER }));
  });

  it('getScorecard without evaluatorId still returns the caller their own card', async () => {
    store.cards.push(card(ME, false, { overallNotes: 'mine' }));
    const res = await (await callerAs(ME)).interview.getScorecard({ interviewId: INTERVIEW });
    expect(res).toMatchObject({ evaluatorId: ME, overallNotes: 'mine', isWithheld: false });
  });

  it('aggregate and AI-derived views are refused (FORBIDDEN) and the AI is never called', async () => {
    const caller = await callerAs(ME);
    await expect(caller.interview.compareEvaluators({ interviewId: INTERVIEW })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.interview.generateSummary({ interviewId: INTERVIEW })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.interview.detectBias({ interviewId: INTERVIEW })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(aiSummary).not.toHaveBeenCalled();
    expect(aiBias).not.toHaveBeenCalled();
  });
});

describe('blind evaluation — after the evaluator submits', () => {
  beforeEach(() => {
    store.cards.push(card(ME, true, { ratings: { SQL: 5 } }));
  });

  it('getById and getScorecard reveal the other evaluators in full', async () => {
    const caller = await callerAs(ME);
    const res = await caller.interview.getById({ id: INTERVIEW });
    expect(res.scorecards.find((s) => s.evaluatorId === OTHER)).toMatchObject({
      isWithheld: false,
      ratings: { SQL: 2, Storytelling: 1 },
      recommendation: 'strong_no',
      overallNotes: `secret notes from ${OTHER}`,
    });
    expect(res.summary).toEqual(store.summary);
    const theirs = await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER });
    expect(theirs).toMatchObject({ isWithheld: false, recommendation: 'strong_no' });
  });

  it('aggregate and AI views are allowed again', async () => {
    const caller = await callerAs(ME);
    const cmp = await caller.interview.compareEvaluators({ interviewId: INTERVIEW });
    expect(cmp.evaluators).toHaveLength(2);
    await caller.interview.generateSummary({ interviewId: INTERVIEW });
    await caller.interview.detectBias({ interviewId: INTERVIEW });
    expect(aiSummary).toHaveBeenCalledTimes(1);
    expect(aiBias).toHaveBeenCalledTimes(1);
  });
});

describe('blind evaluation — non-panel staff with interview:read', () => {
  it('a recruiter who is not on the panel sees every scorecard (the existing interview:read grant)', async () => {
    const caller = await callerAs(RECRUITER);
    const res = await caller.interview.getById({ id: INTERVIEW });
    expect(res.scorecards.find((s) => s.evaluatorId === OTHER)).toMatchObject({
      isWithheld: false,
      recommendation: 'strong_no',
    });
    expect(res.summary).toEqual(store.summary);
    expect(await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER })).toMatchObject({
      isWithheld: false,
    });
    await expect(caller.interview.compareEvaluators({ interviewId: INTERVIEW })).resolves.toBeTruthy();
  });
});

describe('blind evaluation — tenant isolation still holds', () => {
  it('a submitted scorecard in ANOTHER org does not un-blind the evaluator here', async () => {
    // Same user id, same interview id, but the row belongs to org B: the viewer-state
    // lookup must filter on organizationId or this would count as "submitted".
    store.cards.push(card(ME, true, { organizationId: ORG_B }));
    store.panel.push({ id: 'p3', interviewId: INTERVIEW, userId: ME, orgId: ORG_B });
    const caller = await callerAs(ME);
    expectWithheld(await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER }));
    await expect(caller.interview.compareEvaluators({ interviewId: INTERVIEW })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("a caller from another org cannot read this org's interview or scorecards at all", async () => {
    const caller = await callerAs(RECRUITER, ORG_B);
    await expect(caller.interview.getById({ id: INTERVIEW })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER })).toBeNull();
  });
});
