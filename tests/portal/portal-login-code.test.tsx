import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';
import {
  PORTAL_RESEND_COOLDOWN_SECONDS,
  classifyOtpSendError,
  classifyOtpVerifyError,
  isCompleteOtp,
  normalizeOtpInput,
  secondsUntil,
} from '../../apps/web/lib/portal-auth';

// C-01 / C-27 / C-34: the portal sign-in email promises a 6-digit code; the login page must accept it
// (verifyOtp, type 'email'), offer a resend after a countdown and a way to fix the address, tell rate limits
// apart from failures, and send the Turnstile token with the email request when a site key is configured.

const auth = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme' }),
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: () => ({ auth }) }));
vi.mock('../../apps/web/lib/auth/canonical-auth-origin', () => ({
  ensureCanonicalAuthOrigin: () => true,
  useCanonicalAuthOrigin: () => undefined,
}));
vi.mock('../../apps/web/components/turnstile-widget', () => ({
  TurnstileWidget: ({ onToken }: { onToken: (token: string | null) => void }) => (
    <button type="button" onClick={() => onToken('turnstile-token')}>
      solve-captcha
    </button>
  ),
}));

import PortalLoginPage from '../../apps/web/app/(portal)/careers/[orgSlug]/login/page';

const m = en.portalAuth;
const ADDRESS = 'candidate@example.com';

async function requestEmail(address = ADDRESS) {
  fireEvent.change(screen.getByLabelText(m.emailLabel), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: m.sendLink }));
  });
}

async function typeCodeAndSubmit(raw: string) {
  fireEvent.change(screen.getByLabelText(m.codeLabel), { target: { value: raw } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: m.verifyCode }));
  });
}

beforeEach(() => {
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  auth.signInWithOtp.mockReset();
  auth.verifyOtp.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
});

