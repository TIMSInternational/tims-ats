import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { hashJoinToken } from '../../packages/api/src/services/interview-join-token';
import { parseMime } from '../helpers/mime-parse';

// #312 consent guard: active consent unless a test says otherwise.
const consentWithdrawnMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: {
    isRecruitmentConsentWithdrawn: consentWithdrawnMock,
    withdrawnCandidateIds: vi.fn(async () => new Set<string>()),
  },
}));

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const INTERVIEW_ID = '22222222-2222-4222-8222-222222222222';
const CANDIDATE_ID = '33333333-3333-4333-8333-333333333333';
const VACANCY_ID = '44444444-4444-4444-8444-444444444444';
const EVAL_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const APP = 'https://ats.example.test';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findInterview: vi.fn(),
  userCount: vi.fn(),
  findApp: vi.fn(),
  findForNotification: vi.fn(),
  sendRaw: vi.fn(),
  sendPlain: vi.fn(),
  txUserFind: vi.fn(),
  txEvaluatorCreate: vi.fn(),
  // reschedule writes inside a transaction, under the interview row lock (interview-manage.repository.ts)
  txInterviewUpdateMany: vi.fn(
    async (_args: { where: unknown; data: { candidateJoinTokenHash: string; candidateJoinTokenExpiresAt: Date } }) => ({
      count: 1,
    }),
  ),
  txCardCount: vi.fn(async () => 0),
  txInterviewFind: vi.fn(async (_args: { omit?: unknown }) => ({ id: 'rescheduled-interview' })),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    interview: { create: m.create, update: m.update, findFirst: m.findInterview },
    user: { count: m.userCount },
    application: { findFirst: m.findApp },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runTenantTransaction: (_org: string, fn: (tx: unknown) => unknown) =>
    fn({
      user: { findFirst: m.txUserFind },
      interviewEvaluator: { create: m.txEvaluatorCreate },
      interview: { updateMany: m.txInterviewUpdateMany, findFirst: m.txInterviewFind },
      interviewScorecard: { count: m.txCardCount },
    }),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertScoped: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/api/src/repositories/interview-email.repository', () => ({
  interviewEmailRepository: { findForNotification: m.findForNotification },
}));
vi.mock('../../packages/api/src/lib/ses', () => ({
  sendRawEmail: m.sendRaw,
  sendEmail: m.sendPlain,
  getEmailFromAddress: () => 'TIMS <noreply@tims.example>',
}));

type Row = { type: string; status?: string; updatedAt?: Date; cancelReason?: string | null; meetingUrl?: string | null };
function notificationData(row: Row) {
  return {
    org: { name: 'Acme', billingEmail: 'hr@acme.test' },
    interview: {
      id: INTERVIEW_ID,
      type: row.type,
      status: row.status ?? 'scheduled',
      scheduledAt: new Date('2026-10-01T15:00:00Z'),
      duration: 60,
      location: row.type === 'onsite' ? 'Calle 1, Bogotá' : null,
      meetingUrl: row.meetingUrl ?? null,
      cancelReason: row.cancelReason ?? null,
      updatedAt: row.updatedAt ?? new Date('2026-09-29T10:00:00Z'),
      candidate: { firstName: 'Ana', lastName: 'Gómez', email: 'ana@example.com' },
      vacancy: { title: 'Analista', company: { language: 'es', timezone: 'America/Bogota' } },
      evaluators: [
        {
          user: {
            id: EVAL_ID,
            firstName: 'Eva',
            lastName: 'Lu',
            email: 'eva@acme.test',
            locale: 'en',
            timezone: 'America/New_York',
            isActive: true,
          },
        },
      ],
    },
  };
}

async function caller(runAfterResponse?: (task: () => Promise<void>) => void) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { interviewCrudRouter } = await import('../../packages/api/src/routers/interview/crud');
  return createCallerFactory(router({ interview: interviewCrudRouter }))({
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
    ...(runAfterResponse ? { runAfterResponse } : {}),
  } as never);
}

