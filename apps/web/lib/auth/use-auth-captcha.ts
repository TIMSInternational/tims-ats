'use client';

import { useCallback, useState } from 'react';

// Turnstile for the staff auth pages (/login, /forgot-password, /register, /accept-invitation): Pilot UX
// re-audit C-34. Supabase Auth captcha protection can only be switched on once EVERY browser call that
// Supabase checks (signInWithPassword, signUp, resetPasswordForEmail, signInWithOtp) sends a token; the
// candidate portal already does. Until the owner enables it, Supabase ignores the token. Without a site key
// (NEXT_PUBLIC_TURNSTILE_SITE_KEY) nothing is rendered and nothing is required.

export interface AuthCaptcha {
  siteKey: string | undefined;
  /** Remount key: a Turnstile token is single-use, so every attempt gets a fresh widget. */
  widgetKey: number;
  setToken: (token: string | null) => void;
  /** True when no site key is configured or a token is ready. */
  satisfied: boolean;
  /** `{ captchaToken }` for the Supabase call, or {} when there is no token. */
  tokenOption: () => { captchaToken?: string };
  /** Drop the used token and remount the widget. Call after every attempt, successful or not. */
  reset: () => void;
}

export function useAuthCaptcha(): AuthCaptcha {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
  const [token, setToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setWidgetKey((key) => key + 1);
  }, []);
  const tokenOption = useCallback(() => (token ? { captchaToken: token } : {}), [token]);
  return { siteKey, widgetKey, setToken, satisfied: !siteKey || !!token, tokenOption, reset };
}
