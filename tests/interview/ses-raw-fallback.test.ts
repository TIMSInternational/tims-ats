import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs the REAL lib/ses + lib/circuit-breaker + interview-email.service; only the AWS SDK transport and
// the notification read are faked. Proves a raw-send problem can no longer open the shared SES breaker.

const INTERVIEW_ID = '22222222-2222-2222-2222-222222222222';

const m = vi.hoisted(() => ({
  send: vi.fn(),
  findForNotification: vi.fn(),
}));

// Mocked by its RESOLVED location: lib/ses.ts imports the copy under packages/api/node_modules (pnpm), and a
// bare '@aws-sdk/client-ses' mock from the repo root does not intercept it — the real SDK then really calls
// SES with whatever credentials the machine has (observed while writing this test).
vi.mock('../../packages/api/node_modules/@aws-sdk/client-ses', () => ({
  SESClient: class {
    send = m.send;
  },
  SendEmailCommand: class {
    readonly kind = 'plain';
    constructor(readonly input: unknown) {}
  },
  SendRawEmailCommand: class {
    readonly kind = 'raw';
    constructor(readonly input: unknown) {}
  },
}));
vi.mock('@tims/shared', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  getAppUrl: () => 'https://ats.example.test',
}));
vi.mock('../../packages/api/src/repositories/interview-email.repository', () => ({
  interviewEmailRepository: { findForNotification: m.findForNotification },
}));

function sdkError(name: string): Error {
  const error = new Error(`${name}: not for logs`);
  error.name = name;
  return error;
}

function notificationData() {
  return {
    org: { name: 'Acme', billingEmail: 'hr@acme.test' },
    interview: {
      id: INTERVIEW_ID,
      type: 'video',
      status: 'scheduled',
      scheduledAt: new Date('2026-10-01T15:00:00Z'),
      duration: 60,
      location: null,
      meetingUrl: null,
      cancelReason: null,
      updatedAt: new Date('2026-09-29T10:00:00Z'),
      candidate: { firstName: 'Ana', lastName: 'Gómez', email: 'ana@example.com' },
      vacancy: { title: 'Analista', company: { language: 'es', timezone: 'America/Bogota' } },
      evaluators: [
        {
          user: {
            id: '55555555-5555-5555-5555-555555555555',
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

type Command = { kind: 'plain' | 'raw' };
const calls = (kind: Command['kind']) => m.send.mock.calls.filter(([command]) => (command as Command).kind === kind);

async function load() {
  vi.resetModules();
  const breakers = await import('../../packages/api/src/lib/circuit-breaker');
  const ses = await import('../../packages/api/src/lib/ses');
  const { interviewEmailService } = await import('../../packages/api/src/services/interview-email.service');
  return { ...breakers, ...ses, interviewEmailService };
}

async function notifyTimes(service: { notify: (p: never) => Promise<void> }, n: number) {
  for (let i = 0; i < n; i++) {
    await service.notify({
      orgId: '11111111-1111-1111-1111-111111111111',
      interviewId: INTERVIEW_ID,
      kind: 'invite',
      candidateJoinToken: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde',
    } as never);
  }
}

beforeEach(() => {
  // Belt and braces: if the SDK mock ever stops intercepting, fail on bogus credentials, never send mail.
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-not-a-key');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-not-a-secret');
  vi.stubEnv('AWS_PROFILE', '');
  m.send.mockReset();
  m.findForNotification.mockReset();
  m.findForNotification.mockResolvedValue(notificationData());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('raw SES sends do not share the general breaker', () => {
  it('N raw AccessDenied answers: every recipient still gets the plain email and other mail keeps flowing', async () => {
    const { interviewEmailService, sesCircuit, sesRawCircuit, sendEmail } = await load();
    m.send.mockImplementation(async (command: Command) => {
      if (command.kind === 'raw') throw sdkError('AccessDenied');
      return {};
    });

    await notifyTimes(interviewEmailService, 5); // 5 events × (candidate + evaluator) = 10 messages

    expect(calls('plain')).toHaveLength(10);
    // The denial is cached per instance: only the first event's two concurrent sends reach SES, not all 10.
    expect(calls('raw')).toHaveLength(2);
    expect(sesCircuit.getState()).toEqual({ state: 'closed', failures: 0 });
    expect(sesRawCircuit.getState()).toEqual({ state: 'closed', failures: 0 });

    // Any other SES user (offers, application-received, …) is unaffected.
    expect(await sendEmail({ to: 'x@example.com', subject: 's', html: '<p>h</p>' })).toBe(true);
  });

  it('asks SES again once the denial cache expires (picks up a new ses:SendRawEmail grant)', async () => {
    vi.useFakeTimers();
    try {
      const { interviewEmailService, RAW_DENIED_CACHE_MS } = await load();
      let granted = false;
      m.send.mockImplementation(async (command: Command) => {
        if (command.kind === 'raw' && !granted) throw sdkError('AccessDenied');
        return {};
      });
      await notifyTimes(interviewEmailService, 1);
      expect([calls('raw').length, calls('plain').length]).toEqual([2, 2]);
      granted = true; // ses:SendRawEmail granted out of band
      await notifyTimes(interviewEmailService, 1);
      expect([calls('raw').length, calls('plain').length]).toEqual([2, 4]); // still cached
      vi.advanceTimersByTime(RAW_DENIED_CACHE_MS + 1);
      await notifyTimes(interviewEmailService, 1);
      expect([calls('raw').length, calls('plain').length]).toEqual([4, 4]); // raw again, with .ics
    } finally {
      vi.useRealTimers();
    }
  });

  it('transient raw failures open only the raw breaker; the plain fallback and other mail still send', async () => {
    const { interviewEmailService, sesCircuit, sesRawCircuit, sendEmail } = await load();
    m.send.mockImplementation(async (command: Command) => {
      if (command.kind === 'raw') throw sdkError('Throttling');
      return {};
    });

    // 2 events × 2 concurrent raw sends = 4 failures ≥ threshold 3: the RAW breaker opens. A single failed
    // raw send is NOT re-sent plain (SES may have accepted it).
    await notifyTimes(interviewEmailService, 2);
    expect(sesRawCircuit.getState().state).toBe('open');
    expect(calls('raw')).toHaveLength(4);
    expect(calls('plain')).toHaveLength(0);

    // While the raw breaker is open, interview mail goes out plain instead of being dropped.
    await notifyTimes(interviewEmailService, 1);
    expect(calls('raw')).toHaveLength(4);
    expect(calls('plain')).toHaveLength(2);

    expect(sesCircuit.getState()).toEqual({ state: 'closed', failures: 0 });
    expect(await sendEmail({ to: 'x@example.com', subject: 's', html: '<p>h</p>' })).toBe(true);
  });
});
