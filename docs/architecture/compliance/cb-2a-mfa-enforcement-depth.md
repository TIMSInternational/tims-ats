# CB-2a — MFA Enforcement Depth (design/spec)

Date: 2026-07-17 · Track: [[tims-soc2-iso27001-compliance]] · Roadmap `docs/architecture/compliance/00-compliance-by-design-roadmap.md` (CB-2).
Follows CB-1c (security-event coverage, #147). First slice of CB-2 (identity assurance + access governance).

## Problem
MFA is already built — enroll/challenge/manage UI (`apps/web/app/mfa/`), pure gate logic (`apps/web/lib/mfa.ts`),
and a **page-only** enforcement gate in `apps/web/app/(admin)/layout.tsx:33` (a server-component redirect to
`/mfa` for privileged roles, behind the fail-open `MFA_ENFORCED` env flag). But `aal` (Supabase Authenticator
Assurance Level) appears NOWHERE in `packages/api`/`packages/auth`: the tRPC/API layer does not check it. A
privileged `aal1` session can call tRPC mutations directly (role assignment, platform actions) and bypass the
page redirect. Flipping `MFA_ENFORCED=true` today would leave enforcement **bypassable**. This slice makes MFA
enforcement real at the API layer.

## Scope (deliberate)
Privileged-only, MIRRORING the existing page gate exactly: `isPlatformOwner` OR a `super_admin`/`platform_owner`
role — the same set that bypasses permission checks in trpc.ts. **No new policy decision**; the broader
all-staff-MFA question stays deferred. Behind the SAME `MFA_ENFORCED` flag (fail-OPEN — an unset/garbled flag
means "not enforced", so a misconfig can never lock privileged users out of prod; only the literal `"true"`
turns it on, mirroring `RLS_ENFORCED`). Ships DARK (flag off) until Federico flips it in Vercel.

## Design

1. **Single source of truth.** Extract the pure gate from `apps/web/lib/mfa.ts` → `@tims/shared`
   (`isMfaEnforced`, `isMfaSatisfied`, `isMfaGateBlocking`, `mfaMode`, + a NEW `isMfaPrivileged({ roles,
   isPlatformOwner })`). Both the page layout and the new tRPC middleware import from `@tims/shared`, killing the
   "keep these in sync" hazard the layout comment warns about. `apps/web/lib/mfa.ts` re-exports for existing
   imports (behavior-preserving).

2. **`aal` transport (approach A, chosen).** `packages/auth/src/middleware.ts` `updateSession` already validates
   the session (`getUser()`) and forwards `x-tims-auth-uid`/`email`. Add: strip inbound `x-tims-auth-aal`
   (forgery defense, same as the others), and after the session validates, derive `currentLevel` via
   `supabase.auth.getAuthenticatorAssuranceLevel()` (LOCAL JWT decode of the `aal` claim — no network round-trip)
   and set `x-tims-auth-aal`. `createContext` (route.ts) reads it onto `ctx.aal`; `TRPCContext` gains
   `aal?: string | null`. Matches the existing fast-path; zero extra round-trips. (Alt B — call
   `getAuthenticatorAssuranceLevel()` inside `createContext` — adds a call per request, undoing the #100
   double-`getUser` win. Rejected.)

3. **The gate.** A `withMfaEnforcement` tRPC middleware composed into `protectedProcedure` (AFTER auth +
   tenant): if `isMfaEnforced(process.env.MFA_ENFORCED) && isMfaPrivileged(ctx.user) && !isMfaSatisfied(ctx.aal)`
   → throw a `TRPCError` `FORBIDDEN` carrying an `MFA_REQUIRED` marker (a stable sentinel in the message/cause so
   the client can distinguish it from an ordinary permission 403). External / candidate / anonymous surfaces are
   NOT privileged-staff and are unaffected (candidateProcedure/externalProcedure don't build on
   protectedProcedure).

4. **Client reaction.** The web tRPC client maps the `MFA_REQUIRED` marker → client-side redirect to `/mfa` (the
   same destination as the page gate). Exact client link located during build.

5. **Audit (ties into CB-1c).** The gate records ONE distinct `mfa_step_up_required` security event
   (`logSecurityEvent`, fail-soft). To avoid a double row, the CB-1c `observeDenial` skips FORBIDDENs that carry
   the `MFA_REQUIRED` marker (they're audited here with the richer, MFA-specific action).

6. **Tests** (`tests/security/mfa-enforcement.test.ts` + reuse existing `lib/mfa` tests):
   - pure gate + `isMfaPrivileged` (moved to @tims/shared) still bite;
   - **mirror-set parity guard**: the tRPC privileged set == the page gate set == trpc.ts privileged set (a
     drift test — a role one treats as privileged but another doesn't would silently escape MFA);
   - behavioral (mini-tRPC caller like CB-1c): privileged `aal1` → `MFA_REQUIRED` FORBIDDEN when enforced;
     privileged `aal2` → allowed; non-privileged `aal1` → allowed; `MFA_ENFORCED` off → allowed (no-op);
     the block emits exactly ONE `mfa_step_up_required` and NOT an `authz_denied`.

7. **Deploy / verify.** Ships dark (flag off). Federico flips `MFA_ENFORCED=true` in Vercel (+ ensures privileged
   users have enrolled a factor first — the page gate already routes them through `/mfa`). Deploy-verify: with the
   flag on, a privileged `aal1` tRPC call returns the `MFA_REQUIRED` FORBIDDEN and the client redirects to `/mfa`;
   an `aal2` session proceeds.

## Review gate (fresh reviewer + Codex adversarial + opus) — findings & fixes
Fresh reviewer + Codex **CONVERGED** on the same 2 Highs (both otherwise confirmed forgery-safe transport, no
lockout, correct fail-open/closed, no perf regression, correct context wrap, correct observeDenial de-dup). Fixed
in-branch bite-proven (gate re-green: api/web tsc 0, vitest 2180/2180):
- **H1 — `/api/impersonate/start` bypass.** The gate only covered tRPC `protectedProcedure`; `/api/impersonate/
  start` is a raw Next REST route with no aal check → an aal1 owner could start impersonation and operate as a
  non-privileged target (where the tRPC gate no-ops), escaping MFA on the crown-jewel account. FIX: gate the route
  on aal2 when `MFA_ENFORCED` (mirror the page gate) → 403 `{ error: MFA_REQUIRED }`; the impersonate button
  redirects the owner to `/mfa`. (`/stop` left un-gated — it de-escalates, not escalates.)
- **H2/M1 — tRPC gate used the effective (impersonated) principal.** During impersonation ctx.user is the
  non-privileged target, so `isMfaPrivileged` was false and the gate no-opped. FIX: treat an active impersonation
  as privileged (`|| Boolean(ctx.user.impersonatorId)`) — the real operator is always an owner and ctx.aal is the
  operator's OWN level (impersonation is a cookie, not a session swap), so this enforces MFA against the operator.
  Defense-in-depth with H1 (closes the flag-flipped-mid-impersonation edge too).

## Out of scope (later CB-2 slices)
- **MFA lifecycle audit** (enroll / unenroll / verify) + **`login_failed`** — both are client-side Supabase calls
  with no server touchpoint; they land in the **CB-2 auth-hook slice** (Supabase Auth Hook / GoTrue webhook —
  needs Federico's Supabase config), as decided for CB-1c #4.
- **Access-review / recertification tooling** (users × roles × grants × last-login × deprovision + quarterly
  recert) — the other CB-2 slice; unblocked, built next.
- **All-staff MFA** — a policy decision (grace period, enrollment enforcement) separate from closing this bypass.

## Compliance mapping
SOC 2 CC6.1 (logical access / authentication) · ISO 27001 A.8.5 (secure authentication). Pairs with CB-1c
(the enforcement block is itself an audited security event) + CB-1b (immutable audit).
