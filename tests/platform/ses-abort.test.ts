/**
 * lib/ses.ts must hand the caller's abortSignal to the SES SDK, or every timeout bound in the email
 * services is decorative. Only the AWS SDK transport and the logger are faked: lib/ses, lib/circuit-breaker
 * and email.service are real.
 *
 * Every assertion runs AFTER the call, in the test body. (An earlier version asserted inside the mocked
 * `send`, whose throw sendEmail swallows into `false` — so it could not fail. #332 panel, M1.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
// Mocked by its RESOLVED location (see tests/interview/ses-raw-fallback.test.ts): lib/ses.ts imports the
// copy under packages/api/node_modules, and a bare '@aws-sdk/client-ses' mock does not intercept it.
vi.mock('../../packages/api/node_modules/@aws-sdk/client-ses', () => ({
  SESClient: class {
    send = mocks.send;
  },
  SendEmailCommand: class {},
  SendRawEmailCommand: class {},
}));
vi.mock('@tims/shared', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

type SendOptions = { abortSignal?: AbortSignal } | undefined;

/** An SES call that only settles when its signal aborts; with no signal it fails at once (never hangs). */
function sesHangsUntilAborted() {
  mocks.send.mockImplementation((_command: unknown, options: SendOptions) => {
    const signal = options?.abortSignal;
    if (!signal) return Promise.reject(new Error('test: SES send called without an abortSignal'));
    if (signal.aborted) return Promise.reject(new Error('Aborted'));
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted'))));
  });
}

/** AbortSignal.timeout driven by the (fake) setTimeout, so the test controls when it fires. */
function timeoutOnFakeTimers() {
  return vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
}

const offer = {
  candidateEmail: 'qa@example.test',
  candidateName: 'QA Candidate',
  vacancyTitle: 'QA role',
  companyName: 'Example Company',
  signingUrl: 'https://example.test/offers/sign/token',
  expiresAt: null,
};

beforeEach(() => {
  vi.resetModules();
  mocks.send.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('lib/ses abort signal', () => {
  it('passes the caller abortSignal through to the SES SDK send', async () => {
    mocks.send.mockResolvedValue({});
    const { sendEmail } = await import('../../packages/api/src/lib/ses');
    const controller = new AbortController();

    const ok = await sendEmail({
      to: 'test@example.com',
      subject: 's',
      html: '<p>h</p>',
      abortSignal: controller.signal,
    });

    expect(ok).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const options = mocks.send.mock.calls[0]?.[1] as SendOptions;
    expect(options?.abortSignal).toBe(controller.signal);
  });

  it('an offer send that SES never answers is aborted at the timeout and reported unconfirmed', async () => {
    vi.useFakeTimers();
    timeoutOnFakeTimers();
    sesHangsUntilAborted();
    const { emailService, OFFER_EMAIL_SEND_TIMEOUT_MS } = await import('../../packages/api/src/services/email.service');

    let settled = false;
    const pending = emailService.sendOfferToCandidate(offer).then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(OFFER_EMAIL_SEND_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(false);
    const options = mocks.send.mock.calls[0]?.[1] as SendOptions;
    expect(options?.abortSignal?.aborted).toBe(true);
  });

  it('timed-out offer sends trip the OFFER breaker only; other mail still reaches SES (#332 panel, L3)', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    sesHangsUntilAborted();
    const { emailService } = await import('../../packages/api/src/services/email.service');
    const { sesCircuit, sesOfferCircuit } = await import('../../packages/api/src/lib/circuit-breaker');
    const { sendEmail } = await import('../../packages/api/src/lib/ses');

    for (let i = 0; i < 3; i++) expect(await emailService.sendOfferToCandidate(offer)).toBe(false);

    expect(sesOfferCircuit.getState().state).toBe('open');
    expect(sesCircuit.getState()).toEqual({ state: 'closed', failures: 0 });

    mocks.send.mockReset().mockResolvedValue({});
    expect(await sendEmail({ to: 'other@example.test', subject: 's', html: '<p>h</p>' })).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