type Sent = { to: string; raw: string };
const sent = (): Sent[] => m.sendRaw.mock.calls.map((c) => c[0] as Sent);
const partsFor = (to: string) => parseMime(sent().find((s) => s.to === to)?.raw ?? '');
const body = (to: string, kind: 'text/html' | 'text/plain' | 'text/calendar') =>
  partsFor(to).find((p) => p.contentType.startsWith(kind))?.body ?? '';

const scheduleInput = {
  candidateId: CANDIDATE_ID,
  vacancyId: VACANCY_ID,
  type: 'video',
  scheduledAt: new Date('2026-10-01T15:00:00Z'),
  duration: 60,
  evaluatorIds: [EVAL_ID],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = APP;
  m.userCount.mockResolvedValue(1);
  m.findApp.mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' });
  m.create.mockResolvedValue({ id: INTERVIEW_ID });
  m.update.mockResolvedValue({ id: INTERVIEW_ID });
  m.sendRaw.mockResolvedValue({ sent: true });
  m.sendPlain.mockResolvedValue(true);
  m.txUserFind.mockResolvedValue({ id: EVAL_ID });
  m.txEvaluatorCreate.mockResolvedValue({ id: 'ie-new' });
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe('interview.schedule — join token + invitation emails', () => {
  it('persists only the SHA-256 of a video join token and emails the candidate the matching link', async () => {
    m.findForNotification.mockResolvedValue(notificationData({ type: 'video' }));
    await (await caller()).interview.schedule(scheduleInput);

    const data = m.create.mock.calls[0][0].data;
    expect(data.candidateJoinTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.candidateJoinTokenExpiresAt.toISOString()).toBe('2026-10-01T16:30:00.000Z');
    expect(m.create.mock.calls[0][0].omit).toEqual({ candidateJoinTokenHash: true, candidateJoinTokenExpiresAt: true });

    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    const html = body('ana@example.com', 'text/html');
    const link = new RegExp(`${APP}/interview/join/([A-Za-z0-9_-]{43})`).exec(html);
    expect(link).not.toBeNull();
    expect(hashJoinToken(link?.[1] as string)).toBe(data.candidateJoinTokenHash);
    expect(html).toContain('Videoconferencia');
    expect(html).not.toMatch(/>video</);
    const ics = body('ana@example.com', 'text/calendar');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain(`UID:interview-${INTERVIEW_ID}@ats.example.test`);
    expect(ics.replace(/\r\n /g, '')).toContain('ATTENDEE;CN="Ana Gómez"');
  });

  it('sends each evaluator the STAFF room link, their own ATTENDEE, and never the candidate token', async () => {
    m.findForNotification.mockResolvedValue(notificationData({ type: 'video' }));
    await (await caller()).interview.schedule(scheduleInput);
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));

    const html = body('eva@acme.test', 'text/html');
    expect(html).toContain(`${APP}/recruitment/interviews/${INTERVIEW_ID}/room`);
    expect(html).toContain('Video call'); // evaluator locale = en
    const raw = sent().find((s) => s.to === 'eva@acme.test')?.raw ?? '';
    const everything = parseMime(raw)
      .map((p) => p.body)
      .join('\n');
    expect(everything).not.toContain('/interview/join/');
    const ics = body('eva@acme.test', 'text/calendar').replace(/\r\n /g, '');
    expect(ics).toContain('mailto:eva@acme.test');
    expect(ics).not.toContain('mailto:ana@example.com');
  });

  it('does not mint a token or a join link for a non-video interview', async () => {
    m.findForNotification.mockResolvedValue(notificationData({ type: 'onsite' }));
    await (await caller()).interview.schedule({ ...scheduleInput, type: 'onsite', location: 'Calle 1, Bogotá' });
    expect(m.create.mock.calls[0][0].data.candidateJoinTokenHash).toBeNull();
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    const html = body('ana@example.com', 'text/html');
    expect(html).toContain('Presencial');
    expect(html).toContain('Calle 1, Bogotá');
    expect(html).not.toContain('/interview/join/');
  });

  it('keeps an external meeting link on a video interview: no token, the link is emailed to everyone', async () => {
    const zoom = 'https://zoom.us/j/123456789';
    m.findForNotification.mockResolvedValue(notificationData({ type: 'video', meetingUrl: zoom }));
    await (await caller()).interview.schedule({ ...scheduleInput, meetingUrl: zoom });
    expect(m.create.mock.calls[0][0].data.candidateJoinTokenHash).toBeNull();
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    for (const to of ['ana@example.com', 'eva@acme.test']) {
      const html = body(to, 'text/html');
      expect(html).toContain(zoom);
      expect(html).not.toContain('/interview/join/');
      expect(body(to, 'text/calendar').replace(/\r\n /g, '')).toContain(`LOCATION:${zoom}`);
    }
    // B-06: the candidate never sees the staff room; the evaluator always gets the TIMS scorecard link.
    expect(body('ana@example.com', 'text/html')).not.toContain('/room');
    expect(body('eva@acme.test', 'text/html')).toContain(`${APP}/recruitment/interviews/${INTERVIEW_ID}/room`);
  });

  it("never emails the interview's own private Daily room URL (dead without a meeting token)", async () => {
    const own = `https://tims.daily.co/tims-${INTERVIEW_ID.replace(/-/g, '')}`;
    m.findForNotification.mockResolvedValue(notificationData({ type: 'video', meetingUrl: own }));
    m.findInterview.mockResolvedValue({
      id: INTERVIEW_ID,
      type: 'video',
      status: 'scheduled',
      scheduledAt: new Date('2026-10-01T15:00:00Z'),
      duration: 60,
      location: null,
      meetingUrl: own,
    });
    await (await caller()).interview.reschedule({ id: INTERVIEW_ID, scheduledAt: new Date('2026-10-02T15:00:00Z') });
    expect(m.txInterviewUpdateMany.mock.calls[0]![0].data.candidateJoinTokenHash).toMatch(/^[0-9a-f]{64}$/);
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    expect(body('ana@example.com', 'text/html')).toContain('/interview/join/');
    expect(body('eva@acme.test', 'text/html')).toContain(`/recruitment/interviews/${INTERVIEW_ID}/room`);
    for (const to of ['ana@example.com', 'eva@acme.test']) {
      expect(sent().find((s) => s.to === to)?.raw).not.toContain('daily.co');
    }
  });

  it('without a fresh token, the own private Daily room URL is still never emailed', async () => {
    // A notify() without a plaintext token (e.g. an update that did not re-mint) must not fall back to the
    // raw Daily room URL: it is a dead link for the candidate and needless exposure of the room.
    const { buildInterviewEmails } = await import('../../packages/api/src/services/interview-email.service');
    const own = `https://tims.daily.co/tims-${INTERVIEW_ID.replace(/-/g, '')}`;
    const { messages, skipped } = buildInterviewEmails(
      notificationData({ type: 'video', meetingUrl: own }) as never,
      { orgId: ORG_ID, interviewId: INTERVIEW_ID, kind: 'update', candidateJoinToken: null },
      APP,
    );
    expect(skipped).toBe(0);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(`${message.html}${message.text}${message.ics}`).not.toContain('daily.co');
    }
  });

  it('still returns the interview when every email send fails', async () => {
    m.findForNotification.mockRejectedValue(new Error('db down'));
    await expect((await caller()).interview.schedule(scheduleInput)).resolves.toMatchObject({ id: INTERVIEW_ID });
  });
});

