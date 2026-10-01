/**
 * Blind evaluation is enforced by the SERVER, not just hidden by the room UI
 * (PR #303, codex r3 P1). Before this, interview.getById returned every
 * evaluator's ratings/notes/recommendation to any interview:read caller, and
 * interview.getScorecard accepted any evaluatorId — so a panel evaluator who had
 * not submitted could read the others' feedback straight off the network tab.
 *
 * The fake db below honours the `where` clauses the routers actually send
 * (organizationId included), so the tenant-isolation cases fail if a query drops
 * its org predicate instead of passing vacuously. It is STRICT: `submittedAt` is
 * modelled exactly (`null` vs `{ not: null }`), an unrecognised where key THROWS
 * instead of being ignored, and an evaluator lookup without its org predicate
 * throws — so a predicate that is inverted, dropped or renamed fails loudly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_A = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ORG_B = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22';
const INTERVIEW = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c33';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RECRUITER = '33333333-3333-4333-8333-333333333333';
const VACANCY = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380d44';

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

interface PanelRow {
  id: string;
  interviewId: string;
  userId: string;
  orgId: string;
}

const store = vi.hoisted(() => ({
  cards: [] as Card[],
  panel: [] as PanelRow[],
  summary: null as null | { id: string; summary: string },
  jobProfile: null as null | { organizationId: string; vacancyId: string; competencies: unknown },
  audit: [] as Array<Record<string, unknown>>,
  interviewStatus: 'scheduled',
}));

type Where = Record<string, unknown>;

function isNotNull(v: unknown): boolean {
  return typeof v === 'object' && v !== null && Object.keys(v).length === 1 && 'not' in v && (v as { not: unknown }).not === null;
}

function cardMatches(c: Card, where: Where): boolean {
  for (const [key, value] of Object.entries(where)) {
    switch (key) {
      case 'organizationId':
      case 'interviewId':
        if (value !== c[key]) return false;
        break;
      case 'evaluatorId':
        if (typeof value === 'string') {
          if (value !== c.evaluatorId) return false;
        } else if (typeof value === 'object' && value !== null && typeof (value as { not?: unknown }).not === 'string') {
          if ((value as { not: string }).not === c.evaluatorId) return false;
        } else {
          throw new Error(`fake db: unsupported evaluatorId filter ${JSON.stringify(value)}`);
        }
        break;
      case 'submittedAt':
        if (value === null) {
          if (c.submittedAt !== null) return false;
        } else if (isNotNull(value)) {
          if (c.submittedAt === null) return false;
        } else {
          throw new Error(`fake db: unsupported submittedAt filter ${JSON.stringify(value)}`);
        }
        break;
      default:
        throw new Error(`fake db: unrecognised interviewScorecard where key "${key}"`);
    }
  }
  return true;
}

function panelMatches(p: PanelRow, where: Where): boolean {
  if (!('interview' in where)) throw new Error('fake db: interviewEvaluator lookup without its org predicate');
  for (const [key, value] of Object.entries(where)) {
    switch (key) {
      case 'interviewId':
      case 'userId':
        if (value !== p[key]) return false;
        break;
      case 'interview': {
        const org = (value as { organizationId?: unknown } | null)?.organizationId;
        if (typeof org !== 'string') throw new Error('fake db: interviewEvaluator org predicate is not an organizationId');
        if (org !== p.orgId) return false;
        break;
      }
      default:
        throw new Error(`fake db: unrecognised interviewEvaluator where key "${key}"`);
    }
  }
  return true;
}

function evaluatorUser(id: string) {
  return { id, firstName: id.slice(0, 4), lastName: 'X', avatar: null };
}

vi.mock('@tims/db', () => {
  const tenantDb = {
    interview: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
        if (where.id !== INTERVIEW || where.organizationId !== ORG_A) return null;
        return {
          id: INTERVIEW,
          organizationId: ORG_A,
          vacancyId: VACANCY,
          status: store.interviewStatus,
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
    jobProfile: {
      findFirst: async ({ where }: { where: { vacancyId: string; organizationId: string } }) => {
        const jp = store.jobProfile;
        if (!jp || jp.vacancyId !== where.vacancyId || jp.organizationId !== where.organizationId) return null;
        return { competencies: jp.competencies };
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
      count: async ({ where }: { where: Where }) => store.cards.filter((x) => cardMatches(x, where)).length,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { interviewId_evaluatorId: { interviewId: string; evaluatorId: string } };
        create: Card;
        update: Partial<Card>;
      }) => {
        const { interviewId, evaluatorId } = where.interviewId_evaluatorId;
        const existing = store.cards.find((c) => c.interviewId === interviewId && c.evaluatorId === evaluatorId);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const row: Card = {
          ...create,
          id: `card-${evaluatorId}-new`,
          overallNotes: create.overallNotes ?? null,
          biasFlags: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.cards.push(row);
        return { ...row };
      },
    },
    interviewEvaluator: {
      findFirst: async ({ where }: { where: Where }) => {
        const row = store.panel.find((p) => panelMatches(p, where));
        return row ? { id: row.id } : null;
      },
      deleteMany: async ({ where }: { where: Where }) => {
        const before = store.panel.length;
        store.panel = store.panel.filter((p) => !panelMatches(p, where));
        return { count: before - store.panel.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.audit.push(data);
        return { id: `audit-${store.audit.length}` };
      },
    },
  };
  return {
    tenantDb,
    runTenantTransaction: (_orgId: string, fn: (tx: typeof tenantDb) => unknown) => fn(tenantDb),
    runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  };
});

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
  biasFlags: unknown;
  submittedAt: Date | null;
  isWithheld: boolean;
}
interface SubmitInput {
  interviewId: string;
  ratings: Record<string, number>;
  recommendation: 'strong_yes' | 'yes' | 'neutral' | 'no' | 'strong_no';
  overallNotes?: string;
}
interface Caller {
  interview: {
    getById(i: { id: string }): Promise<{ scorecards: ScorecardOut[]; summary: unknown }>;
    getScorecard(i: { interviewId: string; evaluatorId?: string }): Promise<ScorecardOut | null>;
    compareEvaluators(i: { interviewId: string }): Promise<{ evaluators: unknown[] }>;
    generateSummary(i: { interviewId: string }): Promise<unknown>;
    detectBias(i: { interviewId: string }): Promise<unknown>;
    submitScorecard(i: SubmitInput): Promise<{ id: string }>;
    removeEvaluator(i: { interviewId: string; userId: string }): Promise<unknown>;
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
  store.jobProfile = {
    organizationId: ORG_A,
    vacancyId: VACANCY,
    competencies: [
      { name: 'SQL', level: 4 },
      { name: 'Storytelling', level: 3 },
    ],
  };
  store.audit = [];
  store.interviewStatus = 'scheduled';
});

function expectWithheld(sc: ScorecardOut | undefined | null) {
  expect(sc).toBeTruthy();
  expect(sc?.isWithheld).toBe(true);
  expect(sc?.ratings).toEqual({});
  expect(sc?.recommendation).toBe('');
  expect(sc?.overallNotes).toBeNull();
  expect(sc?.biasFlags).toBeNull();
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

describe('blind evaluation — an UNSUBMITTED draft does not count as submitted', () => {
  it('with a saved-but-unsubmitted card of their own, the evaluator is still blinded everywhere', async () => {
    // Pins the exact `submittedAt: { not: null }` predicate: inverting it (or dropping it)
    // would count this draft as a submission and un-blind the viewer.
    store.cards.push(card(ME, false, { ratings: { SQL: 4 } }));
    const caller = await callerAs(ME);
    expectWithheld(await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER }));
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

describe('blind evaluation — panel membership is org-scoped', () => {
  it('a panel row for the same user + interview id in ANOTHER org does not blind them here', async () => {
    // ME is on the panel only in org B. In org A they are non-panel staff, so they see
    // everything; an evaluator lookup that dropped its org predicate would blind them.
    store.panel = [
      { id: 'p2', interviewId: INTERVIEW, userId: OTHER, orgId: ORG_A },
      { id: 'p3', interviewId: INTERVIEW, userId: ME, orgId: ORG_B },
    ];
    const caller = await callerAs(ME);
    expect(await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER })).toMatchObject({
      isWithheld: false,
      recommendation: 'strong_no',
    });
    await expect(caller.interview.compareEvaluators({ interviewId: INTERVIEW })).resolves.toBeTruthy();
  });
});

describe('submitScorecard — the server decides what counts as submitted', () => {
  const full = { SQL: 4, Storytelling: 3 };

  it('refuses a placeholder card with no ratings, and the evaluator stays blinded', async () => {
    const caller = await callerAs(ME);
    await expect(
      caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: {}, recommendation: 'yes' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(store.cards.some((c) => c.evaluatorId === ME)).toBe(false);
    expectWithheld(await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER }));
  });

  it("refuses a card that rates only part of the job profile's competency set", async () => {
    const caller = await callerAs(ME);
    await expect(
      caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: { SQL: 4 }, recommendation: 'yes' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(store.cards.some((c) => c.evaluatorId === ME)).toBe(false);
  });

  it('refuses ratings outside 1..5 and more than 50 keys', async () => {
    const caller = await callerAs(ME);
    await expect(
      caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: { SQL: 0, Storytelling: 3 }, recommendation: 'yes' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: { SQL: 6, Storytelling: 3 }, recommendation: 'yes' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const tooMany: Record<string, number> = { ...full };
    for (let i = 0; i < 49; i += 1) tooMany[`extra-${i}`] = 3;
    await expect(
      caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: tooMany, recommendation: 'yes' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(store.cards.some((c) => c.evaluatorId === ME)).toBe(false);
  });

  it('accepts a card covering the whole set, which then un-blinds the evaluator', async () => {
    const caller = await callerAs(ME);
    await caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: full, recommendation: 'yes' });
    expect(store.cards.find((c) => c.evaluatorId === ME)).toMatchObject({ ratings: full, recommendation: 'yes' });
    expect((await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER }))?.isWithheld).toBe(false);
    expect(store.audit).toEqual([]); // a first submission is not a revision
  });

  it("accepts the room's generic fallback set (used when the evaluator cannot read the job profile)", async () => {
    const caller = await callerAs(ME);
    await caller.interview.submitScorecard({
      interviewId: INTERVIEW,
      ratings: { leadership: 3, analytical: 4, communication: 5, problem_solving: 2 },
      recommendation: 'neutral',
    });
    expect(store.cards.find((c) => c.evaluatorId === ME)?.submittedAt).not.toBeNull();
  });

  it('with no job profile the generic set is the one required', async () => {
    store.jobProfile = null;
    const caller = await callerAs(ME);
    await expect(
      caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: full, recommendation: 'yes' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller.interview.submitScorecard({
      interviewId: INTERVIEW,
      ratings: { leadership: 3, analytical: 4, communication: 5, problem_solving: 2 },
      recommendation: 'yes',
    });
    expect(store.cards.some((c) => c.evaluatorId === ME)).toBe(true);
  });

  it('a non-panel member cannot submit at all', async () => {
    await expect(
      (await callerAs(RECRUITER)).interview.submitScorecard({ interviewId: INTERVIEW, ratings: full, recommendation: 'yes' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a RE-submission (after the panel became visible) is allowed but writes an audit row with the previous values', async () => {
    const caller = await callerAs(ME);
    await caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: full, recommendation: 'yes' });
    await caller.interview.submitScorecard({
      interviewId: INTERVIEW,
      ratings: { SQL: 2, Storytelling: 1 },
      recommendation: 'strong_no',
    });
    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({
      organizationId: ORG_A,
      userId: ME,
      actorId: ME,
      action: 'interview_scorecard_resubmitted',
      entity: 'interview_scorecard',
      changes: {
        before: { ratings: full, recommendation: 'yes' },
        after: { ratings: { SQL: 2, Storytelling: 1 }, recommendation: 'strong_no' },
      },
      metadata: { interviewId: INTERVIEW, otherSubmittedScorecards: 1 },
    });
  });
});

describe('removeEvaluator — a panel member cannot remove themselves to escape the blind', () => {
  it('refuses self-removal and leaves the panel row in place', async () => {
    const caller = await callerAs(ME);
    await expect(caller.interview.removeEvaluator({ interviewId: INTERVIEW, userId: ME })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(store.panel.some((p) => p.userId === ME)).toBe(true);
    expectWithheld(await caller.interview.getScorecard({ interviewId: INTERVIEW, evaluatorId: OTHER }));
  });

  it('still lets someone else remove a panel member (org-scoped)', async () => {
    await (await callerAs(RECRUITER)).interview.removeEvaluator({ interviewId: INTERVIEW, userId: ME });
    expect(store.panel.some((p) => p.userId === ME)).toBe(false);
  });
});

describe('submitScorecard — a closed interview refuses scorecards (#327)', () => {
  const full = { SQL: 4, Storytelling: 5 };

  it.each(['cancelled', 'no_show'])('refuses a card on a %s interview and writes nothing', async (status) => {
    store.interviewStatus = status;
    const caller = await callerAs(ME);
    await expect(
      caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: full, recommendation: 'yes' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(store.cards.some((c) => c.evaluatorId === ME)).toBe(false);
    expect(store.audit).toEqual([]);
  });

  it('refuses an UPDATE of an already-submitted card once the interview is cancelled', async () => {
    store.cards.push(card(ME, true, { ratings: full, recommendation: 'yes' }));
    store.interviewStatus = 'cancelled';
    const caller = await callerAs(ME);
    await expect(
      caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: { SQL: 1, Storytelling: 1 }, recommendation: 'strong_no' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(store.cards.find((c) => c.evaluatorId === ME)).toMatchObject({ ratings: full, recommendation: 'yes' });
    expect(store.audit).toEqual([]);
  });

  it.each(['scheduled', 'rescheduled', 'in_progress', 'completed'])(
    'accepts a card on a %s interview (scoring after the interview is the normal flow)',
    async (status) => {
      store.interviewStatus = status;
      const caller = await callerAs(ME);
      await caller.interview.submitScorecard({ interviewId: INTERVIEW, ratings: full, recommendation: 'yes' });
      expect(store.cards.find((c) => c.evaluatorId === ME)?.submittedAt).not.toBeNull();
    },
  );
});
