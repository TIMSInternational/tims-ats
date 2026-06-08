// Pure MFA gate logic — shared by the (admin) layout enforcement check (server)
// and the /mfa setup page (client). No React, no next/*, no Supabase imports so it
// stays unit-testable from the repo-root vitest harness.
//
// Backed by Supabase Auth MFA (TOTP). Supabase encodes the session's Authenticator
// Assurance Level in the JWT: `aal1` = password only, `aal2` = password + a verified
// second factor used THIS session. `getAuthenticatorAssuranceLevel()` returns the
// current and next levels; we only ever gate on `currentLevel`.

// Supabase types the assurance level as a branded `string` (AuthenticatorAssuranceLevels),
// not a literal union, so we accept any string and compare to the 'aal2' sentinel.
export type Aal = string | null | undefined;

// Enforcement is an explicit opt-in env flag (MFA_ENFORCED). It is intentionally
// fail-OPEN: an unset/garbled flag means "not enforced yet", so a misconfigured env
// can never lock privileged users out of production. Only the exact string "true"
// turns the gate on (mirrors RLS_ENFORCED).
export function isMfaEnforced(flag: string | undefined): boolean {
  return flag === 'true';
}

// A session satisfies MFA only at aal2. Unknown/aal1 is fail-CLOSED here: once
// enforcement is on, we never treat an indeterminate level as "good enough".
export function isMfaSatisfied(currentLevel: Aal): boolean {
  return currentLevel === 'aal2';
}

// The full decision for a privileged admin route: redirect to /mfa iff enforcement
// is on AND the user is privileged AND their session is not stepped up to aal2.
export function isMfaGateBlocking(opts: {
  enforced: boolean;
  isPrivileged: boolean;
  currentLevel: Aal;
}): boolean {
  if (!opts.enforced) return false;
  if (!opts.isPrivileged) return false;
  return !isMfaSatisfied(opts.currentLevel);
}

export type MfaMode = 'enroll' | 'challenge' | 'enabled';

// What the /mfa page should render given the user's factor + session state:
//  - no verified factor        → enroll (scan QR + verify)
//  - verified factor, aal1      → challenge (step up this session)
//  - verified factor, aal2      → enabled (manage / disable)
export function mfaMode(opts: { hasVerifiedFactor: boolean; currentLevel: Aal }): MfaMode {
  if (!opts.hasVerifiedFactor) return 'enroll';
  if (isMfaSatisfied(opts.currentLevel)) return 'enabled';
  return 'challenge';
}
