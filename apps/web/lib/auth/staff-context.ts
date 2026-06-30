/**
 * staff-context.ts
 *
 * Testable seam for the tRPC context fast-path (Task 6 — S1 auth fast-path).
 *
 * `resolveStaffContext` is a PURE-ISH helper — it takes the trusted header values
 * and a db-lookup function (so it is unit-testable without a live Supabase or
 * Prisma connection). It returns either the fast-path context (active staff /
 * owner) or the `NEEDS_FALLBACK` symbol signalling "fall through to the full
 * getUser() path".
 *
 * This file deliberately has NO `server-only` import so vitest can load it
 * directly. The IO wrapper in route.ts provides the real db call.
 *
 * Security invariant: `trustedUid` is ONLY trusted if middleware already validated
 * it via `supabase.auth.getUser()` and stripped any inbound client-supplied value.
 * The route must NEVER call this with a uid taken directly from the raw request
 * headers without middleware having run first.
 */

import { verifyImpersonationToken, readImpersonationCookie } from '@tims/api';
import { filterStaffRoleSlugs } from '@tims/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape of the app `User` row we need (avoids a full Prisma import). */
export interface StaffAppUser {
  id: string;
  supabaseUserId: string;
  email: string;
  organizationId: string | null;
  isActive: boolean;
  isPlatformOwner: boolean;
  lastLoginAt: Date | null;
  userRoles: Array<{ role: { slug: string } }>;
}

/** The subset of tRPC context that the fast path returns when it resolves. */
export interface FastPathCtxUser {
  id: string;
  supabaseUserId: string;
  email: string;
  organizationId: string;
  roles: string[];
  isPlatformOwner: boolean;
  impersonatorId?: string;
}

export interface FastPathCtx {
  user: FastPathCtxUser;
  /**
   * Mirrors the full path's `supabaseAuth` shape exactly:
   *  - `{ email, userId }` when middleware forwarded a non-empty email
   *    (i.e. the Supabase user had an email, which covers all staff users).
   *  - `null` when `trustedEmail` is empty/absent (same as the full path's
   *    `supabaseUser?.email ? ... : null` branch).
   */
  supabaseAuth: { email: string; userId: string } | null;
  /** Strip x-tims-auth-* from the returned headers for cleanliness. */
  headers: Headers;
}

/** Sentinel: fast-path did not resolve — caller must fall through to getUser(). */
export const NEEDS_FALLBACK = Symbol('NEEDS_FALLBACK');
export type StaffContextResult = FastPathCtx | typeof NEEDS_FALLBACK;

/** DB lookup interface — injectable for unit tests (no live Prisma needed). */
export interface StaffDbLookup {
  findUserBySupabaseId(uid: string): Promise<StaffAppUser | null>;
  findUserById(id: string): Promise<StaffAppUser | null>;
  updateLastLogin(id: string): void;
}

// ---------------------------------------------------------------------------
// Core resolver (unit-testable)
// ---------------------------------------------------------------------------

/**
 * Attempt to build the tRPC context from middleware-validated header values,
 * completely skipping `supabase.auth.getUser()`.
 *
 * Returns `NEEDS_FALLBACK` when:
 *  - `trustedUid` is absent (header not set by middleware — unauthenticated)
 *  - the DB has no row for this uid (candidate / unprovisioned)
 *  - the row is inactive or neither org-scoped nor platform-owner
 *
 * The caller's FULL getUser() path handles all those cases unchanged.
 *
 * @param trustedUid   Value of the `x-tims-auth-uid` header (post-middleware)
 * @param trustedEmail Value of the `x-tims-auth-email` header (post-middleware)
 * @param cookieHeader Raw Cookie header (for the impersonation cookie)
 * @param rawHeaders   The original request headers (used to build returned headers)
 * @param db           Injected DB look-up (allows unit testing without Prisma)
 */
export async function resolveStaffContext(
  trustedUid: string | null,
  trustedEmail: string | null,
  cookieHeader: string | null,
  rawHeaders: Headers,
  db: StaffDbLookup,
): Promise<StaffContextResult> {
  // No header → not set by middleware (no Supabase session or unauthenticated path).
  if (!trustedUid) return NEEDS_FALLBACK;

  const appUser = await db.findUserBySupabaseId(trustedUid);

  // Not a staff/owner row, or not active, or not org-scoped/owner → fall back.
  // Handles: candidate sessions, first-login owner needing auto-create, inactive accounts.
  if (
    !appUser ||
    !appUser.isActive ||
    (!appUser.isPlatformOwner && !appUser.organizationId)
  ) {
    return NEEDS_FALLBACK;
  }

  // Fire-and-forget lastLogin (same threshold as the full path).
  if (appUser.lastLoginAt === null || Date.now() - appUser.lastLoginAt.getTime() > 60_000) {
    db.updateLastLogin(appUser.id);
  }

  // Match the full path exactly: `supabaseUser?.email ? {...} : null`.
  // Middleware sets x-tims-auth-email to `user.email ?? ''`, so an empty string
  // corresponds to the full path's null case (Supabase user had no email).
  const supabaseAuth = trustedEmail
    ? { email: trustedEmail, userId: trustedUid }
    : null;

  const realUser: FastPathCtxUser = {
    id: appUser.id,
    supabaseUserId: appUser.supabaseUserId,
    email: appUser.email,
    organizationId: appUser.organizationId ?? '',
    roles: appUser.isPlatformOwner
      ? ['platform_owner']
      : filterStaffRoleSlugs(appUser.userRoles.map((ur) => ur.role.slug)),
    isPlatformOwner: appUser.isPlatformOwner,
  };

  // Strip x-tims-auth-* from the returned headers for cleanliness.
  const outHeaders = new Headers(rawHeaders);
  outHeaders.delete('x-tims-auth-uid');
  outHeaders.delete('x-tims-auth-email');

  // Impersonation: ONLY a real platform owner with a valid signed cookie.
  // The impersonation cookie is independently verified here — the fast path does
  // NOT bypass it. A forged/expired cookie is inert (verifyImpersonationToken
  // returns null — fail closed).
  if (appUser.isPlatformOwner) {
    const token = readImpersonationCookie(cookieHeader);
    const payload = verifyImpersonationToken(token);
    if (payload) {
      const target = await db.findUserById(payload.targetUserId);
      // Never impersonate another platform owner or an inactive/org-less user.
      if (target && target.isActive && target.organizationId && !target.isPlatformOwner) {
        return {
          user: {
            id: target.id,
            supabaseUserId: target.supabaseUserId,
            email: target.email,
            organizationId: target.organizationId,
            roles: filterStaffRoleSlugs(target.userRoles.map((ur) => ur.role.slug)),
            isPlatformOwner: false,
            impersonatorId: appUser.id,
          },
          supabaseAuth,
          headers: outHeaders,
        };
      }
    }
  }

  return {
    user: realUser,
    supabaseAuth,
    headers: outHeaders,
  };
}
