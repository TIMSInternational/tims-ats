import { ASSIGNABLE_STAFF_ROLES, filterStaffRoleSlugs, type AssignableStaffRole } from './roles';

/** The role a staff user gets when none is chosen (mirrors Tims.Domain.Identity.RoleSlugs.DefaultStaffRole). */
export const DEFAULT_STAFF_ROLE: AssignableStaffRole = 'employee';

/**
 * Which staff roles a tenant caller may GRANT (create a user with, assign, or invite as). A caller can never
 * grant a role more privileged than one they hold. This is a line-for-line port of
 * `Tims.Domain.Identity.InvitationGrantPolicy.GrantableRoles` (services/Tims.Platform), and both are asserted
 * against the same golden matrix, contracts/identity-fixtures/invitation-grant-policy.json:
 *   • `super_admin` may grant every assignable staff role (including another super_admin);
 *   • `hr_admin` may grant every assignable staff role EXCEPT `super_admin`;
 *   • anyone else may grant only the staff roles they themselves hold, plus the default `employee`.
 * The result is always a subset of ASSIGNABLE_STAFF_ROLES in catalogue order, so non-staff principals
 * (`external`, `candidate`), `platform_owner` and unknown slugs can never be granted. Matching is exact
 * (case-sensitive), as in C#.
 */
export function grantableStaffRoles(callerRoles: readonly string[]): AssignableStaffRole[] {
  const held = new Set<string>(filterStaffRoleSlugs([...callerRoles]));
  if (held.has('super_admin')) return [...ASSIGNABLE_STAFF_ROLES];
  if (held.has('hr_admin')) return ASSIGNABLE_STAFF_ROLES.filter((role) => role !== 'super_admin');
  held.add(DEFAULT_STAFF_ROLE);
  return ASSIGNABLE_STAFF_ROLES.filter((role) => held.has(role));
}

/** Whether a caller holding `callerRoles` may grant `role` (mirrors InvitationGrantPolicy.CanGrant). */
export function canGrantStaffRole(callerRoles: readonly string[], role: string): boolean {
  return grantableStaffRoles(callerRoles).some((grantable) => grantable === role);
}
