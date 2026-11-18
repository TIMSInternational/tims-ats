'use client';

import { useSearchParams } from 'next/navigation';
import { isMfaPrivileged } from '@tims/shared';
import { useI18n } from '../../lib/i18n';
import { isSsoSignInOffered } from '../../lib/auth/sso-sign-in';
import { Button } from '../../components/button';
import { AuthCard, AUTH_ERROR_CLASSES, AUTH_TITLE_CLASSES } from '../(auth)/auth-card';
import { InvitationHeader } from './invitation-header';
import { InvitationSummary } from './invitation-summary';
import { InvitationNotice } from './invitation-notice';
import { InvitationReady } from './invitation-ready';
import { InvitationForm } from './invitation-form';
import { InvitationLoading } from './invitation-loading';
import { invitationUnavailable } from './invitation-setup-api';
import { useInvitationSetup } from './use-invitation-setup';
import { useAuthCaptcha } from '../../lib/auth/use-auth-captcha';

export function InvitationSetup() {
  const token = useSearchParams().get('token') ?? '';
  const { t: messages, locale: uiLocale, setLocale } = useI18n();
  const t = messages.acceptInvitation;
  const locale = uiLocale === 'EN' ? 'en' : 'es';
  // C-34: Turnstile for the password sign-in and the recovery email (both checked by Supabase Auth captcha).
  const captcha = useAuthCaptcha();
  const setup = useInvitationSetup(token, t, captcha);
  const { invitation, complete } = setup;
  // The pilot hides Google / Microsoft sign-in everywhere (one switch: isSsoSignInOffered), so invitees set a
  // password they can reuse at /login.
  const ssoEnabled = isSsoSignInOffered();
  const needsMfa = !!invitation?.roleSlug && isMfaPrivileged({ roles: [invitation.roleSlug], isPlatformOwner: false });
  const unavailable = !setup.loading && !setup.loadFailed && (!invitation || invitationUnavailable(invitation));

  // The heading names the state the page is in, so it never promises a step the body takes away
  // (writing.md › Best practices).
  const title = complete
    ? t.ready
    : !setup.loading && setup.loadFailed
      ? t.loadFailedTitle
      : unavailable
        ? t.unavailableTitle
        : t.welcome;
  const subtitle = complete ? t.readyText : setup.loadFailed || unavailable ? null : t.subtitle;

  return (
    <div className="w-full max-w-lg">
      <InvitationHeader
        language={t.language}
        languageLang={locale === 'es' ? 'en' : 'es'}
        switchLabel={t.languageSwitch}
        toggle={() => setLocale(uiLocale === 'ES' ? 'EN' : 'ES')}
      />
      <AuthCard wide>
        <h1 className={AUTH_TITLE_CLASSES}>{title}</h1>
        {subtitle && <p className="mt-2 max-w-prose text-body text-secondary">{subtitle}</p>}
        {setup.loading ? (
          <InvitationLoading label={t.loading} />
        ) : complete ? (
          <InvitationReady open={t.open} mfaNext={needsMfa ? t.mfaNext : undefined} />
        ) : setup.loadFailed ? (
          <InvitationNotice message={t.loadFailed} action={t.retry} onAction={setup.retryLoad} variant="secondary" />
        ) : !invitation || invitationUnavailable(invitation) ? (
          <div className="mt-6 text-center">
            <svg
              className="mx-auto size-8 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.981l7.5-4.039a2.25 2.25 0 012.134 0l7.5 4.039a2.25 2.25 0 011.183 1.98V19.5z" />
            </svg>
            <p role="alert" className="mx-auto mt-3 max-w-prose text-body text-secondary">
              {t.unavailable}
            </p>
            <Button href="/login" variant="secondary" size="lg" fullWidth className="mt-6">
              {t.goToSignIn}
            </Button>
          </div>
        ) : setup.otherSession !== undefined ? (
          <>
            <InvitationSummary invitation={invitation} locale={locale} noRole={t.noRole} expires={t.expires} />
            <InvitationNotice
              message={t.otherSession.replace('{email}', setup.otherSession)}
              action={t.otherSessionContinue}
              onAction={() => void setup.leaveOtherSession()}
              busy={setup.busy}
            />
            {setup.error && (
              <p role="alert" className={`mt-4 ${AUTH_ERROR_CLASSES}`}>
                {setup.error}
              </p>
            )}
          </>
        ) : (
          <>
            <InvitationSummary invitation={invitation} locale={locale} noRole={t.noRole} expires={t.expires} />
            <p className="mb-5 text-body text-secondary">{setup.existing ? t.existing : t.newUser}</p>
            <InvitationForm
              t={t}
              orWithEmail={messages.auth.orWithEmail}
              setup={setup}
              captcha={captcha}
              ssoEnabled={ssoEnabled}
            />
          </>
        )}
      </AuthCard>
      <p className="mt-6 text-center text-callout text-muted">{t.support}</p>
    </div>
  );
}
