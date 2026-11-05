// Maps a Supabase Auth error (sign-in, password-reset email, OAuth start) onto translated copy, so the
// staff never see the provider's raw English text ("Email rate limit exceeded", "Failed to fetch", …).
// Keyed on the stable `code` / `status` / `name` fields, never on the message, except the legacy
// "Invalid login credentials" message older GoTrue versions send without a code. Unknown errors fall
// back to the caller's generic message. Pure: no React / next imports.

export type AuthErrorCopy = {
  readonly invalidCredentials: string;
  readonly emailNotConfirmed: string;
  readonly authRateLimited: string;
  readonly authNetworkError: string;
  readonly accountDisabled: string;
  readonly invalidEmail: string;
};

const RATE_LIMIT_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit']);

function field(error: object, key: 'code' | 'name' | 'message'): string | undefined {
  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' ? value : undefined;
}

export function authErrorMessage(error: unknown, copy: AuthErrorCopy, fallback: string): string {
  if (typeof error !== 'object' || error === null) return fallback;
  const code = field(error, 'code');
  const name = field(error, 'name');
  const statusValue: unknown = Reflect.get(error, 'status');
  const status = typeof statusValue === 'number' ? statusValue : undefined;

  if (code === 'invalid_credentials' || field(error, 'message') === 'Invalid login credentials') {
    return copy.invalidCredentials;
  }
  if (code === 'email_not_confirmed') return copy.emailNotConfirmed;
  if ((code && RATE_LIMIT_CODES.has(code)) || status === 429) return copy.authRateLimited;
  if (code === 'user_banned') return copy.accountDisabled;
  if (code === 'email_address_invalid') return copy.invalidEmail;
  // supabase-js reports an unreachable / timed-out auth server as AuthRetryableFetchError (status 0
  // for a failed fetch, 5xx gateway codes otherwise).
  if (name === 'AuthRetryableFetchError' || code === 'request_timeout' || status === 0) return copy.authNetworkError;
  return fallback;
}
