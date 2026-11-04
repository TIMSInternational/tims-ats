'use client';

import { TurnstileWidget } from '../../../../../components/turnstile-widget';
import { useI18n } from '../../../../../lib/i18n';

interface PortalEmailStepProps {
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: () => void;
  // Go straight to the code step for a code that is already in the inbox (another tab, a reload, another device).
  onHaveCode: () => void;
  sending: boolean;
  error: string;
  showLinkFailed: boolean;
  turnstileSiteKey: string | undefined;
  // Bumped after every send attempt: a Turnstile token is single-use, so the widget is remounted for a fresh one.
  captchaKey: number;
  onCaptchaToken: (token: string | null) => void;
  captchaSatisfied: boolean;
}

// Step 1 of the portal sign-in: the address the link and the code are sent to.
export function PortalEmailStep({
  email,
  onEmailChange,
  onSubmit,
  onHaveCode,
  sending,
  error,
  showLinkFailed,
  turnstileSiteKey,
  captchaKey,
  onCaptchaToken,
  captchaSatisfied,
}: PortalEmailStepProps) {
  const { t } = useI18n();
  const m = t.portalAuth;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      {!error && showLinkFailed && (
        <div
          role="alert"
          className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-800"
        >
          {m.linkExpired}
        </div>
      )}
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="portal-login-email" className="block text-[12px] font-medium text-[#585858] mb-1.5">
          {m.emailLabel}
        </label>
        <input
          id="portal-login-email"
          autoComplete="email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder={m.emailPlaceholder}
          className="w-full h-11 px-4 rounded-xl border border-[#EDEDED] text-[13px] text-[#333] placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] transition"
        />
      </div>
      {turnstileSiteKey && <TurnstileWidget key={captchaKey} siteKey={turnstileSiteKey} onToken={onCaptchaToken} />}
      <button
        type="submit"
        disabled={sending || !email.trim() || !captchaSatisfied}
        className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold hover:bg-[#2a1a5e] disabled:opacity-50 transition"
      >
        {sending ? m.sending : m.sendLink}
      </button>
      <button
        type="button"
        onClick={onHaveCode}
        disabled={sending || !email.includes('@')}
        className="w-full text-[13px] font-semibold text-[#1F114C] hover:underline disabled:text-muted disabled:no-underline disabled:cursor-not-allowed"
      >
        {m.haveCode}
      </button>
    </form>
  );
}
