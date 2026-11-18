'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import Link from 'next/link';
import { useI18n } from '../../../lib/i18n';
import { isSsoSignInOffered } from '../../../lib/auth/sso-sign-in';
import { safeStaffRedirectPath } from '../../../lib/auth/staff-login-redirect';
import { rememberPostLoginDestination } from '../../../lib/auth/post-login-destination';
import { authErrorMessage } from '../auth-error-message';
import { loginErrorMessage, loginNoticeMessage } from './login-error-message';
import { SsoButtons } from './sso-buttons';
import { useAuthCaptcha } from '../../../lib/auth/use-auth-captcha';
import { AuthCaptcha } from '../../../components/auth-captcha';
import { Button } from '../../../components/button';
import { TEXT_LINK_CLASSES } from '../../../components/button-styles';
import { Field } from '../../../components/field';
import { TextInput } from '../../../components/text-input';
import { PasswordInput } from '../password-input';
import { CaptchaHint } from '../captcha-hint';
import {
  AuthCard,
  AUTH_ERROR_CLASSES,
  AUTH_NOTICE_CLASSES,
  AUTH_PROMPT_CLASSES,
  AUTH_SUBTITLE_CLASSES,
  AUTH_TITLE_CLASSES,
} from '../auth-card';

// Staff login form. `showSignup` comes from the server page (SELF_SERVE_SIGNUP_ENABLED is server-only):
// invitation-only deployments do not advertise /register.
export function LoginForm({ showSignup }: { showSignup: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = loginErrorMessage(searchParams.get('error'), t.auth);
  const notice = loginNoticeMessage(searchParams.get('reason'), t.auth);
  // Only same-origin paths (no scheme, no '//' or '/\\' host escape, no auth pages) to prevent
  // open-redirect / OAuth redirectTo manipulation. Path AND query are kept (deep links survive login).
  const redirect = safeStaffRedirectPath(searchParams.get('redirect')) ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // C-34: Turnstile token for Supabase Auth captcha (single-use: reset after every attempt).
  const captcha = useAuthCaptcha();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captcha.satisfied) return;
    setLoading(true);
    setError('');

    const captchaOption = captcha.tokenOption();
    captcha.reset();
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
        ...(captchaOption.captchaToken ? { options: captchaOption } : {}),
      });

      if (authError) {
        setError(authErrorMessage(authError, t.auth, t.auth.loginFailed));
        setLoading(false);
        return;
      }
    } catch (thrown) {
      setError(authErrorMessage(thrown, t.auth, t.auth.loginFailed));
      setLoading(false);
      return;
    }

    // Survives a mandatory MFA step: the gate sends privileged users to a bare /mfa first.
    rememberPostLoginDestination(redirect);
    router.push(redirect);
    router.refresh();
  };

  const captchaPending = captcha.siteKey !== undefined && !captcha.satisfied;

  return (
    <AuthCard>
      <h1 className={AUTH_TITLE_CLASSES}>{t.auth.login}</h1>
      <p className={`${AUTH_SUBTITLE_CLASSES} mb-6`}>{t.auth.loginSubtitle}</p>

      {isSsoSignInOffered() && <SsoButtons redirect={redirect} onError={setError} />}

      {notice && !error && !callbackError && (
        <div role="status" className={`mb-4 ${AUTH_NOTICE_CLASSES}`}>
          {notice}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        {(error || callbackError) && (
          <div role="alert" className={AUTH_ERROR_CLASSES}>
            {error || callbackError}
          </div>
        )}

        <Field label={t.auth.email} id="login-email">
          {(control) => (
            <TextInput
              {...control}
              size="lg"
              name="email"
              autoComplete="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="tu@empresa.com"
            />
          )}
        </Field>

        <div>
          <Field label={t.auth.password} id="login-password">
            {(control) => (
              <PasswordInput
                {...control}
                name="password"
                autoComplete="current-password"
                shown={showPassword}
                onToggle={() => setShowPassword(!showPassword)}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            )}
          </Field>
          {/* After the field, so Tab goes Email → Password (text-fields.md › Best practices). */}
          <div className="mt-1.5 flex justify-end">
            <Link href="/forgot-password" className={`${TEXT_LINK_CLASSES} min-h-7 text-callout`}>
              {t.auth.forgotPassword}
            </Link>
          </div>
        </div>

        <AuthCaptcha captcha={captcha} />

        <div>
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={loading}
            loadingLabel={t.auth.loggingIn}
            disabled={!captcha.satisfied}
            aria-describedby={captchaPending ? 'login-captcha-hint' : undefined}
          >
            {t.auth.loginButton}
          </Button>
          <CaptchaHint id="login-captcha-hint" pending={captchaPending} />
        </div>

        {showSignup ? (
          <p className={AUTH_PROMPT_CLASSES}>
            {t.auth.noAccount}{' '}
            <Link href="/register" className={`${TEXT_LINK_CLASSES} min-h-7`}>
              {t.auth.createAccount}
            </Link>
          </p>
        ) : (
          <p className={AUTH_PROMPT_CLASSES}>{t.auth.invitationOnlyHint}</p>
        )}
      </form>
    </AuthCard>
  );
}