describe('portal login code helpers', () => {
  // The code length is a Supabase setting (6 to 10 digits); production sent 8-digit codes on 2026-11-19.
  it('keeps digits only, at most 10, and accepts any length from 6 to 10', () => {
    expect(normalizeOtpInput('123 456')).toBe('123456');
    expect(normalizeOtpInput('1234-5678')).toBe('12345678');
    expect(normalizeOtpInput('12-34-56-78-90-12')).toBe('1234567890');
    expect(normalizeOtpInput('abc')).toBe('');
    expect(isCompleteOtp('123456')).toBe(true);
    expect(isCompleteOtp('12345678')).toBe(true);
    expect(isCompleteOtp('1234567890')).toBe(true);
    expect(isCompleteOtp('12345')).toBe(false);
    expect(isCompleteOtp('12345678901')).toBe(false);
  });

  it('reads the per-address wait out of the Supabase message', () => {
    expect(
      classifyOtpSendError({
        status: 429,
        code: 'over_email_send_rate_limit',
        message: 'For security purposes, you can only request this after 42 seconds.',
      }),
    ).toEqual({ kind: 'cooldown', seconds: 42 });
    expect(classifyOtpSendError({ message: 'you can only request this after 99999 seconds' })).toEqual({
      kind: 'cooldown',
      seconds: 3600,
    });
  });

  it('tells rate limits, captcha and bad addresses apart from other failures', () => {
    expect(
      classifyOtpSendError({ status: 429, code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' }),
    ).toEqual({
      kind: 'rate_limited',
    });
    expect(
      classifyOtpSendError({ status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' }),
    ).toEqual({
      kind: 'rate_limited',
    });
    expect(
      classifyOtpSendError({ status: 400, code: 'captcha_failed', message: 'captcha protection: request disallowed' }),
    ).toEqual({
      kind: 'captcha',
    });
    expect(
      classifyOtpSendError({ status: 400, code: 'email_address_invalid', message: 'Email address is invalid' }),
    ).toEqual({
      kind: 'invalid_email',
    });
    expect(classifyOtpSendError({ status: 500, message: 'Error sending magic link email' })).toEqual({
      kind: 'generic',
    });
  });

  it('classifies verifyOtp failures', () => {
    expect(
      classifyOtpVerifyError({ status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' }),
    ).toBe('invalid_code');
    expect(classifyOtpVerifyError({ status: 429, code: 'over_request_rate_limit', message: 'x' })).toBe(
      'too_many_attempts',
    );
    expect(classifyOtpVerifyError({ status: 500, message: 'Database error' })).toBe('generic');
  });

  it('counts whole seconds down to zero', () => {
    expect(secondsUntil(10_000, 0)).toBe(10);
    expect(secondsUntil(10_000, 9_001)).toBe(1);
    expect(secondsUntil(10_000, 12_000)).toBe(0);
  });
});

describe('portal login page: code sign-in', () => {
  it('sends the email, then signs in with the 6-digit code', async () => {
    render(<PortalLoginPage />);
    await requestEmail();

    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
    const [args] = auth.signInWithOtp.mock.calls[0]!;
    expect(args.email).toBe(ADDRESS);
    expect(args.options.emailRedirectTo).toContain('/auth/callback');
    expect(args.options.captchaToken).toBeUndefined();
    expect(screen.getByText(m.checkEmailDesc.replace('{email}', ADDRESS))).toBeInTheDocument();

    await typeCodeAndSubmit('123 456');
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: ADDRESS, token: '123456', type: 'email' });
    expect(router.replace).toHaveBeenCalledWith('/careers/acme/dashboard');
  });

  it('keeps the sign-in button disabled until at least 6 digits are typed', async () => {
    render(<PortalLoginPage />);
    await requestEmail();
    fireEvent.change(screen.getByLabelText(m.codeLabel), { target: { value: '12345' } });
    expect(screen.getByRole('button', { name: m.verifyCode })).toBeDisabled();
  });

  it('takes an 8-digit code whole and sends all of it', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403, code: 'otp_expired', message: 'x' } });
    render(<PortalLoginPage />);
    await requestEmail();
    await typeCodeAndSubmit('12345678');
    expect((screen.getByLabelText(m.codeLabel) as HTMLInputElement).value).toBe('12345678');
    expect(auth.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ token: '12345678' }));
  });

  it('explains a wrong or expired code and stays on the code step', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: {},
      error: { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
    });
    render(<PortalLoginPage />);
    await requestEmail();
    await typeCodeAndSubmit('000000');
    expect(screen.getByRole('alert').textContent).toBe(m.codeInvalid);
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText(m.codeLabel)).toBeInTheDocument();
  });

  it('offers a resend only after the countdown, then sends again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<PortalLoginPage />);
    await requestEmail();

    const waiting = screen.getByRole('button', {
      name: m.resendIn.replace('{n}', String(PORTAL_RESEND_COOLDOWN_SECONDS)),
    });
    expect(waiting).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(PORTAL_RESEND_COOLDOWN_SECONDS * 1000);
    });
    const resend = screen.getByRole('button', { name: m.resend });
    expect(resend).toBeEnabled();
    await act(async () => {
      fireEvent.click(resend);
    });
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(2);
    expect(auth.signInWithOtp.mock.calls[1]![0].email).toBe(ADDRESS);
    expect(screen.getByRole('status').textContent).toBe(m.resent);
  });

  it('goes back to the email step to fix the address', async () => {
    render(<PortalLoginPage />);
    await requestEmail();
    fireEvent.click(screen.getByRole('button', { name: m.changeEmail }));
    expect(screen.getByLabelText(m.emailLabel)).toHaveValue(ADDRESS);
    expect(screen.queryByLabelText(m.codeLabel)).toBeNull();
  });

  it('treats the per-address throttle as "use the code you already have", not a failure', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: {
        status: 429,
        code: 'over_email_send_rate_limit',
        message: 'For security purposes, you can only request this after 42 seconds.',
      },
    });
    render(<PortalLoginPage />);
    await requestEmail();
    expect(screen.getByRole('status').textContent).toBe(m.cooldownNotice.replace('{n}', '42'));
    expect(screen.getByLabelText(m.codeLabel)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: m.resendIn.replace('{n}', '42') })).toBeDisabled();
  });

  it('shows a rate-limit message (not the generic error) for the project-wide email limit', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
    });
    render(<PortalLoginPage />);
    await requestEmail();
    expect(screen.getByRole('alert').textContent).toBe(m.errorRateLimited);
    expect(screen.queryByLabelText(m.codeLabel)).toBeNull();
  });

  it('verifies a code already in the inbox without sending another email', async () => {
    render(<PortalLoginPage />);
    fireEvent.change(screen.getByLabelText(m.emailLabel), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByRole('button', { name: m.haveCode }));

    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(screen.getByText(m.enterCodeDesc.replace('{email}', ADDRESS))).toBeInTheDocument();
    // Nothing was sent, so a new email may be requested right away.
    expect(screen.getByRole('button', { name: m.resend })).toBeEnabled();

    await typeCodeAndSubmit('654321');
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: ADDRESS, token: '654321', type: 'email' });
    expect(router.replace).toHaveBeenCalledWith('/careers/acme/dashboard');
  });

  it('never runs a verification while a resend is in flight', async () => {
    render(<PortalLoginPage />);
    fireEvent.change(screen.getByLabelText(m.emailLabel), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByRole('button', { name: m.haveCode }));
    fireEvent.change(screen.getByLabelText(m.codeLabel), { target: { value: '123456' } });

    let finishSend: (value: { data: object; error: null }) => void = () => undefined;
    auth.signInWithOtp.mockReturnValue(
      new Promise((resolve) => {
        finishSend = resolve;
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: m.resend }));
    });
    expect(screen.getByRole('button', { name: m.verifyCode })).toBeDisabled();
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(m.codeLabel).closest('form')!);
    });
    expect(auth.verifyOtp).not.toHaveBeenCalled();

    await act(async () => {
      finishSend({ data: {}, error: null });
    });
    expect(screen.getByRole('status').textContent).toBe(m.resent);
  });

  it('recovers from a thrown verifyOtp or signInWithOtp instead of locking the page', async () => {
    auth.verifyOtp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<PortalLoginPage />);
    await requestEmail();
    await typeCodeAndSubmit('123456');
    expect(screen.getByRole('alert').textContent).toBe(m.codeErrorGeneric);
    expect(screen.getByRole('button', { name: m.verifyCode })).toBeEnabled();
    expect(screen.getByRole('button', { name: m.changeEmail })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: m.changeEmail }));
    auth.signInWithOtp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: m.sendLink }));
    });
    expect(screen.getByRole('alert').textContent).toBe(m.errorGeneric);
    expect(screen.getByRole('button', { name: m.sendLink })).toBeEnabled();
  });

  it('requires and forwards the Turnstile token when a site key is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
    render(<PortalLoginPage />);
    fireEvent.change(screen.getByLabelText(m.emailLabel), { target: { value: ADDRESS } });
    expect(screen.getByRole('button', { name: m.sendLink })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'solve-captcha' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: m.sendLink }));
    });
    expect(auth.signInWithOtp.mock.calls[0]![0].options.captchaToken).toBe('turnstile-token');
  });
});

describe('portal login copy (es)', () => {
  it('addresses the candidate as usted and names the code', () => {
    const p = es.portalAuth;
    // Says what the portal is for, then the mechanics: a link and a code by email.
    expect(p.loginSubtitle).toBe(
      'Consulte sus postulaciones, entrevistas y ofertas. Le enviaremos un enlace y un código a su correo.',
    );
    expect(p.checkEmailTitle).toBe('Revise su correo');
    expect(p.checkEmailDesc).toContain('{email}');
    expect(p.resendIn).toContain('{n}');
    expect(p.cooldownNotice).toContain('{n}');
    for (const text of Object.values(p)) {
      expect(text).not.toMatch(/\b(tu|tus|te|ingresa|revisa|solicita|inténtalo)\b/i);
    }
  });
});
