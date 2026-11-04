'use client';

import { useState } from 'react';
import { TurnstileWidget } from '../../../../../components/turnstile-widget';
import { useI18n } from '../../../../../lib/i18n';
import { isCompleteOtp, normalizeOtpInput } from '../../../../../lib/portal-auth';

interface PortalCodeStepProps {
  sentTo: string;
  // False when the candidate chose "I already have a code": nothing was sent from this page.
  justSent: boolean;
  notice: string;
  error: string;
  verifying: boolean;
  sending: boolean;
  secondsLeft: number;
  onVerify: (code: string) => void;
  onResend: () => void;
  onChangeEmail: () => void;
  turnstileSiteKey: string | undefined;
  captchaKey: number;
  onCaptchaToken: (token: string | null) => void;
  captchaSatisfied: boolean;
}

// Step 2 of the portal sign-in: the email went out (or the candidate already holds one). The candidate either taps
// the link (same browser only) or types the 6-digit code from it here, and can ask for another email once the
// cooldown ends or fix the address.
export function PortalCodeStep({
  sentTo,
  justSent,
  notice,
  error,
  verifying,
  sending,
  secondsLeft,
  onVerify,
  onResend,
  onChangeEmail,
  turnstileSiteKey,
  captchaKey,
  onCaptchaToken,
  captchaSatisfied,
}: PortalCodeStepProps) {
  const { t } = useI18n();
  const m = t.portalAuth;
  const [code, setCode] = useState('');
  // One request at a time: a resend replaces the emailed code, so it must not race a verification.
  const busy = sending || verifying;
  const canResend = secondsLeft === 0 && !busy;

  return (
    <div className="space-y-4">
      <div className="text-center">
        {justSent && (
          <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-green-600"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        <h3 className="text-[15px] font-semibold text-[#1F114C] mb-2">
          {justSent ? m.checkEmailTitle : m.enterCodeTitle}
        </h3>
        <p className="text-[13px] text-[#585858] break-words">
          {(justSent ? m.checkEmailDesc : m.enterCodeDesc).replace('{email}', sentTo)}
        </p>
      </div>

      {notice && !error && (
        <div role="status" className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[13px] text-blue-800">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && isCompleteOtp(code)) onVerify(code);
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="portal-login-code" className="block text-[12px] font-medium text-[#585858] mb-1.5">
            {m.codeLabel}
          </label>
          <input
            id="portal-login-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            required
            value={code}
            onChange={(e) => setCode(normalizeOtpInput(e.target.value))}
            placeholder={m.codePlaceholder}
            aria-describedby="portal-login-code-help"
            className="w-full h-12 px-4 rounded-xl border border-[#EDEDED] text-center text-[18px] font-semibold tracking-[0.4em] text-[#333] placeholder:text-[13px] placeholder:font-normal placeholder:tracking-normal placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] transition"
          />
          <p id="portal-login-code-help" className="mt-1.5 text-[12px] text-[#585858]">
            {m.codeHelp}
          </p>
        </div>
        <button
          type="submit"
          disabled={busy || !isCompleteOtp(code)}
          className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold hover:bg-[#2a1a5e] disabled:opacity-50 transition"
        >
          {verifying ? m.verifying : m.verifyCode}
        </button>
      </form>

      <p className="text-[12px] text-[#585858] text-center">{m.checkSpam}</p>

      <div className="space-y-3 border-t border-[#EDEDED] pt-4">
        {secondsLeft === 0 && turnstileSiteKey && (
          <TurnstileWidget key={captchaKey} siteKey={turnstileSiteKey} onToken={onCaptchaToken} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onResend}
            disabled={!canResend || !captchaSatisfied}
            className="text-[13px] font-semibold text-[#1F114C] hover:underline disabled:text-muted disabled:no-underline disabled:cursor-not-allowed"
          >
            {sending ? m.sending : secondsLeft > 0 ? m.resendIn.replace('{n}', String(secondsLeft)) : m.resend}
          </button>
          <button
            type="button"
            onClick={onChangeEmail}
            disabled={busy}
            className="text-[13px] text-[#585858] hover:underline disabled:opacity-50"
          >
            {m.changeEmail}
          </button>
        </div>
      </div>
    </div>
  );
}
