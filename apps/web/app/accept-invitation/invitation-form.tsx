'use client';

import { useEffect, useRef } from 'react';
import type es from '../../lib/i18n/es.json';
import type { AuthCaptcha as AuthCaptchaState } from '../../lib/auth/use-auth-captcha';
import { AuthCaptcha } from '../../components/auth-captcha';
import { Button } from '../../components/button';
import { TEXT_LINK_CLASSES } from '../../components/button-styles';
import { Field } from '../../components/field';
import { TextInput } from '../../components/text-input';
import { CaptchaHint } from '../(auth)/captcha-hint';
import { InvitationExistingControls } from './invitation-existing-controls';
import type { useInvitationSetup } from './use-invitation-setup';

type InvitationCopy = (typeof es)['acceptInvitation'];

/** The invitation's account form: create credentials, or sign in with an existing account, then join. */
export function InvitationForm({
  t,
  orWithEmail,
  setup,
  captcha,
  ssoEnabled,
}: {
  t: InvitationCopy;
  orWithEmail: string;
  setup: ReturnType<typeof useInvitationSetup>;
  captcha: AuthCaptchaState;
  ssoEnabled: boolean;
}) {
  const { existing, busy, sessionToken, error, notice, fields } = setup;
  const captchaMissing = !sessionToken && !captcha.satisfied;
  const captchaPending = !sessionToken && captcha.siteKey !== undefined && !captcha.satisfied;
  // A mismatch belongs under the confirmation field, not in the banner (text-fields.md › Best practices).
  const mismatch = error === t.mismatch;
  const confirmRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mismatch) confirmRef.current?.focus();
  }, [mismatch]);

  const passwordHelp = existing ? (ssoEnabled ? t.existingHelpSso : t.existingHelp) : t.policy;

  return (
    <form onSubmit={setup.submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
        <Field label={t.first}>
          <TextInput
            size="lg"
            value={fields.firstName}
            onChange={(e) => fields.setFirstName(e.target.value)}
            required
            maxLength={100}
            autoComplete="given-name"
          />
        </Field>
        <Field label={t.last}>
          <TextInput
            size="lg"
            value={fields.lastName}
            onChange={(e) => fields.setLastName(e.target.value)}
            required
            maxLength={100}
            autoComplete="family-name"
          />
        </Field>
      </div>

      {existing && !sessionToken && (
        <InvitationExistingControls
          busy={busy || captchaMissing}
          ssoEnabled={ssoEnabled}
          continueGoogle={t.continueGoogle}
          continueMicrosoft={t.continueMicrosoft}
          orWithEmail={orWithEmail}
          onSocial={(provider) => void setup.social(provider)}
        />
      )}

      {!sessionToken && (
        <div>
          <Field label={t.secret} help={passwordHelp}>
            <TextInput
              size="lg"
              type="password"
              value={fields.secret}
              onChange={(e) => fields.setSecret(e.target.value)}
              required
              minLength={existing ? 1 : 12}
              maxLength={128}
              autoComplete={existing ? 'current-password' : 'new-password'}
            />
          </Field>
          {existing && (
            <div className="mt-1.5 flex justify-end">
              <button
                type="button"
                disabled={busy || captchaMissing}
                onClick={() => void setup.recover()}
                className={`${TEXT_LINK_CLASSES} min-h-7 text-callout disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {t.forgot}
              </button>
            </div>
          )}
        </div>
      )}

      {!existing && (
        <Field label={t.confirm} error={mismatch ? error : undefined}>
          <TextInput
            ref={confirmRef}
            size="lg"
            type="password"
            value={fields.confirmation}
            onChange={(e) => fields.setConfirmation(e.target.value)}
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </Field>
      )}

      {error && !mismatch && (
        <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-body text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-info-bg px-4 py-3 text-body text-info">
          {notice}
        </p>
      )}
      {!sessionToken && <AuthCaptcha captcha={captcha} />}
      <div>
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={busy}
          loadingLabel={t.working}
          disabled={captchaMissing}
          aria-describedby={captchaPending ? 'invitation-captcha-hint' : undefined}
        >
          {sessionToken ? t.finish : existing ? t.join : t.create}
        </Button>
        <CaptchaHint id="invitation-captcha-hint" pending={captchaPending} />
      </div>
      <Button variant="tertiary" fullWidth disabled={busy} onClick={setup.toggleExisting}>
        {existing ? t.createInstead : t.signIn}
      </Button>
    </form>
  );
}