describe('interview.reschedule / cancel', () => {
  const existing = {
    id: INTERVIEW_ID,
    type: 'video',
    status: 'scheduled',
    scheduledAt: new Date('2026-10-01T15:00:00Z'),
    duration: 60,
    location: null,
    meetingUrl: null,
  };

  it('regenerates the token on reschedule and sends an updated REQUEST with a higher SEQUENCE', async () => {
    m.findInterview.mockResolvedValue(existing);
    m.findForNotification.mockResolvedValueOnce(
      notificationData({ type: 'video', updatedAt: new Date('2026-09-29T10:00:00Z') }),
    );
    const c = await caller();
    await c.interview.schedule(scheduleInput);
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    const firstHash = m.create.mock.calls[0][0].data.candidateJoinTokenHash;
    const firstIcs = body('ana@example.com', 'text/calendar');
    m.sendRaw.mockClear();

    m.findForNotification.mockResolvedValueOnce(
      notificationData({ type: 'video', updatedAt: new Date('2026-09-29T11:00:00Z') }),
    );
    await c.interview.reschedule({ id: INTERVIEW_ID, scheduledAt: new Date('2026-10-02T15:00:00Z'), duration: 30 });
    // The pre-update read selects only the fields it uses — never the stored join-token hash.
    const read = m.findInterview.mock.calls.at(-1)![0];
    expect(read.select).toEqual({
      id: true,
      status: true,
      type: true,
      duration: true,
      meetingUrl: true,
      scheduledAt: true,
    });
    const data = m.txInterviewUpdateMany.mock.calls[0]![0].data;
    // The read after the locked write never returns the join-token columns either.
    expect(m.txInterviewFind.mock.calls[0]![0].omit).toEqual({
      candidateJoinTokenHash: true,
      candidateJoinTokenExpiresAt: true,
    });
    expect(data.candidateJoinTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.candidateJoinTokenHash).not.toBe(firstHash);
    expect(data.candidateJoinTokenExpiresAt.toISOString()).toBe('2026-10-02T16:00:00.000Z');

    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    const ics = body('ana@example.com', 'text/calendar');
    const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)?.[1]);
    expect(ics).toContain('METHOD:REQUEST');
    expect(seq(ics)).toBeGreaterThan(seq(firstIcs));
    const uid = (s: string) => /UID:([^\r\n]+)/.exec(s)?.[1];
    expect(uid(ics)).toBe(uid(firstIcs));
    const link = /\/interview\/join\/([A-Za-z0-9_-]{43})/.exec(body('ana@example.com', 'text/html'));
    expect(hashJoinToken(link?.[1] as string)).toBe(data.candidateJoinTokenHash);
  });

  it('clears the token on cancel and sends METHOD:CANCEL to candidate and evaluators', async () => {
    m.findForNotification.mockResolvedValue(
      notificationData({ type: 'video', status: 'cancelled', cancelReason: 'Vacante cerrada' }),
    );
    await (await caller()).interview.cancel({ id: INTERVIEW_ID, cancelReason: 'Vacante cerrada' });
    const data = m.update.mock.calls[0][0].data;
    expect(data.candidateJoinTokenHash).toBeNull();
    expect(data.candidateJoinTokenExpiresAt).toBeNull();

    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    for (const to of ['ana@example.com', 'eva@acme.test']) {
      const ics = body(to, 'text/calendar');
      expect(ics).toContain('METHOD:CANCEL');
      expect(ics).toContain('STATUS:CANCELLED');
      expect(partsFor(to).find((p) => p.contentType.startsWith('text/calendar'))?.contentType).toContain(
        'method=CANCEL',
      );
      expect(body(to, 'text/html')).not.toContain('/interview/join/');
    }
  });

  it('falls back to a plain email when the role lacks ses:SendRawEmail', async () => {
    m.sendRaw.mockResolvedValue({ sent: false, errorName: 'AccessDeniedException', reason: 'denied' });
    m.findForNotification.mockResolvedValue(notificationData({ type: 'video' }));
    await (await caller()).interview.schedule(scheduleInput);
    await vi.waitFor(() => expect(m.sendPlain).toHaveBeenCalledTimes(2));
    const candidate = m.sendPlain.mock.calls.find((c) => c[0].to === 'ana@example.com')?.[0];
    expect(candidate.html).toContain('/interview/join/');
  });
});

