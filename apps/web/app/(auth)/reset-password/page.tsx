'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../../lib/i18n';
import { Button } from '../../../components/button';
import { buttonClasses, TEXT_LINK_CLASSES } from '../../../components/button-styles';
import { Field } from '../../../components/field';
import { TextInput } from '../../../components/text-input';
import { AuthCard, AUTH_ERROR_CLASSES, AUTH_SUBTITLE_CLASSES, AUTH_TITLE_CLASSES } from '../auth-card';
import { AuthSuccess } from '../auth-success';
import { PasswordInput } from '../password-input';
import { clearPasswordSetupAuthorization, establishPasswordSetupSession } from './password-setup-session';

const passwordLengthOk = (value: string) => value.length >= 12 && value.length <= 128;

const INVITATION_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [setupUserId, setSetupUserId] = useState<string | null>(null);
  const [invalidLink, setInvalidLink] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const setupPromise = useRef<Promise<string | null> | null>(null);
  const invitationParam = searchParams.get('invitation');
  const invitationToken = invitationParam && INVITATION_TOKEN.test(invitationParam) ? invitationParam : null;
  const verifying = !setupUserId && !invalidLink;
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The automatic redirect must not fire after the user left (Continuar, or any other navigation).
  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );
  // Where the success view goes, by timer or by its "Continuar" button (the same destination).
  const destination = (() => {
    const invitation = searchParams.get('invitation');
    return invitation && /^[0-9a-f-]{36}$/i.test(invitation)
      ? `/accept-invitation?token=${encodeURIComponent(invitation)}`
      : '/dashboard';
  })();

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    setupPromise.current ??= establishPasswordSetupSession(supabase.auth);
    void (async () => {
      const userId = await setupPromise.current;
      if (!active) return;
      if (!userId) {
        setInvalidLink(true);
        return;
      }
      setSetupUserId(userId);
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Same rules as before, shown under the field they concern; focus goes to the first invalid one.
    if (!passwordLengthOk(password)) {
      setPasswordError(t.auth.passwordMinLength);
      passwordRef.current?.focus();
      return;
    }
    if (password !== confirmPassword) {
      setConfirmError(t.auth.passwordsDontMatch);
      confirmRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const current = await supabase.auth.getSession();
      if (current.error || !current.data.session || current.data.session.user.id !== setupUserId) {
        setInvalidLink(true);
        return;
      }
      const updateResponse = await fetch('/api/auth/password-update', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${current.data.session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password, userId: setupUserId }),
        cache: 'no-store',
      });

      if (!updateResponse.ok) {
        const responseBody: unknown = await updateResponse.json().catch(() => null);
        if (
          updateResponse.status === 403 &&
          typeof responseBody === 'object' &&
          responseBody !== null &&
          'error' in responseBody &&
          responseBody.error === 'mfa_required'
        ) {
          const returnTo = `${window.location.pathname}${window.location.search}`;
          window.location.assign(`/mfa?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }
        setError(t.auth.passwordUpdateFailed);
        return;
      }

      clearPasswordSetupAuthorization();
      setSuccess(true);
      redirectTimer.current = setTimeout(() => router.push(destination), 2000);
    } catch {
      setError(t.auth.passwordUpdateFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard>
      {success ? (
        <AuthSuccess title={t.auth.passwordUpdated}>
          <p className="mb-6 text-body text-secondary">{t.auth.redirectingToDashboard}</p>
          <Button
            href={destination}
            size="lg"
            fullWidth
            onClick={() => {
              if (redirectTimer.current) clearTimeout(redirectTimer.current);
            }}
          >
            {t.auth.continue}
          </Button>
        </AuthSuccess>
      ) : invalidLink ? (
        <div className="space-y-4">
          {/* Invalid, expired or spent link: no form, only the ways out (a new link, or back to the
              invitation that sent it, and the sign-in page). A session can outlive a spent link and
              middleware bounces signed-in users off /forgot-password and /login, so both exits sign
              out first. Plain <a>: /logout is a GET route handler and must never be prefetched. */}
          <h1 className={AUTH_TITLE_CLASSES}>{t.auth.newPassword}</h1>
          <div role="alert" className={AUTH_ERROR_CLASSES}>
            {t.auth.invalidPasswordSetupLink}
          </div>
          <a
            href={
              invitationToken
                ? `/accept-invitation?token=${encodeURIComponent(invitationToken)}`
                : '/logout?next=/forgot-password'
            }
            className={buttonClasses({ size: 'lg', fullWidth: true })}
          >
            {invitationToken ? t.auth.backToInvitation : t.auth.requestNewLink}
          </a>
          <div className="text-center">
            <a href="/logout" className={`${TEXT_LINK_CLASSES} min-h-7 text-callout`}>
              {t.auth.backToLogin}
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <h1 className={AUTH_TITLE_CLASSES}>{t.auth.newPassword}</h1>
            <p className={AUTH_SUBTITLE_CLASSES}>{t.auth.enterNewPassword}</p>
          </div>
          {verifying && (
            <p role="status" className="text-body text-secondary">
              {t.auth.verifyingPasswordSetupLink}
            </p>
          )}
          {error && (
            <div role="alert" className={AUTH_ERROR_CLASSES}>
              {error}
            </div>
          )}

          <Field label={t.auth.newPasswordLabel} id="new-password" help={t.auth.passwordHelp} error={passwordError}>
            {(control) => (
              <PasswordInput
                {...control}
                ref={passwordRef}
                autoComplete="new-password"
                shown={showPassword}
                onToggle={() => setShowPassword(!showPassword)}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(passwordLengthOk(e.target.value) ? '' : t.auth.passwordMinLength);
                }}
                onBlur={(e) => {
                  if (e.target.value)
                    setPasswordError(passwordLengthOk(e.target.value) ? '' : t.auth.passwordMinLength);
                }}
                required
                minLength={12}
                maxLength={128}
              />
            )}
          </Field>

          <Field label={t.auth.confirmPasswordLabel} id="confirm-password" error={confirmError}>
            {(control) => (
              <TextInput
                {...control}
                ref={confirmRef}
                size="lg"
                autoComplete="new-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (confirmError && e.target.value === password) setConfirmError('');
                }}
                onBlur={(e) => {
                  if (e.target.value) setConfirmError(e.target.value === password ? '' : t.auth.passwordsDontMatch);
                }}
                required
                minLength={12}
                maxLength={128}
              />
            )}
          </Field>

          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={loading}
            loadingLabel={t.auth.updatingPassword}
            disabled={loading || !setupUserId}
          >
            {t.auth.updatePassword}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
