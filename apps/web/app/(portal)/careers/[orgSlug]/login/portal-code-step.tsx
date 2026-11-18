'use client';

import { useState } from 'react';
import { TurnstileWidget } from '../../../../../components/turnstile-widget';
import { useI18n } from '../../../../../lib/i18n';
import { Button } from '../../../../../components/button';
import { FIELD_HELP_CLASSES, FIELD_LABEL_CLASSES } from '../../../../../components/field-styles';
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
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success-bg" aria-hidden="true">
            <svg
              className="size-6 text-success"
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
        <h2 className="mb-2 text-heading font-semibold text-brand">
          {justSent ? m.checkEmailTitle : m.enterCodeTitle}
        </h2>
        <p className="break-words text-base text-secondary sm:text-body">
          {(justSent ? m.checkEmailDesc : m.enterCodeDesc).replace('{email}', sentTo)}
        </p>
      </div>

      {notice && !error && (
        <div role="status" className="rounded-lg bg-info-bg p-3 text-callout text-info">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-danger-bg p-3 text-callout text-danger">
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
          <label htmlFor="portal-login-code" className={FIELD_LABEL_CLASSES}>
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
            className="h-12 w-full rounded-lg border border-field-border bg-white px-4 text-center text-title font-semibold tracking-[0.4em] text-primary tabular-nums transition-colors duration-150 placeholder:text-body placeholder:font-normal placeholder:tracking-normal placeholder:text-muted hover:border-secondary focus-visible:border-brand aria-[invalid=true]:border-danger"
          />
          <p id="portal-login-code-help" className={FIELD_HELP_CLASSES}>
            {m.codeHelp}
          </p>
        </div>
        <Button
          type="submit"
          size="lg"
          fullWidth
          disabled={busy || !isCompleteOtp(code)}
          loading={verifying}
          loadingLabel={m.verifying}
        >
          {m.verifyCode}
        </Button>
      </form>

      {/* Everything about getting a new email sits together, so the captcha reads as part of "resend",
          not as the code being checked. */}
      <section aria-labelledby="portal-login-resend-title" className="space-y-3 border-t border-border pt-4">
        <h3 id="portal-login-resend-title" className="text-callout font-medium text-primary">
          {m.resendHeading}
        </h3>
        <p className="text-callout text-secondary">{m.checkSpam}</p>
        {secondsLeft === 0 && turnstileSiteKey && (
          <TurnstileWidget key={captchaKey} siteKey={turnstileSiteKey} onToken={onCaptchaToken} />
        )}
        <div className="-mx-3 flex flex-wrap items-center justify-between gap-2">
          <Button variant="tertiary" size="sm" onClick={onResend} disabled={!canResend || !captchaSatisfied}>
            {sending ? m.sending : secondsLeft > 0 ? m.resendIn.replace('{n}', String(secondsLeft)) : m.resend}
          </Button>
          <Button variant="tertiary" size="sm" onClick={onChangeEmail} disabled={busy}>
            {m.changeEmail}
          </Button>
        </div>
      </section>
    </div>
  );
}
