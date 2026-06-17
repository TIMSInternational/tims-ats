import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUser } from '@tims/auth/server';
import { db } from '@tims/db';
import { verifyImpersonationToken, IMPERSONATION_COOKIE } from '@tims/api';
import { filterStaffRoleSlugs } from '@tims/shared';

// ---------------------------------------------------------------------------
// Effective (impersonation-aware) server identity for the admin RSCs.
//
// Both the admin layout and the dashboard page must render AS the impersonated
// target when a real platform owner holds a valid impersonation cookie — not as
// the operator. This helper resolves that identity ONCE per render (React
// `cache()` dedupes layout + page).
//
// PARITY REFERENCE: apps/web/app/api/trpc/[trpc]/route.ts is the canonical
// resolver. The staff guard, the impersonation guard
// (`target.isActive && target.organizationId && !target.isPlatformOwner`), and
// `filterStaffRoleSlugs` here MUST match it byte-for-byte. The tRPC context
// builder is intentionally NOT refactored onto this helper — DRY-ing the auth
// hot path is a behavior-preserving refactor deferred as a follow-up.
// ---------------------------------------------------------------------------

/** Shape both consumers' identities reduce to before resolution. */
export interface IdentityInput {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  isPlatformOwner: boolean;
  organizationId: string | null;
  roleSlugs: string[];
}

/** Resolved identity the RSCs render with (the target when impersonating). */
export interface EffectiveIdentity {
  userId: string;
  isPlatformOwner: boolean;
  organizationId: string | null;
  roleSlugs: string[];
  displayName: string;
  initials: string;
  email: string;
  avatar: string | null;
  isImpersonating: boolean;
}

/**
 * Pure core: given the REAL identity and an already-validated impersonation
 * `target` (or null), produce the effective identity. No IO — unit-testable.
 *
 * - target present → effective = target, `isPlatformOwner: false`,
 *   `roleSlugs: filterStaffRoleSlugs(target.roleSlugs)`, `isImpersonating: true`.
 * - target null → effective = real (preserving `real.isPlatformOwner`),
 *   `roleSlugs: filterStaffRoleSlugs(real.roleSlugs)`, `isImpersonating: false`.
 */
export function resolveEffectiveIdentity(
  real: IdentityInput,
  target: IdentityInput | null,
): EffectiveIdentity {
  const source = target ?? real;
  const displayName = `${source.firstName} ${source.lastName}`;
  const initials = `${source.firstName[0] ?? ''}${source.lastName[0] ?? ''}`.toUpperCase();
  return {
    userId: source.id,
    isPlatformOwner: target ? false : real.isPlatformOwner,
    organizationId: source.organizationId,
    roleSlugs: filterStaffRoleSlugs(source.roleSlugs),
    displayName,
    initials,
    email: source.email,
    avatar: source.avatar,
    isImpersonating: target !== null,
  };
}

/** Return type of {@link getEffectiveIdentity}. */
export interface ResolvedIdentity {
  effective: EffectiveIdentity;
  /** REAL operator role slugs — the MFA gate keys off these, not the effective ones. */
  realRoleSlugs: string[];
  /** REAL operator platform-owner flag — for the MFA gate. */
  realIsPlatformOwner: boolean;
}

/**
 * IO wrapper: load the real staff identity, honor a platform owner's
 * impersonation cookie, and resolve the effective identity. Wrapped in React
 * `cache()` so the layout + page share one round-trip per render.
 *
 * Note: `cache()` memoizes only a successful return value, NOT a thrown
 * `redirect()` (its internal NEXT_REDIRECT throw is never cached). An auth
 * failure on the first call ends the render; it is safe to call this from
 * multiple RSCs in the same tree.
 */
export const getEffectiveIdentity = cache(async (): Promise<ResolvedIdentity> => {
  const supabaseUser = await getUser();
  if (!supabaseUser) redirect('/login');

  // Recognize the staff/owner user by LINKED Supabase id only (B2 — staff are
  // linked at invite time; no email-join). See docs/SECURITY-staff-candidate-auth-linking.md.
  const appUser = await db.user.findUnique({
    where: { supabaseUserId: supabaseUser.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      isPlatformOwner: true,
      organizationId: true,
      isActive: true,
      avatar: true,
      userRoles: { select: { role: { select: { slug: true } } } },
    },
  });

  // Must be a linked, active staff identity that is org-scoped or a platform owner.
  if (!appUser || !appUser.isActive || (!appUser.isPlatformOwner && !appUser.organizationId)) {
    redirect('/logout');
  }

  const realShaped: IdentityInput = {
    id: appUser.id,
    firstName: appUser.firstName,
    lastName: appUser.lastName,
    email: appUser.email,
    avatar: appUser.avatar,
    isPlatformOwner: appUser.isPlatformOwner,
    organizationId: appUser.organizationId,
    roleSlugs: appUser.userRoles.map((ur) => ur.role.slug),
  };

  // Impersonation: ONLY a real platform owner with a valid signed cookie. Mirror
  // the tRPC guard exactly — never impersonate another owner or an inactive/org-less user.
  let targetShaped: IdentityInput | null = null;
  if (appUser.isPlatformOwner) {
    const cookieStore = await cookies();
    const payload = verifyImpersonationToken(cookieStore.get(IMPERSONATION_COOKIE)?.value);
    if (payload) {
      const target = await db.user.findUnique({
        where: { id: payload.targetUserId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          avatar: true,
          isPlatformOwner: true,
          organizationId: true,
          isActive: true,
          userRoles: { select: { role: { select: { slug: true } } } },
        },
      });
      if (target && target.isActive && target.organizationId && !target.isPlatformOwner) {
        targetShaped = {
          id: target.id,
          firstName: target.firstName,
          lastName: target.lastName,
          email: target.email,
          avatar: target.avatar,
          isPlatformOwner: target.isPlatformOwner,
          organizationId: target.organizationId,
          roleSlugs: target.userRoles.map((ur) => ur.role.slug),
        };
      }
    }
  }

  const effective = resolveEffectiveIdentity(realShaped, targetShaped);

  // Avatar fallback to the Supabase metadata avatar — but only for the operator's
  // OWN session. Never leak the owner's metadata avatar onto an impersonated target.
  const avatar =
    effective.avatar ??
    (effective.isImpersonating ? null : (supabaseUser.user_metadata?.avatar_url ?? null));

  return {
    effective: { ...effective, avatar },
    realRoleSlugs: appUser.userRoles.map((ur) => ur.role.slug),
    realIsPlatformOwner: appUser.isPlatformOwner,
  };
});
