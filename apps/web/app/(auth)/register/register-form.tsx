'use client';

import { useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { getAuthRedirectUrl } from '@tims/shared';
import Link from 'next/link';
import { useI18n } from '../../../lib/i18n';
import { ensureCanonicalAuthOrigin, useCanonicalAuthOrigin } from '../../../lib/auth/canonical-auth-origin';
import { useAuthCaptcha } from '../../../lib/auth/use-auth-captcha';
import { AuthCaptcha } from '../../../components/auth-captcha';
import { Button } from '../../../components/button';
import { TEXT_LINK_CLASSES } from '../../../components/button-styles';
import { Field } from '../../../components/field';
import { TextInput } from '../../../components/text-input';
import { authErrorMessage } from '../auth-error-message';
import { AUTH_ERROR_CLASSES, AUTH_PROMPT_CLASSES, AUTH_SUBTITLE_CLASSES, AUTH_TITLE_CLASSES } from '../auth-card';
import { AuthSuccess } from '../auth-success';
import { CaptchaHint } from '../captcha-hint';
import { OrDivider } from '../or-divider';
import { PasswordInput } from '../password-input';
import { SsoProviderButtons, type SsoProvider } from '../login/sso-provider-buttons';

type AccountType = 'candidate' | 'company';

const passwordLengthOk = (value: string) => value.length >= 12 && value.length <= 128;

export function RegisterForm({ accountType }: { accountType: AccountType }) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [success, setSuccess] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  // C-34: Turnstile token for Supabase Auth captcha (single-use: reset after every attempt).
  const captcha = useAuthCaptcha();
  const captchaPending = captcha.siteKey !== undefined && !captcha.satisfied;
  useCanonicalAuthOrigin();

  // Same 12–128 rule as before, now shown under the field on blur and while it stays invalid
  // (text-fields.md › Best practices).
  const checkPassword = (value: string) => setPasswordError(passwordLengthOk(value) ? '' : t.auth.passwordMinLength);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ensureCanonicalAuthOrigin()) return;
    if (!captcha.satisfied) return;
    setError('');

    if (!passwordLengthOk(password)) {
      setPasswordError(t.auth.passwordMinLength);
      passwordRef.current?.focus();
      return;
    }

    setLoading(true);
    // Confirmation email link: always the configured app origin (#50).
    let emailRedirectTo: string;
    try {
      emailRedirectTo = getAuthRedirectUrl('/auth/callback');
    } catch {
      setError(t.auth.authEmailLinkUnavailable);
      setLoading(false);
      return;
    }
    const captchaOption = captcha.tokenOption();
    captcha.reset();

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            account_type: accountType,
            company_name: accountType === 'company' ? companyName : undefined,
          },
          emailRedirectTo,
          ...captchaOption,
        },
      });
      if (signUpError) {
        setError(
          signUpError.message === 'User already registered'
            ? t.auth.emailAlreadyRegistered
            : authErrorMessage(signUpError, t.auth, t.auth.registerFailed),
        );
        setLoading(false);
        return;
      }
    } catch (thrown) {
      setError(authErrorMessage(thrown, t.auth, t.auth.registerFailed));
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  const handleSsoSignUp = async (provider: SsoProvider) => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options:
        provider === 'google'
          ? {
              redirectTo: `${window.location.origin}/auth/callback?type=${accountType}`,
              queryParams: { access_type: 'offline', prompt: 'consent' },
            }
          : {
              scopes: 'openid profile email',
              redirectTo: `${window.location.origin}/auth/callback?type=${accountType}`,
            },
    });
  };

  if (success) {
    return (
      <AuthSuccess title={t.auth.verifyEmail} icon="mail">
        <p className="mb-4 text-body text-secondary">
          {t.auth.confirmationSentTo} <strong className="break-all text-primary">{email}</strong>.
        </p>
        <Link href="/login" className={`${TEXT_LINK_CLASSES} min-h-7`}>
          {t.auth.goToLogin}
        </Link>
      </AuthSuccess>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className={AUTH_TITLE_CLASSES}>
          {accountType === 'candidate' ? t.auth.candidateAccountTitle : t.auth.companyAccountTitle}
        </h1>
        <p className={AUTH_SUBTITLE_CLASSES}>
          {accountType === 'candidate' ? t.auth.candidateAccountDesc : t.auth.startFreeTrialDesc}
        </p>
      </div>

      <SsoProviderButtons
        labels={{ google: t.auth.signUpGoogle, azure: t.auth.signUpMicrosoft }}
        onSelect={(provider) => void handleSsoSignUp(provider)}
      />
      <OrDivider label={t.auth.orWithEmail} />

      <form onSubmit={handleRegister} className="space-y-4">
        {error && (
          <div role="alert" className={AUTH_ERROR_CLASSES}>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <Field label={t.auth.firstName} id="register-first-name">
            <TextInput
              size="lg"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </Field>
          <Field label={t.auth.lastName} id="register-last-name">
            <TextInput
              size="lg"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </Field>
        </div>

        {accountType === 'company' && (
          <Field label={t.auth.companyName} id="register-company">
            <TextInput
              size="lg"
              autoComplete="organization"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              placeholder={t.auth.companyNamePlaceholder}
            />
          </Field>
        )}

        <Field label={accountType === 'company' ? t.auth.corporateEmail : t.auth.email} id="register-email">
          <TextInput
            size="lg"
            autoComplete="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="tu@empresa.com"
          />
        </Field>

        <Field label={t.auth.password} id="register-password" help={t.auth.passwordHelp} error={passwordError}>
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
                if (passwordError) checkPassword(e.target.value);
              }}
              onBlur={(e) => {
                if (e.target.value) checkPassword(e.target.value);
              }}
              required
              minLength={12}
              maxLength={128}
            />
          )}
        </Field>

        <AuthCaptcha captcha={captcha} />

        <div>
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={loading}
            loadingLabel={t.auth.creatingAccount}
            disabled={!captcha.satisfied}
            aria-describedby={captchaPending ? 'register-captcha-hint' : undefined}
          >
            {accountType === 'company' ? t.auth.startFreeTrialButton : t.auth.createAccount}
          </Button>
          <CaptchaHint id="register-captcha-hint" pending={captchaPending} />
        </div>

        <p className={AUTH_PROMPT_CLASSES}>
          {t.auth.alreadyHaveAccount}{' '}
          <Link href="/login" className={`${TEXT_LINK_CLASSES} min-h-7`}>
            {t.auth.login}
          </Link>
        </p>
      </form>
    </>
  );
}
