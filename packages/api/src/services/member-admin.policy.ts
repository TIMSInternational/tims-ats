// ---------------------------------------------------------------------------
// Tenant member administration — who may change whose role or deactivate whom (pure)
// ---------------------------------------------------------------------------
// The /settings/users members table lets a company admin change a colleague's role or deactivate a
// leaver. `user:update` / `user:delete` say WHETHER the caller may manage people; this policy says WHICH
// people and WHICH changes, so a permission holder can never:
//   • act on their own account (a self-demotion or self-deactivation locks the org admin out),
//   • act on a platform-owner account (only the platform owner manages those),
//   • act on someone holding a role they could not grant themselves (an hr_admin cannot demote or
//     deactivate a super_admin — the same ladder as InvitationGrantPolicy / canGrantStaffRole),
//   • grant a role they could not grant (the existing user.create / assignRole rule),
//   • leave the organization without an active super_admin.
// Pure, so node tests pin every branch; the router turns a refusal into a TRPCError.

import { canGrantStaffRole } from '@tims/shared';

export type MemberChangeRefusal =
  | 'self'
  | 'platform_owner'
  | 'target_above_caller'
  | 'role_not_grantable'
  | 'last_super_admin';

export interface MemberChangeInput {
  actorId: string;
  actorRoles: readonly string[];
  target: { id: string; isPlatformOwner: boolean; roleSlugs: readonly string[] };
  /** The new role for a role change; omitted for a deactivation. */
  newRole?: string;
  /** Active super_admins in the organization OTHER than the target. Only read when the change removes one. */
  otherActiveSuperAdmins: number;
}

/** True when the change takes a super_admin away from the organization (demotion or deactivation). */
export function removesSuperAdmin(targetRoles: readonly string[], newRole?: string): boolean {
  return targetRoles.includes('super_admin') && newRole !== 'super_admin';
}

/** The reason this change is refused, or null when it may proceed. */
export function memberChangeRefusal(input: MemberChangeInput): MemberChangeRefusal | null {
  const { actorId, actorRoles, target, newRole } = input;
  if (target.id === actorId) return 'self';
  if (target.isPlatformOwner) return 'platform_owner';
  if (target.roleSlugs.some((role) => !canGrantStaffRole(actorRoles, role))) return 'target_above_caller';
  if (newRole !== undefined && !canGrantStaffRole(actorRoles, newRole)) return 'role_not_grantable';
  if (removesSuperAdmin(target.roleSlugs, newRole) && input.otherActiveSuperAdmins < 1) return 'last_super_admin';
  return null;
}

/**
 * Advisory-lock key that serializes every role change and deactivation inside one organization. The
 * last-super_admin count and the delete-then-create role replacement are read-then-write sequences: two
 * admins deactivating each other, or two concurrent role changes on one member, would otherwise both pass
 * their checks and commit (zero super_admins left, or two roles kept). Taken first in each write
 * transaction, by the tenant writers (user.assignRole / user.deactivate) and the platform writer
 * (platform.changeOrgUserRole) alike.
 */
export function memberAdminLockKey(organizationId: string): string {
  return `member-admin:${organizationId}`;
}

/** Spanish message for each refusal (the API's user-facing error text). */
export const MEMBER_CHANGE_REFUSAL_MESSAGES: Readonly<Record<MemberChangeRefusal, string>> = {
  self: 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta.',
  platform_owner: 'Esta cuenta pertenece a un administrador de la plataforma y no se gestiona desde aquí.',
  target_above_caller: 'No puedes modificar a un usuario con un rol superior al tuyo.',
  role_not_grantable: 'No puedes asignar un rol superior al tuyo.',
  last_super_admin: 'La organización debe conservar al menos un Super Administrador activo.',
};
