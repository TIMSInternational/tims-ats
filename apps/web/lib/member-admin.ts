// The /settings/users members table: which role to show for a member and which actions to offer
// (company-admin access-3 / journeys-19 / spec-43 / ideal-78). Pure (no React) so node tests can exercise
// it. UX only — user.assignRole / user.deactivate re-check every rule on the server
// (packages/api/src/services/member-admin.policy.ts).

import { ASSIGNABLE_STAFF_ROLES, canGrantStaffRole, grantableStaffRoles } from '@tims/shared';
import { roleOptions, type RoleLabels, type RoleOption } from './role-labels';
import type { LaunchScope } from './launch-scope';

const CATALOGUE: readonly string[] = ASSIGNABLE_STAFF_ROLES;

/** The member's most privileged staff role (catalogue order), or null when they hold none. */
export function primaryRoleSlug(roleSlugs: readonly string[]): string | null {
  const known = roleSlugs.filter((slug) => CATALOGUE.includes(slug));
  if (known.length === 0) return null;
  return known.sort((a, b) => CATALOGUE.indexOf(a) - CATALOGUE.indexOf(b))[0] ?? null;
}

/**
 * True when the signed-in admin may change this member's role or deactivate them: never their own row,
 * and never someone holding a role the admin could not grant (an hr_admin cannot touch a super_admin).
 */
export function canManageMember(
  actor: { id: string | null; roles: readonly string[] },
  member: { id: string; roleSlugs: readonly string[] },
): boolean {
  if (!actor.id || actor.id === member.id) return false;
  return member.roleSlugs.every((slug) => canGrantStaffRole(actor.roles, slug));
}

/** The roles the admin may give this member, labelled and ordered; the member's current role stays listed. */
export function memberRoleOptions(
  actorRoles: readonly string[],
  labels: RoleLabels,
  currentRole: string | null,
  scope?: LaunchScope,
): RoleOption[] {
  return roleOptions(
    grantableStaffRoles(actorRoles).map((slug) => ({ slug })),
    labels,
    { scope, keep: currentRole ?? undefined },
  );
}
