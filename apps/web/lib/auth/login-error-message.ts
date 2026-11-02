import { SIGNUP_EMAIL_REJECTED_ERROR } from '../signup-email';

/** The subset of the auth messages the login page shows for a `?error=` code. */
export type LoginErrorMessages = { signupEmailInvalid: string; authCallbackFailed: string };

// Codes /auth/callback redirects to /login with (apps/web/app/auth/callback/route.ts).
const CALLBACK_FAILURES = new Set(['no_code', 'auth_callback_error', 'no_email']);

/**
 * The message for a `/login?error=<code>` redirect, or '' for none/unknown. Unknown codes are never echoed:
 * the query string is attacker-controlled, so only fixed, translated copy is ever shown (#213 tier-1 review:
 * a rejected signup used to land on a login form with no explanation).
 */
export function loginErrorMessage(code: string | null, messages: LoginErrorMessages): string {
  if (code === SIGNUP_EMAIL_REJECTED_ERROR) return messages.signupEmailInvalid;
  if (code !== null && CALLBACK_FAILURES.has(code)) return messages.authCallbackFailed;
  return '';
}
