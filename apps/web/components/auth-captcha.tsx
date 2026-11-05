'use client';

import type { AuthCaptcha as AuthCaptchaState } from '../lib/auth/use-auth-captcha';
import { TurnstileWidget } from './turnstile-widget';

/** The Turnstile widget of a staff auth form (C-34), or nothing when no site key is configured. */
export function AuthCaptcha({ captcha }: { captcha: AuthCaptchaState }) {
  if (!captcha.siteKey) return null;
  return <TurnstileWidget key={captcha.widgetKey} siteKey={captcha.siteKey} onToken={captcha.setToken} />;
}