describe('interview emails run under the post-response scheduler (Vercel freeze, proof run 2026-11-03)', () => {
  // A bare `void notify()` was frozen by the serverless runtime once the response was sent: the SES call
  // resumed 51 s later and its 8 s AbortSignal fired, so nothing was delivered. Each mutation must hand the
  // send to ctx.runAfterResponse (Next after()) and send nothing before the scheduler runs it.
  const existing = {
    id: INTERVIEW_ID,
    type: 'video',
    status: 'scheduled',
    scheduledAt: new Date('2026-10-01T15:00:00Z'),
    duration: 60,
    location: null,
    meetingUrl: null,
  };

  it('schedule: hands the invitation to the scheduler and sends only when it runs', async () => {
    m.findForNotification.mockResolvedValue(notificationData({ type: 'video' }));
    const tasks: Array<() => Promise<void>> = [];
    await (await caller((t) => tasks.push(t))).interview.schedule(scheduleInput);

    expect(tasks).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(m.findForNotification).not.toHaveBeenCalled();
    expect(m.sendRaw).not.toHaveBeenCalled();
    await tasks[0]!();
    expect(m.sendRaw).toHaveBeenCalledTimes(2);
  });

  it('reschedule: hands the updated invitation to the scheduler', async () => {
    m.findInterview.mockResolvedValue(existing);
    m.findForNotification.mockResolvedValue(notificationData({ type: 'video' }));
    const tasks: Array<() => Promise<void>> = [];
    await (await caller((t) => tasks.push(t))).interview.reschedule({
      id: INTERVIEW_ID,
      scheduledAt: new Date('2026-10-02T15:00:00Z'),
      duration: 30,
    });

    expect(tasks).toHaveLength(1);
    expect(m.sendRaw).not.toHaveBeenCalled();
    await tasks[0]!();
    expect(m.sendRaw).toHaveBeenCalledTimes(2);
  });

  it('cancel: hands the cancellation to the scheduler', async () => {
    m.findInterview.mockResolvedValue(existing);
    m.findForNotification.mockResolvedValue(
      notificationData({ type: 'video', status: 'cancelled', cancelReason: 'Vacante cerrada' }),
    );
    const tasks: Array<() => Promise<void>> = [];
    await (await caller((t) => tasks.push(t))).interview.cancel({ id: INTERVIEW_ID, cancelReason: 'Vacante cerrada' });

    expect(tasks).toHaveLength(1);
    expect(m.sendRaw).not.toHaveBeenCalled();
    await tasks[0]!();
    expect(m.sendRaw).toHaveBeenCalledTimes(2);
  });

  it('a scheduler that throws (after() outside a request) falls back to a detached send', async () => {
    m.findForNotification.mockResolvedValue(notificationData({ type: 'video' }));
    await (await caller(() => {
      throw new Error('after() called outside a request scope');
    })).interview.schedule(scheduleInput);

    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
  });
});

