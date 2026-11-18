// Company self-registration gate. Server-only by convention (reads a non-NEXT_PUBLIC var); kept free of
// 'server-only' so the repo-root vitest harness can import it directly.
//
// SELF_SERVE_SIGNUP_ENABLED:
//   'true'  → on
//   'false' → off
//   unset   → OFF when VERCEL_ENV === 'production', ON everywhere else (local dev, previews, tests).
//
// When off, /register shows an invitation-only notice and /auth/callback never creates an organization.
// Candidate portal OTP sign-in, invitation acceptance, password reset and existing-user OAuth are not
// affected: none of them go through the company-signup branch.

type SignupEnv = { readonly [key: string]: string | undefined };

export function isSelfServeSignupEnabled(env: SignupEnv = process.env): boolean {
  const raw = env.SELF_SERVE_SIGNUP_ENABLED?.trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return env.VERCEL_ENV !== 'production';
}
