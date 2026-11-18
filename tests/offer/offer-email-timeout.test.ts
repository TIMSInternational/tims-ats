/**
 * #322: the offer email is awaited inside offer.generateSigningLink, so the SES send must be bounded.
 * The reminder and application-received sends already pass AbortSignal.timeout(4_000); the offer
 * send did not, so a hung SES call held the recruiter's mutation open after the link went live.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn();
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail }));

afterEach(() => {
  vi.restoreAllMocks();
  sendEmail.mockReset();
});

const params = {
  candidateEmail: 'qa@example.test',
  candidateName: 'QA Candidate',
  vacancyTitle: 'QA role',
  companyName: 'Example Company',
  signingUrl: 'https://example.test/offers/sign/token',
  expiresAt: null,
};

describe('emailService.sendOfferToCandidate', () => {
  it('passes a bounded abort signal to the SES send', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    sendEmail.mockResolvedValue(true);
    const { emailService, OFFER_EMAIL_SEND_TIMEOUT_MS } = await import('../../packages/api/src/services/email.service');

    await expect(emailService.sendOfferToCandidate(params)).resolves.toBe(true);

    expect(OFFER_EMAIL_SEND_TIMEOUT_MS).toBeGreaterThan(0);
    expect(OFFER_EMAIL_SEND_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(timeout).toHaveBeenCalledWith(OFFER_EMAIL_SEND_TIMEOUT_MS);
    const call = sendEmail.mock.calls[0]?.[0] as { to: string; abortSignal?: unknown };
    expect(call.to).toBe('qa@example.test');
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call.abortSignal).toBe(timeout.mock.results[0]?.value);
    const { sesOfferCircuit } = await import('../../packages/api/src/lib/circuit-breaker');
    expect((call as { breaker?: unknown }).breaker).toBe(sesOfferCircuit);
  });

  it('reports an aborted (timed-out) send as unconfirmed rather than hanging', async () => {
    // sendEmail never throws: an abort lands in its catch and returns false. Model a send that only
    // settles when its signal fires, and fire the signal early so the test does not wait 4s.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    sendEmail.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      abortSignal.aborted
        ? Promise.resolve(false)
        : new Promise((resolve) => abortSignal.addEventListener('abort', () => resolve(false))),
    );
    const { emailService } = await import('../../packages/api/src/services/email.service');

    await expect(emailService.sendOfferToCandidate(params)).resolves.toBe(false);
  });
});

describe('emailService.notifyOfferAccepted / notifyOfferDeclined (HR notices, run inside after())', () => {
  const notice = {
    hrEmails: ['hr@example.test'],
    recipientName: 'Equipo de RRHH',
    candidateName: 'QA Candidate',
    vacancyTitle: 'QA role',
    companyName: 'Example Company',
  };

  it.each([
    ['notifyOfferAccepted', { ...notice, acceptedAt: new Date('2026-11-03T22:00:00Z') }],
    ['notifyOfferDeclined', { ...notice, declinedAt: new Date('2026-11-03T22:00:00Z') }],
  ] as const)('%s is bounded and isolated on the offer breaker, never the shared sesCircuit', async (name, input) => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    sendEmail.mockResolvedValue(true);
    const { emailService, OFFER_EMAIL_SEND_TIMEOUT_MS } = await import('../../packages/api/src/services/email.service');
    const { sesOfferCircuit, sesCircuit } = await import('../../packages/api/src/lib/circuit-breaker');

    await expect((emailService[name] as (p: typeof input) => Promise<boolean>)(input)).resolves.toBe(true);

    expect(timeout).toHaveBeenCalledWith(OFFER_EMAIL_SEND_TIMEOUT_MS);
    const call = sendEmail.mock.calls[0]?.[0] as { to: string[]; abortSignal?: unknown; breaker?: unknown };
    expect(call.to).toEqual(['hr@example.test']);
    expect(call.abortSignal).toBe(timeout.mock.results[0]?.value);
    expect(call.breaker).toBe(sesOfferCircuit);
    expect(call.breaker).not.toBe(sesCircuit);
  });
});
