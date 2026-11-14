'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { getAuthRedirectUrl } from '@tims/shared';
import Link from 'next/link';
import { useI18n } from '../../../lib/i18n';
import { ensureCanonicalAuthOrigin, useCanonicalAuthOrigin } from '../../../lib/auth/canonical-auth-origin';
import { authErrorMessage } from '../auth-error-message';
import { useAuthCaptcha } from '../../../lib/auth/use-auth-captcha';
import { AuthCaptcha } from '../../../components/auth-captcha';
import { Button } from '../../../components/button';
import { TEXT_LINK_CLASSES } from '../../../components/button-styles';
import { Field } from '../../../components/field';
import { TextInput } from '../../../components/text-input';
import { CaptchaHint } from '../captcha-hint';
import { AuthSuccess } from '../auth-success';
import { AuthCard, AUTH_ERROR_CLASSES, AUTH_SUBTITLE_CLASSES, AUTH_TITLE_CLASSES } from '../auth-card';

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // C-34: Turnstile token for Supabase Auth captcha (single-use: reset after every attempt).
  const captcha = useAuthCaptcha();
  useCanonicalAuthOrigin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ensureCanonicalAuthOrigin()) return;
    if (!captcha.satisfied) return;
    setLoading(true);
    setError('');

    // The link lands on the CONFIGURED app origin (NEXT_PUBLIC_APP_URL), never on
    // whatever host this page happens to be served from (#50).
    let redirectTo: string;
    try {
      redirectTo = getAuthRedirectUrl('/auth/callback', { recovery: '1' });
    } catch {
      setError(t.auth.authEmailLinkUnavailable);
      setLoading(false);
      return;
    }
    const captchaOption = captcha.tokenOption();
    captcha.reset();
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo, ...captchaOption });
      if (resetError) {
        setError(authErrorMessage(resetError, t.auth, t.auth.resetLinkFailed));
        setLoading(false);
        return;
      }
    } catch (thrown) {
      setError(authErrorMessage(thrown, t.auth, t.auth.resetLinkFailed));
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  };

  const captchaPending = captcha.siteKey !== undefined && !captcha.satisfied;
  const [sentBefore, sentAfter] = t.auth.emailSentBody.split('{email}');

  return (
    <AuthCard>
      {sent ? (
        <AuthSuccess title={t.auth.emailSentTitle} icon="mail">
          <p className="mb-4 text-body text-secondary">
            {sentBefore}
            <strong className="break-all text-primary">{email}</strong>
            {sentAfter}
          </p>
          <div className="flex flex-col items-center gap-1">
            <Link href="/login" className={`${TEXT_LINK_CLASSES} min-h-7`}>
              {t.auth.backToLogin}
            </Link>
            <button type="button" onClick={() => setSent(false)} className={`${TEXT_LINK_CLASSES} min-h-7 text-callout`}>
              {t.auth.useAnotherEmail}
            </button>
          </div>
        </AuthSuccess>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <h1 className={AUTH_TITLE_CLASSES}>{t.auth.recoverPassword}</h1>
            <p className={AUTH_SUBTITLE_CLASSES}>{t.auth.recoverSubtitle}</p>
          </div>
          {error && (
            <div role="alert" className={AUTH_ERROR_CLASSES}>
              {error}
            </div>
          )}
          <Field label={t.auth.email} id="forgot-email">
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
          <AuthCaptcha captcha={captcha} />
          <div>
            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={loading}
              loadingLabel={t.auth.sendingLink}
              disabled={!captcha.satisfied}
              aria-describedby={captchaPending ? 'forgot-captcha-hint' : undefined}
            >
              {t.auth.sendLink}
            </Button>
            <CaptchaHint id="forgot-captcha-hint" pending={captchaPending} />
          </div>
          <div className="text-center">
            <Link href="/login" className={`${TEXT_LINK_CLASSES} min-h-7 text-callout`}>
              {t.auth.backToLogin}
            </Link>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
