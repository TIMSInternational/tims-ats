import { isMfaPrivileged } from '@tims/shared';

/**
 * CB-2b — access-review risk kernel (pure, deterministic).
 *
 * Given a staff user's status + role assignments, classify their access and raise the
 * risk flags a quarterly access review (SOC 2 CC6.2–6.3 / ISO A.5.18) must surface.
 * Pure + `now`-injected so it is golden-testable and every flag can be bite-proven.
 */
export const STALE_LOGIN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessStatus = 'active' | 'inactive' | 'deleted';

export interface RoleAssignment {
  slug: string;
  /** The role's owning org — compared to the user's org to detect grant corruption. */
  organizationId: string;
  expiresAt: Date | null;
}

export interface AccessRiskFlags {
  /** Active account that has NEVER logged in (a dangling grant). */
  neverLoggedIn: boolean;
  /** Active account whose last login is older than STALE_LOGIN_DAYS. */
  stale: boolean;
  /** Holds a privileged role (platform_owner / super_admin) — extra scrutiny. */
  privileged: boolean;
  /** Deprovisioning gap: inactive/deleted account that STILL holds ≥1 role (a JML failure). */
  deprovisionGap: boolean;
  /** Active account holding a role whose expiry has passed — enforcement ignores expiry,
   *  so this is LIVE lingering access the review must catch. */
  expiredGrant: boolean;
  /** Holds a role that belongs to a DIFFERENT org than the user (grant corruption). */
  crossOrgRole: boolean;
}

export interface UserAccessInput {
  organizationId: string;
  isActive: boolean;
  deletedAt: Date | null;
  lastLoginAt: Date | null;
  roles: RoleAssignment[];
  isPlatformOwner: boolean;
  now: Date;
}

export function accessStatusOf(u: { isActive: boolean; deletedAt: Date | null }): AccessStatus {
  if (u.deletedAt) return 'deleted';
  if (!u.isActive) return 'inactive';
  return 'active';
}

export function assessUserAccess(u: UserAccessInput): { status: AccessStatus; flags: AccessRiskFlags } {
  const status = accessStatusOf(u);
  const active = status === 'active';
  const hasGrant = u.isPlatformOwner || u.roles.length > 0;
  const nowMs = u.now.getTime();
  return {
    status,
    flags: {
      neverLoggedIn: active && u.lastLoginAt === null,
      stale:
        active && u.lastLoginAt !== null && nowMs - u.lastLoginAt.getTime() > STALE_LOGIN_DAYS * DAY_MS,
      // Reuse the CB-2a single-source privileged set so "privileged" means the same
      // thing here, in the MFA gate, and in the (admin) page gate.
      privileged: isMfaPrivileged({ roles: u.roles.map((r) => r.slug), isPlatformOwner: u.isPlatformOwner }),
      deprovisionGap: !active && hasGrant,
      expiredGrant:
        active && u.roles.some((r) => r.expiresAt !== null && r.expiresAt.getTime() < nowMs),
      // Only meaningful for an org-scoped user; owners carry no real userRoles.
      crossOrgRole: u.roles.some((r) => r.organizationId !== u.organizationId),
    },
  };
}
