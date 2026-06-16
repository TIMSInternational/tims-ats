export type DashboardKey = 'org' | 'recruiter' | 'leader' | 'employee';

// super_admin removed from RECRUITER_ROLES → gets its own Org Command Center.
// committee stays under LEADER_ROLES until Slice 4 builds its participant "My Tasks".
const RECRUITER_ROLES = ['hr_admin', 'recruiter', 'hrbp'] as const;
const LEADER_ROLES = ['leader', 'committee'] as const;

function isOneOf(roles: readonly string[], slug: string): boolean {
  return roles.includes(slug);
}

export function pickPrimaryDashboard(roleSlugs: readonly string[]): DashboardKey {
  if (roleSlugs.includes('super_admin')) return 'org';
  if (roleSlugs.some((r) => isOneOf(RECRUITER_ROLES, r))) return 'recruiter';
  if (roleSlugs.some((r) => isOneOf(LEADER_ROLES, r))) return 'leader';
  return 'employee';
}
