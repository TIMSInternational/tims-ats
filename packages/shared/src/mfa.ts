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

// Owner-controlled widening of the privileged set, without a code deploy. A comma- (or
// space-) separated list of tenant staff role slugs, e.g. `hr_admin,hrbp`. Set it to the
// SAME value as the platform service's Platform__MfaExtraPrivilegedRoles (C# MfaGate) —
// a session refused by one stack and served by the other is the hole #173 closed.
export const MFA_EXTRA_PRIVILEGED_ROLES_ENV = 'MFA_EXTRA_PRIVILEGED_ROLES';

// The only slugs the variable can add. super_admin / platform_owner are always privileged;
// candidate / external are not staff sessions and can never step up.
export const MFA_EXTRA_PRIVILEGED_ROLE_CHOICES = [
  'hr_admin',
  'hrbp',
  'recruiter',
  'leader',
  'committee',
  'employee',
] as const;

const EXTRA_ROLE_CHOICES: ReadonlySet<string> = new Set(MFA_EXTRA_PRIVILEGED_ROLE_CHOICES);

// Parse the variable. Unknown tokens are ignored — fail OPEN, like MFA_ENFORCED: a garbled
// value can never lock anyone out; it just adds nothing. Case-insensitive, de-duplicated.
export function parseMfaExtraPrivilegedRoles(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const slug = token.toLowerCase();
    if (EXTRA_ROLE_CHOICES.has(slug) && !out.includes(slug)) out.push(slug);
  }
  return out;
}

// The variable as this process sees it, read per call. Browser bundles have no such variable
// (it is not NEXT_PUBLIC_), so client-side callers always see the base set.
function extraPrivilegedRolesFromEnv(): string[] {
  if (typeof process === 'undefined' || !process.env) return [];
  return parseMfaExtraPrivilegedRoles(process.env[MFA_EXTRA_PRIVILEGED_ROLES_ENV]);
}

// WHO must step up. The base privileged set = platform owners + super_admins — exactly the
// set that bypasses permission checks in trpc.ts and the set the (admin) page gate
// blocks — plus any roles listed in MFA_EXTRA_PRIVILEGED_ROLES (default: none, so the
// default behaviour is unchanged). Both the page layout AND the tRPC enforcement middleware
// call this so the two can never drift (a role one treats as privileged but the other
// doesn't would silently escape MFA enforcement). `extraRoles` overrides the environment
// (tests and the cross-stack goldens pass it explicitly).
export function isMfaPrivileged(opts: {
  roles: string[];
  isPlatformOwner: boolean;
  extraRoles?: readonly string[];
}): boolean {
  if (opts.isPlatformOwner) return true;
  const extra = opts.extraRoles ?? extraPrivilegedRolesFromEnv();
  return opts.roles.some((slug) => slug === 'super_admin' || slug === 'platform_owner' || extra.includes(slug));
}

// The full decision for a privileged route/procedure: block iff enforcement is on AND
// the principal is privileged AND their session is not stepped up to aal2.
export function isMfaGateBlocking(opts: { enforced: boolean; isPrivileged: boolean; currentLevel: Aal }): boolean {
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
