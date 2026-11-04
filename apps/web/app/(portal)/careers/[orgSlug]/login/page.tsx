'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { getAuthRedirectUrl } from '@tims/shared';
import { useI18n } from '../../../../../lib/i18n';
import {
  PORTAL_RESEND_COOLDOWN_SECONDS,
  classifyOtpSendError,
  classifyOtpVerifyError,
  hasAuthErrorFragment,
  type OtpSendFailure,
  type OtpVerifyFailure,
} from '../../../../../lib/portal-auth';
import { ensureCanonicalAuthOrigin, useCanonicalAuthOrigin } from '../../../../../lib/auth/canonical-auth-origin';
import { PortalEmailStep } from './portal-email-step';
import { PortalCodeStep } from './portal-code-step';
import { useResendCountdown } from './use-resend-countdown';

// Candidate portal login — passwordless. One email carries both a magic link and a 6-digit code: the link only
// works in the browser that asked for it (PKCE), so the page also takes the code (verifyOtp, type 'email'), which
// works from any device. We always show the same "check your email" step whether or not the address maps to a
// candidate (no account enumeration); access is gated downstream at /dashboard by the Candidate lookup.
export default function PortalLoginPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const m = t.portalAuth;
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  // False when the code step was opened with "I already have a code" (nothing sent from this page).
  const [justSent, setJustSent] = useState(false);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  // One auth request at a time. A resend replaces the emailed code, so it must never race a verification; the
  // ref closes the gap before the disabled buttons re-render.
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const countdown = useResendCountdown();
  // Turnstile (the apply form's CAPTCHA) on the email request, when configured. Supabase Auth verifies the
  // token once its captcha protection is enabled; until then the token is ignored.
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const captchaSatisfied = !turnstileSiteKey || !!captchaToken;
  // /auth/callback sends a failed magic-link exchange back here with ?error=link (expired, or opened
  // in another browser). Shown until the candidate asks for a new email.
  const linkFailedQuery = useSearchParams().get('error') === 'link';
  // Supabase can also land here with the failure only in the fragment (#error=...&error_code=otp_expired),
  // which the server never sees. Read it on mount, then drop it from the address bar.
  const [linkFailedHash, setLinkFailedHash] = useState(false);
  useEffect(() => {
    if (!hasAuthErrorFragment(window.location.hash)) return;
    setLinkFailedHash(true);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, []);
  const linkFailed = (linkFailedQuery || linkFailedHash) && !submitted;
  useCanonicalAuthOrigin();

  const sendFailureMessage = (failure: OtpSendFailure): string => {
    if (failure.kind === 'rate_limited') return m.errorRateLimited;
    if (failure.kind === 'captcha') return m.errorCaptcha;
    if (failure.kind === 'invalid_email') return m.errorInvalidEmail;
    return m.errorGeneric;
  };

  const verifyFailureMessage = (failure: OtpVerifyFailure): string => {
    if (failure === 'invalid_code') return m.codeInvalid;
    if (failure === 'too_many_attempts') return m.codeTooManyAttempts;
    return m.codeErrorGeneric;
  };

  const resetCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaKey((key) => key + 1);
  };

  const showCodeStep = (address: string, cooldownSeconds: number, info: string) => {
    setSentTo(address);
    setJustSent(true);
    setStep('code');
    setNotice(info);
    countdown.start(cooldownSeconds);
  };

  const requestEmail = async (address: string) => {
    if (inFlight.current) return;
    if (!ensureCanonicalAuthOrigin()) return;
    inFlight.current = true;
    const resending = step === 'code';
    setBusy('send');
    setError('');
    setNotice('');
    setSubmitted(true);
    // Magic-link email: always the configured app origin (#50).
    let emailRedirectTo: string;
    try {
      emailRedirectTo = getAuthRedirectUrl('/auth/callback', { next: `/careers/${orgSlug}/dashboard` });
    } catch {
      inFlight.current = false;
      setBusy(null);
      setError(m.errorGeneric);
      return;
    }
    let failure: OtpSendFailure | null = null;
    try {
      const { error: otpError } = await createSupabaseBrowserClient().auth.signInWithOtp({
        email: address,
        options: captchaToken ? { emailRedirectTo, captchaToken } : { emailRedirectTo },
      });
      if (otpError) failure = classifyOtpSendError(otpError);
    } catch {
      // The SDK rethrows non-auth exceptions (e.g. a network failure): same as any other failed send.
      failure = { kind: 'generic' };
    } finally {
      // A Turnstile token is single-use, so whatever happened the next request needs a fresh one.
      resetCaptcha();
      inFlight.current = false;
      setBusy(null);
    }
    if (failure) {
      // The per-address limit means this address got an email moments ago: its code still works, so go on to
      // the code step and count down to when another email may be requested.
      if (failure.kind === 'cooldown') {
        showCodeStep(address, failure.seconds, m.cooldownNotice.replace('{n}', String(failure.seconds)));
        return;
      }
      setError(sendFailureMessage(failure));
      return;
    }
    showCodeStep(address, PORTAL_RESEND_COOLDOWN_SECONDS, resending ? m.resent : '');
  };

  const submitEmail = () => {
    const value = email.trim();
    if (!value || !value.includes('@')) return;
    void requestEmail(value);
  };

  // The code from an email already received — requested earlier, in another tab, or before a reload — works
  // without sending a new one (which would also replace it).
  const enterExistingCode = () => {
    const value = email.trim();
    if (inFlight.current || !value || !value.includes('@')) return;
    setSentTo(value);
    setJustSent(false);
    setStep('code');
    setError('');
    setNotice('');
    setSubmitted(true);
  };

  const verifyCode = async (code: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy('verify');
    setError('');
    setNotice('');
    let failure: OtpVerifyFailure | null = null;
    try {
      const { error: verifyError } = await createSupabaseBrowserClient().auth.verifyOtp({
        email: sentTo,
        token: code,
        type: 'email',
      });
      if (verifyError) failure = classifyOtpVerifyError(verifyError);
    } catch {
      // A thrown (non-auth) exception must not leave the page locked with every control disabled.
      failure = 'generic';
    }
    if (failure) {
      inFlight.current = false;
      setBusy(null);
      setError(verifyFailureMessage(failure));
      return;
    }
    // Same landing as the magic link's /auth/callback → `next`. Busy stays set while the dashboard loads.
    router.replace(`/careers/${orgSlug}/dashboard`);
    router.refresh();
  };

  const changeEmail = () => {
    setStep('email');
    setError('');
    setNotice('');
    resetCaptcha();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F6F6] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F114C] mb-4">
            <span className="text-white text-xl font-bold">T</span>
          </div>
          <h1 className="text-[22px] font-bold text-[#1F114C]">{m.loginTitle}</h1>
          <p className="text-[13px] text-muted mt-1">{m.loginSubtitle}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] p-8">
          {step === 'code' ? (
            <PortalCodeStep
              sentTo={sentTo}
              justSent={justSent}
              notice={notice}
              error={error}
              verifying={busy === 'verify'}
              sending={busy === 'send'}
              secondsLeft={countdown.secondsLeft}
              onVerify={(code) => void verifyCode(code)}
              onResend={() => void requestEmail(sentTo)}
              onChangeEmail={changeEmail}
              turnstileSiteKey={turnstileSiteKey}
              captchaKey={captchaKey}
              onCaptchaToken={setCaptchaToken}
              captchaSatisfied={captchaSatisfied}
            />
          ) : (
            <PortalEmailStep
              email={email}
              onEmailChange={setEmail}
              onSubmit={submitEmail}
              onHaveCode={enterExistingCode}
              sending={busy === 'send'}
              error={error}
              showLinkFailed={linkFailed}
              turnstileSiteKey={turnstileSiteKey}
              captchaKey={captchaKey}
              onCaptchaToken={setCaptchaToken}
              captchaSatisfied={captchaSatisfied}
            />
          )}
        </div>

        <div className="text-center mt-5">
          <Link href={`/careers/${orgSlug}`} className="text-[13px] text-muted hover:text-[#585858] hover:underline">
            {m.backToJobs}
          </Link>
        </div>
      </div>
    </div>
  );
}
