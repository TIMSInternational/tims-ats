// Pure MFA gate logic — the SINGLE SOURCE OF TRUTH shared by the (admin) page
// layout (server), the /mfa setup page (client), AND the tRPC API-layer enforcement
// middleware (CB-2a). No React, no next/*, no Supabase imports so it stays unit-
// testable from the repo-root vitest harness and importable from every package.
//
// Backed by Supabase Auth MFA (TOTP). Supabase encodes the session's Authenticator
// Assurance Level in the JWT: `aal1` = password only, `aal2` = password + a verified
// second factor used THIS session. We only ever gate on the `currentLevel`.

// Supabase types the assurance level as a branded `string`
// (AuthenticatorAssuranceLevels), not a literal union, so we accept any string and
// compare to the 'aal2' sentinel.
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

// WHO must step up. The privileged set = platform owners + super_admins — exactly the
// set that bypasses permission checks in trpc.ts and the set the (admin) page gate
// blocks. Both the page layout AND the tRPC enforcement middleware call this so the
// two can never drift (a role one treats as privileged but the other doesn't would
// silently escape MFA enforcement).
export function isMfaPrivileged(opts: { roles: string[]; isPlatformOwner: boolean }): boolean {
  if (opts.isPlatformOwner) return true;
  return opts.roles.some((slug) => slug === 'super_admin' || slug === 'platform_owner');
}

// The full decision for a privileged route/procedure: block iff enforcement is on AND
// the principal is privileged AND their session is not stepped up to aal2.
export function isMfaGateBlocking(opts: {
  enforced: boolean;
  isPrivileged: boolean;
  currentLevel: Aal;
}): boolean {
  if (!opts.enforced) return false;
  if (!opts.isPrivileged) return false;
  return !isMfaSatisfied(opts.currentLevel);
}

// Stable marker string carried as the TRPCError `message` when the API-layer gate
// blocks a privileged aal1 session (CB-2a). The web tRPC client maps it → redirect to
// /mfa; the CB-1c denial observer skips it (it is audited distinctly as
// `mfa_step_up_required`, not as a generic `authz_denied`). NOT user-facing copy — a
// machine sentinel.
export const MFA_REQUIRED = 'MFA_REQUIRED';

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