describe('interview.schedule — candidate consent withdrawn (#312)', () => {
  it('tells staff the candidate was not notified', async () => {
    m.findForNotification.mockResolvedValue(notificationData({ type: 'onsite' }));
    consentWithdrawnMock.mockResolvedValueOnce(true);
    const created = await (await caller()).interview.schedule({ ...scheduleInput, type: 'onsite' });
    expect(created).toMatchObject({ id: INTERVIEW_ID, candidateNotNotifiedReason: 'consent_withdrawn' });
  });

  it('is null when consent is active', async () => {
    m.findForNotification.mockResolvedValue(notificationData({ type: 'onsite' }));
    const created = await (await caller()).interview.schedule({ ...scheduleInput, type: 'onsite' });
    expect(created).toMatchObject({ candidateNotNotifiedReason: null });
  });
});

describe('candidate contact + Reply-To (C-12)', () => {
  const withContact = (org: Record<string, unknown>) => ({ ...notificationData({ type: 'onsite' }), org });

  it("names the organization's configured candidate contact and replies to it", async () => {
    m.findForNotification.mockResolvedValue(
      withContact({ name: 'Acme', billingEmail: 'billing@acme.test', settings: { candidateContactEmail: 'talento@acme.test' } }),
    );
    await (await caller()).interview.schedule({ ...scheduleInput, type: 'onsite' });
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    expect(body('ana@example.com', 'text/html')).toContain('mailto:talento@acme.test');
    const candidateRaw = sent().find((s) => s.to === 'ana@example.com')?.raw ?? '';
    expect(candidateRaw).toMatch(/^Reply-To: talento@acme\.test\r$/m);
    // Evaluators are staff: no candidate-contact Reply-To on their copy.
    expect(sent().find((s) => s.to === 'eva@acme.test')?.raw).not.toMatch(/^Reply-To:/m);
  });

  it('falls back to the billing email, and with neither omits the line — never a vendor mailbox', async () => {
    m.findForNotification.mockResolvedValue(withContact({ name: 'Acme', billingEmail: 'billing@acme.test', settings: {} }));
    await (await caller()).interview.schedule({ ...scheduleInput, type: 'onsite' });
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    expect(body('ana@example.com', 'text/html')).toContain('mailto:billing@acme.test');
    m.sendRaw.mockClear();

    m.findForNotification.mockResolvedValue(withContact({ name: 'Acme', billingEmail: null, settings: null }));
    await (await caller()).interview.schedule({ ...scheduleInput, type: 'onsite' });
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(2));
    const html = body('ana@example.com', 'text/html');
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('timsinternational');
    expect(sent().find((s) => s.to === 'ana@example.com')?.raw).not.toMatch(/^Reply-To:/m);
  });

  it('the plain fallback keeps the Reply-To and drops the "calendar attached" sentence (C-21)', async () => {
    m.sendRaw.mockResolvedValue({ sent: false, errorName: 'AccessDeniedException', reason: 'denied' });
    m.findForNotification.mockResolvedValue(
      withContact({ name: 'Acme', billingEmail: null, settings: { candidateContactEmail: 'talento@acme.test' } }),
    );
    await (await caller()).interview.schedule({ ...scheduleInput, type: 'onsite' });
    await vi.waitFor(() => expect(m.sendPlain).toHaveBeenCalledTimes(2));
    const candidate = m.sendPlain.mock.calls.find((c) => c[0].to === 'ana@example.com')?.[0];
    expect(candidate.replyTo).toBe('talento@acme.test');
    expect(candidate.html).not.toContain('.ics');
    const evaluator = m.sendPlain.mock.calls.find((c) => c[0].to === 'eva@acme.test')?.[0];
    expect(evaluator.replyTo).toBeNull();
  });
});

