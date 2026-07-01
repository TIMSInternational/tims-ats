/**
 * Whether CAPTCHA verification may be skipped when TURNSTILE_SECRET_KEY is not
 * configured. Fail CLOSED in production: an unconfigured secret must never leave
 * the only unauthenticated write (applyToVacancy) unprotected. Skipping is
 * allowed only outside production (dev/test) so local flows keep working.
 */
export function captchaBypassAllowed(
  secret: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  return !secret && nodeEnv !== 'production';
}
