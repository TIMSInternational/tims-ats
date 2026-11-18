import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pilot interview fixes on the server side:
//  - B-05: a panelist (committee, team scope, sees the interview only through the panel arm) cannot
//    cancel, reschedule or change the panel; whoever manages the vacancy still can.
//  - A-16: interview.list can list the most recent first (past interviews), so new ones never fall off.
//  - A-17: interview.list carries the zone the schedule modal books in (the organization's, else UTC).
//  - F-10: interview.getById carries the scorecard competencies (committee has no vacancy:read).
// No procedure is added: the tRPC surface is ratcheted (tests/governance/trpc-procedure-ratchet.test.ts).
//  - B-29: getPendingScorecards lists only interviews that have started.
//  - A-02: "No se presentó" (interview.cancel with outcome 'no_show') — no email; like reschedule, it writes
//    under the interview row lock and only then counts submitted cards, rolling back if there is one.
//  - A-02 / B-30: the status filter and the KPI counts use the badge rule (repositories/interview-status-filter.ts).

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const INTERVIEW_ID = '22222222-2222-4222-8222-222222222222';
const VACANCY_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

const m = vi.hoisted(() => ({
  scope: 'team' as string,
  interviewFindFirst: vi.fn(),
  interviewFindMany: vi.fn(),
  interviewCount: vi.fn(),
  interviewUpdate: vi.fn(),
  // no-show / reschedule write inside a transaction, under the interview row lock
  txInterviewUpdateMany: vi.fn(),
  txInterviewFind: vi.fn(),
  txCardCount: vi.fn(),
  // How each transaction callback ended: Prisma commits a callback that returns and rolls back one that throws.
  txOutcome: [] as string[],
  evaluatorDeleteMany: vi.fn(),
  evaluatorFindMany: vi.fn(),
  userFindMany: vi.fn(),
  orgFindFirst: vi.fn(),
  vacancyFindFirst: vi.fn(),
  jobProfileFindFirst: vi.fn(),
  txUserFind: vi.fn(),
  txEvaluatorCreate: vi.fn(),
  scopeWhereFor: vi.fn(),
  assertScoped: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    interview: {
      findFirst: m.interviewFindFirst,
      findMany: m.interviewFindMany,
      count: m.interviewCount,
      update: m.interviewUpdate,
    },
    interviewEvaluator: { deleteMany: m.evaluatorDeleteMany, findMany: m.evaluatorFindMany },
    // The evaluator guard (services/interview-evaluator-eligibility.service.ts); the panel is empty by default.
    user: { findMany: m.userFindMany },
    organization: { findFirst: m.orgFindFirst },
    vacancy: { findFirst: m.vacancyFindFirst },
    jobProfile: { findFirst: m.jobProfileFindFirst },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runTenantTransaction: async (_org: string, fn: (tx: unknown) => unknown) => {
    try {
      const result = await fn({
        user: { findFirst: m.txUserFind },
        interviewEvaluator: { create: m.txEvaluatorCreate },
        interview: { updateMany: m.txInterviewUpdateMany, findFirst: m.txInterviewFind },
        interviewScorecard: { count: m.txCardCount },
      });
      m.txOutcome.push('committed');
      return result;
    } catch (err) {
      m.txOutcome.push('rolled_back');
      throw err;
    }
  },
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn(async () => ({ allowed: true, scope: m.scope, roles: ['committee'] })),
  createAnchorLoader: vi.fn().mockReturnValue({}),
  scopeWhereFor: m.scopeWhereFor,
  assertScoped: m.assertScoped,
}));
vi.mock('../../packages/api/src/services/interview-email.service', () => ({
  interviewEmailService: { notify: m.notify },
}));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { isRecruitmentConsentWithdrawn: vi.fn(async () => false) },
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { interviewRouter } = await import('../../packages/api/src/routers/interview');
  return createCallerFactory(router({ interview: interviewRouter }))({
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      roles: ['committee'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'panel@acme.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

const TEAM_VACANCY_WHERE = { OR: [{ teamId: { in: [] } }, { assignedTo: USER_ID }] };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://ats.example.test';
  m.scope = 'team';
  m.assertScoped.mockResolvedValue(undefined);
  m.scopeWhereFor.mockImplementation(async (entity: string) => (entity === 'vacancy' ? TEAM_VACANCY_WHERE : {}));
  m.interviewFindFirst.mockResolvedValue(null);
  m.interviewUpdate.mockResolvedValue({ id: INTERVIEW_ID });
  m.txInterviewUpdateMany.mockResolvedValue({ count: 1 });
  m.txInterviewFind.mockResolvedValue({ id: INTERVIEW_ID });
  m.txCardCount.mockResolvedValue(0);
  m.txOutcome.length = 0;
  m.evaluatorDeleteMany.mockResolvedValue({ count: 1 });
  m.evaluatorFindMany.mockResolvedValue([]);
  m.userFindMany.mockResolvedValue([]);
  m.txUserFind.mockResolvedValue({ id: OTHER_ID });
  m.txEvaluatorCreate.mockResolvedValue({ id: 'ie-1' });
  m.notify.mockResolvedValue(undefined);
});

describe('B-05 — a panelist cannot manage the interview they sit on', () => {
  const attempts = {
    cancel: (c: Awaited<ReturnType<typeof caller>>) => c.interview.cancel({ id: INTERVIEW_ID, cancelReason: 'x' }),
    noShow: (c: Awaited<ReturnType<typeof caller>>) => c.interview.cancel({ id: INTERVIEW_ID, outcome: 'no_show' }),
    reschedule: (c: Awaited<ReturnType<typeof caller>>) =>
      c.interview.reschedule({ id: INTERVIEW_ID, scheduledAt: new Date('2026-11-12T16:00:00Z') }),
    addEvaluator: (c: Awaited<ReturnType<typeof caller>>) =>
      c.interview.addEvaluator({ interviewId: INTERVIEW_ID, userId: OTHER_ID }),
    removeEvaluator: (c: Awaited<ReturnType<typeof caller>>) =>
      c.interview.removeEvaluator({ interviewId: INTERVIEW_ID, userId: OTHER_ID }),
  };

  it.each(Object.keys(attempts) as Array<keyof typeof attempts>)(
    '%s is refused at team scope when the vacancy is not one the caller manages',
    async (name) => {
      await expect(attempts[name](await caller())).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // The probe asks for the interview ON a vacancy in the caller's vacancy scope, org-filtered.
      const where = m.interviewFindFirst.mock.calls[0]![0].where;
      expect(where.AND).toEqual([
        { id: INTERVIEW_ID },
        { organizationId: ORG_ID },
        { vacancy: { AND: [TEAM_VACANCY_WHERE, { deletedAt: null }] } },
      ]);
      expect(m.interviewUpdate).not.toHaveBeenCalled();
      expect(m.txInterviewUpdateMany).not.toHaveBeenCalled();
      expect(m.evaluatorDeleteMany).not.toHaveBeenCalled();
      expect(m.txEvaluatorCreate).not.toHaveBeenCalled();
      expect(m.notify).not.toHaveBeenCalled();
    },
  );

  it('a leader managing the vacancy (team scope) may still remove a panelist and cancel', async () => {
    m.interviewFindFirst.mockResolvedValue({ id: INTERVIEW_ID });
    const c = await caller();
    await expect(c.interview.removeEvaluator({ interviewId: INTERVIEW_ID, userId: OTHER_ID })).resolves.toEqual({
      success: true,
    });
    await expect(c.interview.cancel({ id: INTERVIEW_ID, cancelReason: 'x' })).resolves.toMatchObject({
      id: INTERVIEW_ID,
    });
  });

  it('organization scope is unchanged: no extra vacancy probe', async () => {
    m.scope = 'organization';
    await (await caller()).interview.removeEvaluator({ interviewId: INTERVIEW_ID, userId: OTHER_ID });
    expect(m.interviewFindFirst).not.toHaveBeenCalled();
    expect(m.assertScoped).toHaveBeenCalledWith('interview', INTERVIEW_ID, expect.anything(), USER_ID, ORG_ID);
  });

  it('the interview scope is still checked first (out-of-scope id → NOT_FOUND)', async () => {
    const { TRPCError } = await import('@trpc/server');
    m.assertScoped.mockRejectedValueOnce(new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' }));
    await expect(
      (await caller()).interview.addEvaluator({ interviewId: INTERVIEW_ID, userId: OTHER_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(m.interviewFindFirst).not.toHaveBeenCalled();
  });
});

describe('A-16 / A-17 — interview.list sort order and scheduling zone', () => {
  beforeEach(() => {
    m.scope = 'organization';
    m.interviewFindMany.mockResolvedValue([]);
    m.interviewCount.mockResolvedValue(0);
    m.orgFindFirst.mockResolvedValue({ settings: { timezone: 'America/Costa_Rica' } });
  });

  it('defaults to soonest first and can list the most recent first', async () => {
    const c = await caller();
    await c.interview.list({ pageSize: 50 });
    expect(m.interviewFindMany.mock.calls[0]![0].orderBy).toEqual([{ scheduledAt: 'asc' }, { id: 'asc' }]);
    await c.interview.list({ pageSize: 50, sort: 'desc', page: 2 });
    const args = m.interviewFindMany.mock.calls[1]![0];
    expect(args.orderBy).toEqual([{ scheduledAt: 'desc' }, { id: 'asc' }]);
    expect(args.skip).toBe(50);
  });

  it('carries the organization zone the schedule modal books in (org-filtered read of settings only)', async () => {
    const res = await (await caller()).interview.list({ pageSize: 5 });
    expect(res.schedulingTimeZone).toEqual({ timeZone: 'America/Costa_Rica', source: 'organization' });
    expect(m.orgFindFirst.mock.calls[0]![0]).toEqual({ where: { id: ORG_ID }, select: { settings: true } });
  });

  it('says UTC explicitly when the organization has no (valid) zone — never America/Bogota', async () => {
    for (const settings of [{}, { timezone: 'Mars/Olympus' }, null]) {
      m.orgFindFirst.mockResolvedValueOnce({ settings });
      const res = await (await caller()).interview.list({ pageSize: 5 });
      expect(res.schedulingTimeZone).toEqual({ timeZone: 'UTC', source: 'utc' });
    }
    expect(m.vacancyFindFirst).not.toHaveBeenCalled();
  });

  it("filtered to one vacancy, falls back to that vacancy's company zone — the chain the emails use", async () => {
    m.orgFindFirst.mockResolvedValue({ settings: {} });
    m.vacancyFindFirst.mockResolvedValue({ company: { timezone: 'America/Costa_Rica' } });
    const res = await (await caller()).interview.list({ vacancyId: VACANCY_ID, pageSize: 1 });
    expect(res.schedulingTimeZone).toEqual({ timeZone: 'America/Costa_Rica', source: 'company' });
    expect(m.vacancyFindFirst.mock.calls[0]![0]).toEqual({
      where: { id: VACANCY_ID, organizationId: ORG_ID, deletedAt: null },
      select: { company: { select: { timezone: true } } },
    });
    // The organization zone still wins.
    m.orgFindFirst.mockResolvedValue({ settings: { timezone: 'America/Panama' } });
    const again = await (await caller()).interview.list({ vacancyId: VACANCY_ID, pageSize: 1 });
    expect(again.schedulingTimeZone).toEqual({ timeZone: 'America/Panama', source: 'organization' });
  });
});

describe('F-10 — interview.getById carries the scorecard competencies', () => {
  beforeEach(() => {
    m.scope = 'team';
    m.interviewFindFirst.mockResolvedValue({
      id: INTERVIEW_ID,
      vacancyId: VACANCY_ID,
      evaluators: [{ userId: USER_ID }],
      scorecards: [],
      summary: null,
    });
  });

  it("returns the vacancy job profile's competencies through the interview scope alone", async () => {
    m.jobProfileFindFirst.mockResolvedValue({ competencies: [{ name: 'SQL', level: 4 }] });
    const res = await (await caller()).interview.getById({ id: INTERVIEW_ID });
    expect(res.scorecardCompetencies).toEqual([{ name: 'SQL', level: 4 }]);
    expect(m.assertScoped).toHaveBeenCalledWith('interview', INTERVIEW_ID, expect.anything(), USER_ID, ORG_ID);
    expect(m.jobProfileFindFirst.mock.calls[0]![0]).toEqual({
      where: { vacancyId: VACANCY_ID, organizationId: ORG_ID },
      select: { competencies: true },
    });
  });

  it('is null without a job profile (the room then uses the generic set)', async () => {
    m.jobProfileFindFirst.mockResolvedValue(null);
    const res = await (await caller()).interview.getById({ id: INTERVIEW_ID });
    expect(res.scorecardCompetencies).toBeNull();
  });
});

describe('B-29 — pending scorecards are interviews that have started', () => {
  it('filters on scheduledAt <= now and lists the oldest first', async () => {
    m.evaluatorFindMany.mockResolvedValue([]);
    const before = Date.now();
    await (await caller()).interview.getPendingScorecards();
    const args = m.evaluatorFindMany.mock.calls[0]![0];
    const own = args.where.interview.AND[0];
    expect(own.organizationId).toBe(ORG_ID);
    expect(own.scheduledAt.lte).toBeInstanceOf(Date);
    expect(own.scheduledAt.lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.orderBy).toEqual({ interview: { scheduledAt: 'asc' } });
  });
});

describe('B-30 — when a submitted card completes the interview', () => {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
  const base = { id: INTERVIEW_ID, meetingUrl: null as string | null, duration: 60 };

  it('a started non-video interview completes; a future one does not', async () => {
    const { shouldCompleteOnScorecard } = await import('../../packages/api/src/services/scorecard-submission.service');
    expect(shouldCompleteOnScorecard({ ...base, type: 'onsite', scheduledAt: at(5) })).toBe(true);
    expect(shouldCompleteOnScorecard({ ...base, type: 'online', scheduledAt: at(-60) })).toBe(false);
  });

  it('our own video join keeps the interview open until end + grace; an external video link does not', async () => {
    const { shouldCompleteOnScorecard } = await import('../../packages/api/src/services/scorecard-submission.service');
    expect(shouldCompleteOnScorecard({ ...base, type: 'video', scheduledAt: at(80) })).toBe(false); // 20 min into grace
    expect(shouldCompleteOnScorecard({ ...base, type: 'video', scheduledAt: at(95) })).toBe(true);
    expect(
      shouldCompleteOnScorecard({ ...base, type: 'video', meetingUrl: 'https://zoom.us/j/1', scheduledAt: at(5) }),
    ).toBe(true);
  });
});

describe('A-16 / B-30 — list filters before paging and counts submitted cards', () => {
  beforeEach(() => {
    m.scope = 'organization';
    m.interviewFindMany.mockResolvedValue([]);
    m.interviewCount.mockResolvedValue(0);
    m.orgFindFirst.mockResolvedValue({ settings: {} });
  });

  it('openOnly is its own AND element (it narrows a status filter, never replaces it)', async () => {
    await (await caller()).interview.list({ openOnly: true, status: 'scheduled', pageSize: 20 });
    const where = m.interviewFindMany.mock.calls[0]![0].where;
    expect(where.AND).toContainEqual({ status: { in: ['scheduled', 'rescheduled', 'confirmed', 'in_progress'] } });
    expect(JSON.stringify(where.AND)).toContain('"status":"scheduled"');
    expect(m.interviewCount.mock.calls[0]![0].where).toEqual(where);
  });

  it('the status filter is the badge rule: "Programada" excludes started rows (tests/interview/interview-status-filter.test.ts pins the rule)', async () => {
    const { interviewStatusFilterWhere } = await import('../../packages/api/src/repositories/interview-status-filter');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T16:00:00Z'));
    try {
      const now = new Date();
      const c = await caller();
      for (const status of ['scheduled', 'awaiting_scorecard', 'completed', 'cancelled', 'no_show']) {
        m.interviewFindMany.mockClear();
        await c.interview.list({ status, pageSize: 20 });
        expect(m.interviewFindMany.mock.calls[0]![0].where.AND).toContainEqual(interviewStatusFilterWhere(status, now));
      }
      expect(interviewStatusFilterWhere('scheduled', now)).toEqual({
        AND: [{ status: 'scheduled' }, { scheduledAt: { gt: now } }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('KPI counts: only with statusCounts, across all dates and statuses, following the type filter', async () => {
    m.interviewCount.mockResolvedValueOnce(9).mockResolvedValueOnce(4).mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const c = await caller();
    const res = await c.interview.list({
      statusCounts: true,
      type: 'onsite',
      status: 'cancelled',
      from: new Date('2026-11-10T00:00:00Z'),
      openOnly: true,
      pageSize: 1,
    });
    expect(res.statusCounts).toEqual({ scheduled: 4, completed: 3, cancelled: 2 });
    expect(res.total).toBe(9);
    expect(m.interviewCount).toHaveBeenCalledTimes(4);
    for (const call of m.interviewCount.mock.calls.slice(1)) {
      const kpiWhere = JSON.stringify(call[0].where);
      expect(kpiWhere).toContain(`"organizationId":"${ORG_ID}"`);
      expect(kpiWhere).toContain('"type":"onsite"');
      expect(kpiWhere).not.toContain('"gte"'); // no date window
      expect(kpiWhere).not.toContain('"status":"cancelled"},{"status"'); // not the list's status filter
    }
    expect(JSON.stringify(m.interviewCount.mock.calls[3]![0].where)).toContain('"status":"cancelled"');

    m.interviewCount.mockClear();
    const plain = await c.interview.list({ pageSize: 20 });
    expect(plain.statusCounts).toBeNull();
    expect(m.interviewCount).toHaveBeenCalledTimes(1);
  });

  it('rows carry only a COUNT of submitted scorecards, never their content', async () => {
    await (await caller()).interview.list({ pageSize: 20 });
    const include = m.interviewFindMany.mock.calls[0]![0].include;
    expect(include._count).toEqual({ select: { scorecards: { where: { submittedAt: { not: null } } } } });
    expect(include).not.toHaveProperty('scorecards');
  });
});

describe('A-02 — "No se presentó" (interview.cancel, outcome no_show)', () => {
  beforeEach(() => {
    m.scope = 'organization';
  });

  it('the write takes the row lock, THEN submitted cards are counted; join link revoked; no email', async () => {
    const before = Date.now();
    const res = await (await caller()).interview.cancel({ id: INTERVIEW_ID, outcome: 'no_show' });
    expect(res).toEqual({ id: INTERVIEW_ID, status: 'no_show' });
    const args = m.txInterviewUpdateMany.mock.calls[0]![0];
    expect(args.where).toMatchObject({
      id: INTERVIEW_ID,
      organizationId: ORG_ID,
      status: { in: ['scheduled', 'rescheduled', 'confirmed', 'in_progress'] },
    });
    expect(args.where.scheduledAt.lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.data).toEqual({ status: 'no_show', candidateJoinTokenHash: null, candidateJoinTokenExpiresAt: null });
    // The card count is a separate statement AFTER the locking write (it must see a card committed by a
    // submission that held the lock first), org-filtered, submitted cards only.
    expect(m.txCardCount.mock.calls[0]![0].where).toEqual({
      organizationId: ORG_ID,
      interviewId: INTERVIEW_ID,
      submittedAt: { not: null },
    });
    expect(m.txInterviewUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(m.txCardCount.mock.invocationCallOrder[0]!);
    expect(m.txOutcome).toEqual(['committed']);
    expect(m.interviewUpdate).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('CONFLICT when nothing matched (not started, or already closed / completed)', async () => {
    m.txInterviewUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect((await caller()).interview.cancel({ id: INTERVIEW_ID, outcome: 'no_show' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(m.txCardCount).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('CONFLICT when a submitted scorecard exists: the count refuses AFTER the write, so it must throw (roll back)', async () => {
    m.txCardCount.mockResolvedValueOnce(1);
    await expect((await caller()).interview.cancel({ id: INTERVIEW_ID, outcome: 'no_show' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // The no_show write had run inside the transaction; only a throw out of the callback undoes it.
    expect(m.txInterviewUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.txCardCount).toHaveBeenCalledTimes(1);
    expect(m.txOutcome).toEqual(['rolled_back']);
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('a plain cancel still needs its reason, and still notifies', async () => {
    const c = await caller();
    await expect(c.interview.cancel({ id: INTERVIEW_ID } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await c.interview.cancel({ id: INTERVIEW_ID, cancelReason: 'x' });
    expect(m.interviewUpdate.mock.calls[0]![0].data).toMatchObject({ status: 'cancelled', cancelReason: 'x' });
    expect(m.txInterviewUpdateMany).not.toHaveBeenCalled();
    // The email path runs in this harness, so "no email" on a no-show above is not vacuous.
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancel', interviewId: INTERVIEW_ID }));
  });
});

describe('reschedule serializes with scorecard submission (#405 review)', () => {
  beforeEach(() => {
    m.scope = 'organization';
    m.interviewFindFirst.mockResolvedValue({
      id: INTERVIEW_ID,
      status: 'scheduled',
      type: 'onsite',
      duration: 60,
      meetingUrl: null,
      scheduledAt: new Date('2026-11-10T16:00:00Z'),
    });
  });
  const input = { id: INTERVIEW_ID, scheduledAt: new Date('2026-11-12T16:00:00Z') };

  it('writes under the row lock, then counts submitted cards; notifies when it went through', async () => {
    await (await caller()).interview.reschedule(input);
    const args = m.txInterviewUpdateMany.mock.calls[0]![0];
    expect(args.where).toEqual({ id: INTERVIEW_ID, organizationId: ORG_ID, status: { notIn: ['cancelled', 'completed'] } });
    expect(args.data).toMatchObject({ scheduledAt: input.scheduledAt, status: 'rescheduled' });
    expect(m.txInterviewUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(m.txCardCount.mock.invocationCallOrder[0]!);
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update' }));
  });

  it('CONFLICT, no email, when the interview already has a submitted scorecard', async () => {
    m.txCardCount.mockResolvedValueOnce(2);
    await expect((await caller()).interview.reschedule(input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(m.txOutcome).toEqual(['rolled_back']); // the reschedule write is undone, not left behind
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('BAD_REQUEST, no email, when it was cancelled or completed after the guard read', async () => {
    m.txInterviewUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect((await caller()).interview.reschedule(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(m.txCardCount).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
});