describe('interview.addEvaluator — a late panelist is invited (B-06)', () => {
  it('emails ONLY the added evaluator, with the scorecard link; not the candidate, not the others', async () => {
    const data = notificationData({ type: 'onsite' });
    data.interview.evaluators.push({
      user: { id: 'other-eval', firstName: 'Otro', lastName: 'Panel', email: 'otro@acme.test', locale: 'es', timezone: 'UTC', isActive: true },
    });
    m.findForNotification.mockResolvedValue(data);
    const result = await (await caller()).interview.addEvaluator({ interviewId: INTERVIEW_ID, userId: EVAL_ID });
    expect(result).toEqual({ id: 'ie-new' });
    await vi.waitFor(() => expect(m.sendRaw).toHaveBeenCalledTimes(1));
    expect(sent().map((s) => s.to)).toEqual(['eva@acme.test']);
    expect(body('eva@acme.test', 'text/html')).toContain(`${APP}/recruitment/interviews/${INTERVIEW_ID}/room`);
  });

  it('sends nothing for an interview that was cancelled', async () => {
    m.findForNotification.mockResolvedValue(notificationData({ type: 'onsite', status: 'cancelled' }));
    const tasks: Array<() => Promise<void>> = [];
    await (await caller((t) => tasks.push(t))).interview.addEvaluator({ interviewId: INTERVIEW_ID, userId: EVAL_ID });
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(m.sendRaw).not.toHaveBeenCalled();
  });
});
