'use client';

import { TurnstileWidget } from '../../../../../components/turnstile-widget';
import { useI18n } from '../../../../../lib/i18n';
import { Button } from '../../../../../components/button';
import { FIELD_LABEL_CLASSES, inputClasses } from '../../../../../components/field-styles';

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
        <div role="alert" className="rounded-lg bg-warning-bg p-3 text-callout text-warning">
          {m.linkExpired}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-danger-bg p-3 text-callout text-danger">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="portal-login-email" className={FIELD_LABEL_CLASSES}>
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
          className={inputClasses('lg')}
        />
      </div>
      {turnstileSiteKey && <TurnstileWidget key={captchaKey} siteKey={turnstileSiteKey} onToken={onCaptchaToken} />}
      <Button
        type="submit"
        size="lg"
        fullWidth
        disabled={!email.trim() || !captchaSatisfied}
        loading={sending}
        loadingLabel={m.sending}
      >
        {m.sendLink}
      </Button>
      <Button variant="tertiary" fullWidth onClick={onHaveCode} disabled={sending || !email.includes('@')}>
        {m.haveCode}
      </Button>
    </form>
  );
}
