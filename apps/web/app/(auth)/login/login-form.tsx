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

  return (
    <div className="w-full max-w-[420px]">
        {/* Logo — visible only on mobile where left panel is hidden */}
        <div className="text-center mb-8 lg:hidden">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F114C] mb-4">
            <span className="text-white text-xl font-bold">T</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1F114C]">{t.auth.platformName}</h1>
          <p className="text-sm text-[#8B8B8B] mt-1">{t.auth.humanCapitalMgmt}</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] p-8">
          <h2 className="text-lg font-semibold text-[#1F114C] mb-1">{t.auth.login}</h2>
          <p className="text-[13px] text-[#8B8B8B] mb-6">{t.auth.loginSubtitle}</p>

          {isSsoSignInOffered() && <SsoButtons redirect={redirect} onError={setError} />}

          {notice && !error && !callbackError && (
            <div
              role="status"
              className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-800"
            >
              {notice}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            {(error || callbackError) && (
              <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">
                {error || callbackError}
              </div>
            )}

            <div>
              <label htmlFor="login-email" className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.auth.email}</label>
              <input
                id="login-email"
                name="email"
                autoComplete="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full h-11 px-4 rounded-xl border border-[#EDEDED] text-[13px] text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] transition"
                placeholder="tu@empresa.com"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label htmlFor="login-password" className="text-[12px] font-medium text-[#585858]">{t.auth.password}</label>
                <Link href="/forgot-password" className="text-[11px] text-[#DD0C15] hover:underline">
                  {t.auth.forgotPassword}
                </Link>
              </div>
              <div className="relative">
              <input
                id="login-password"
                name="password"
                autoComplete="current-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full h-11 px-4 pr-11 rounded-xl border border-[#EDEDED] text-[13px] text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] transition"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t.auth.hidePasswords : t.auth.showPasswords}
                aria-pressed={showPassword}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8B8B8B] hover:text-[#585858] transition-colors"
              >
                {showPassword ? (
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
              </div>
            </div>

            <AuthCaptcha captcha={captcha} />

            <button
              type="submit"
              disabled={loading || !captcha.satisfied}
              className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold hover:bg-[#2a1a5e] disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? t.auth.loggingIn : t.auth.loginButton}
            </button>

            {showSignup ? (
              <p className="text-center text-[12px] text-[#8B8B8B]">
                {t.auth.noAccount}{' '}
                <Link href="/register" className="text-[#DD0C15] font-medium hover:underline">
                  {t.auth.createAccount}
                </Link>
              </p>
            ) : (
              <p className="text-center text-[12px] text-[#8B8B8B]">{t.auth.invitationOnlyHint}</p>
            )}
          </form>
        </div>

    </div>
  );
}
