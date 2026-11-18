// Pure helpers for the candidate (portal) auth flow. No React/next imports so it
// stays unit-testable from the repo-root vitest harness.

// Validate a `next` redirect target from /auth/callback for portal logins. Only a
// same-origin path UNDER /careers/ is allowed, so the value can be safely
// concatenated onto the request origin without enabling an open redirect or an
// escape into the staff app. Returns the path if safe, else null.
export function isSafePortalNext(next: string | null | undefined): string | null {
  if (!next) return null;
  // Reject protocol-relative ("//host"), backslashes, and control chars first.
  if (next.startsWith('//') || /[\\\x00-\x1f]/.test(next)) return null;
  if (!next.startsWith('/careers/')) return null;
  // Normalize against a dummy origin so traversal ("/careers/../dashboard") and any
  // host-injection collapse before we re-check: the result must stay same-origin AND
  // under /careers/. Return the normalized path, never the raw input.
  let url: URL;
  try {
    url = new URL(next, 'https://portal.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://portal.invalid') return null;
  if (!url.pathname.startsWith('/careers/')) return null;
  return url.pathname + url.search;
}

// For a failed portal sign-in: the login page of the portal that `next` points into
// (`/careers/<slug>/login`), or null when `next` is not a safe portal target. The slug is re-validated
// as a single URL-safe segment so nothing else from `next` is carried over.
export function portalLoginPathFor(next: string | null | undefined): string | null {
  const safe = isSafePortalNext(next);
  if (!safe) return null;
  const slug = safe.split('?')[0]!.split('/')[2];
  if (!slug || !/^[A-Za-z0-9_-]{1,100}$/.test(slug)) return null;
  return `/careers/${slug}/login`;
}

// Supabase reports some auth failures (e.g. an expired or already-used magic link: `otp_expired`) only in
// the URL FRAGMENT — `#error=access_denied&error_code=otp_expired&error_description=...` — which never
// reaches the server. True when `hash` (window.location.hash, with or without the leading '#') carries one.
export function hasAuthErrorFragment(hash: string | null | undefined): boolean {
  if (!hash) return false;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return Boolean(params.get('error') || params.get('error_code'));
}

// --- Portal sign-in by emailed code -------------------------------------------------------------------------
// The portal sign-in email carries both a link and a one-time code. The link only works in the browser that
// asked for it (PKCE), so a candidate who reads the email on another device or in a mail app's built-in
// browser types the code on the login page instead (supabase.auth.verifyOtp, type 'email').

// Supabase's default email OTP length, and the length the live sign-in emails promise.
export const PORTAL_OTP_LENGTH = 6;
// Supabase lets one address request a new sign-in email at most once a minute (Auth rate limits).
export const PORTAL_RESEND_COOLDOWN_SECONDS = 60;
// Upper bound for a wait parsed out of an auth error message, so a malformed value cannot freeze the button.
const MAX_PARSED_COOLDOWN_SECONDS = 3600;

// The fields of a supabase-js AuthError this flow reads.
export interface AuthErrorLike {
  message?: string | null;
  status?: number | null;
  code?: string | null;
}

// Digits only, at most PORTAL_OTP_LENGTH: a pasted "123 456" or "123-456" becomes "123456".
export function normalizeOtpInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, PORTAL_OTP_LENGTH);
}

export function isCompleteOtp(code: string): boolean {
  return code.length === PORTAL_OTP_LENGTH && /^\d+$/.test(code);
}

export type OtpSendFailure =
  // The per-address limit: this address was sent an email moments ago, so the code in it is still valid.
  | { kind: 'cooldown'; seconds: number }
  // The project-wide or per-IP limit: no email went out.
  | { kind: 'rate_limited' }
  | { kind: 'captcha' }
  | { kind: 'invalid_email' }
  | { kind: 'generic' };

// Map a signInWithOtp failure to what the candidate should be told. Supabase phrases the per-address limit as
// "For security purposes, you can only request this after 42 seconds." (HTTP 429), so the wait is read from it.
export function classifyOtpSendError(error: AuthErrorLike): OtpSendFailure {
  const message = error.message ?? '';
  const wait = /after (\d{1,6}) seconds?/i.exec(message);
  if (wait) {
    const seconds = Math.min(Math.max(Number(wait[1]), 1), MAX_PARSED_COOLDOWN_SECONDS);
    return { kind: 'cooldown', seconds };
  }
  if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
    return { kind: 'rate_limited' };
  }
  if (error.code === 'captcha_failed' || /captcha/i.test(message)) return { kind: 'captcha' };
  if (error.code === 'email_address_invalid' || error.code === 'validation_failed') return { kind: 'invalid_email' };
  return { kind: 'generic' };
}

export type OtpVerifyFailure = 'invalid_code' | 'too_many_attempts' | 'generic';

// Map a verifyOtp failure. A wrong, expired or already-used code is "Token has expired or is invalid"
// (HTTP 403, code otp_expired).
export function classifyOtpVerifyError(error: AuthErrorLike): OtpVerifyFailure {
  if (error.status === 429 || error.code === 'over_request_rate_limit') return 'too_many_attempts';
  if (error.code === 'otp_expired' || error.status === 403 || /expired|invalid/i.test(error.message ?? '')) {
    return 'invalid_code';
  }
  return 'generic';
}

// Whole seconds left until `deadlineMs`, never negative.
export function secondsUntil(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}
