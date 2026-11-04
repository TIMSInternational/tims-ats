import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pilot interview fixes on the server side:
//  - B-05: a panelist (committee, team scope, sees the interview only through the panel arm) cannot
//    cancel, reschedule or change the panel; whoever manages the vacancy still can.
//  - A-16: interview.list can list the most recent first (past interviews), so new ones never fall off.
//  - A-17: interview.list carries the zone the schedule modal books in (the organization's, else UTC).
//  - F-10: interview.getById carries the scorecard competencies (committee has no vacancy:read).
// No procedure is added: the tRPC surface is ratcheted (tests/governance/trpc-procedure-ratchet.test.ts).
//  - B-29: getPendingScorecards lists only interviews that have started.

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
  evaluatorDeleteMany: vi.fn(),
  evaluatorFindMany: vi.fn(),
  orgFindFirst: vi.fn(),
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
    organization: { findFirst: m.orgFindFirst },
    jobProfile: { findFirst: m.jobProfileFindFirst },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runTenantTransaction: (_org: string, fn: (tx: unknown) => unknown) =>
    fn({ user: { findFirst: m.txUserFind }, interviewEvaluator: { create: m.txEvaluatorCreate } }),
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
  m.evaluatorDeleteMany.mockResolvedValue({ count: 1 });
  m.txUserFind.mockResolvedValue({ id: OTHER_ID });
  m.txEvaluatorCreate.mockResolvedValue({ id: 'ie-1' });
  m.notify.mockResolvedValue(undefined);
});

describe('B-05 — a panelist cannot manage the interview they sit on', () => {
  const attempts = {
    cancel: (c: Awaited<ReturnType<typeof caller>>) => c.interview.cancel({ id: INTERVIEW_ID, cancelReason: 'x' }),
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
