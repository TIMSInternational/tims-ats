# Fix: impersonation propagates effective identity to server RSCs (#81)

## Problem (root cause — verified)

When a platform owner impersonates an org user, only the **client/tRPC** path resolves
the effective (impersonated) identity, so the sidebar **nav manifest** switches but:

1. `apps/web/app/(admin)/dashboard/page.tsx` reads only the real Supabase session →
   platform owner always renders `<PlatformDashboard/>` (its `platform.*` queries then
   403 under the impersonated org identity).
2. `apps/web/app/(admin)/layout.tsx:113` computes `shell = manifestFor(roleSlugs).shell`
   from the **real** owner's `roleSlugs` (line 52), not the target's → wrong shell chrome
   (participant roles render in the dark admin theme, not the light `ParticipantSidebar`).

The layout's existing `effective` block (85–100) swaps only **display** fields
(name/avatar/email), never roles. `layout.tsx:119`
(`isPlatformOwner={effective?.isPlatformOwner || false}`) is **already correct** — leave it.

The tRPC context builder (`apps/web/app/api/trpc/[trpc]/route.ts`) is the correct
reference: real user → if `isPlatformOwner` + valid signed cookie → `ctx.user` becomes the
target with `roles = filterStaffRoleSlugs(target.userRoles…)`, `isPlatformOwner: false`,
guarded by `target.isActive && target.organizationId && !target.isPlatformOwner`.

## Design — one shared server helper (architecturally complete)

The bug exists because identity resolution is **duplicated across three RSCs/contexts**
and one copy (the dashboard page) was missing, another (layout) was partial. Fix the
*shape*, not just the symptom: introduce a single server-only helper both RSCs call.

**New file `apps/web/lib/auth/effective-identity.ts`** (`import 'server-only'`):

- **Pure, unit-tested core** `resolveEffectiveIdentity(real, target)`:
  - `target` is null (not impersonating) or an already-validated target.
  - target present → effective = target: `{ isPlatformOwner: false, organizationId,
    roleSlugs: filterStaffRoleSlugs(target.roleSlugs), displayName, initials, email,
    avatar, isImpersonating: true }`.
  - target null → effective = real (preserve `real.isPlatformOwner`, `filterStaffRoleSlugs`
    on real roles, `isImpersonating: false`).
  - `displayName = "First Last"`, `initials = (First[0]+Last[0]).toUpperCase()`.
- **Thin IO wrapper** `getEffectiveIdentity()`, wrapped in React `cache()` so layout +
  page share one round-trip per render:
  1. `getUser()`; none → `redirect('/login')`.
  2. Load `appUser` (union of fields layout + page need, incl. `userRoles`); fails the
     existing staff guard `!appUser || !isActive || (!isPlatformOwner && !organizationId)`
     → `redirect('/logout')`.
  3. If `appUser.isPlatformOwner`: `cookies()` → `verifyImpersonationToken` → load target
     (`include userRoles`) → **mirror the tRPC guard exactly**
     (`target.isActive && target.organizationId && !target.isPlatformOwner`) → target.
  4. `resolveEffectiveIdentity(real, target)`.
  5. Avatar fallback preserved: `effective.avatar ?? (isImpersonating ? null :
     supabaseUser.user_metadata?.avatar_url ?? null)`.
  6. Also return `realRoleSlugs` + `realIsPlatformOwner` for the **MFA gate**.

**Consumers:**
- `layout.tsx`: replace the inline getUser/appUser/effective block with
  `getEffectiveIdentity()`. `shell = manifestFor(effective.roleSlugs).shell`. Pass
  `isPlatformOwner={effective.isPlatformOwner}`, `displayName/initials/avatar` from
  effective. **MFA gate stays on `realRoleSlugs`/`realIsPlatformOwner`** — comment 44–51
  is explicit that MFA reflects the operator, not the impersonated identity. No MFA change.
- `dashboard/page.tsx`: `getEffectiveIdentity()` → `if (effective.isPlatformOwner) return
  <PlatformDashboard/>` else `<RecruitmentDashboard roleSlugs={effective.roleSlugs} />`.

## Guardrails / non-goals

- **Do NOT touch the tRPC context builder.** It already works; DRY-ing it onto the shared
  helper is a *behavior-preserving refactor of the auth hot path*, out of scope for this
  bugfix. Noted as a deferred follow-up (helper cites tRPC as the parity reference).
- **MFA semantics unchanged** — keyed to the real session.
- Guard + `filterStaffRoleSlugs` must match tRPC byte-for-byte (no new client/server split).

## Tests

- Unit (vitest) on `resolveEffectiveIdentity`: not-impersonating → real preserved
  (platform owner stays `isPlatformOwner: true`); impersonating → target identity
  (`isPlatformOwner: false`, target roles/display); initials/displayName formatting;
  staff-role filtering applied.
- `manifestFor`/`pickPrimaryDashboard`/`pickSidebarVariant` already pure-tested — the wiring
  proof is the live verification below (RSCs aren't unit-tested here, per repo pattern).

## Verification

- Local gate: `@tims/api` tsc, `apps/web` tsc, `npx vitest run`, `apps/web` next build.
- Prod (Playwright, platform_owner login): impersonate `employee@tims.co` → lands on
  **My Home** in the **light ParticipantSidebar**, zero `platform.*` 403s; impersonate
  `admin@tims.co` (super_admin) → **Org Command Center** in the dark admin shell; stop
  impersonation → platform owner sees PlatformDashboard again.
