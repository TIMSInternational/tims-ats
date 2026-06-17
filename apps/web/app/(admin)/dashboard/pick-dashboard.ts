export type DashboardKey = 'org' | 'recruiter' | 'manager' | 'leader' | 'employee';

// super_admin removed from RECRUITER_ROLES → gets its own Org Command Center.
// leader → its purpose-built Manager Dashboard ('manager').
// committee stays on the thin LeaderDashboard ('leader') until Slice 4 builds
// its participant "My Tasks".
const RECRUITER_ROLES = ['hr_admin', 'recruiter', 'hrbp'] as const;

function isOneOf(roles: readonly string[], slug: string): boolean {
  return roles.includes(slug);
}

// Precedence: super_admin > recruiter-tier > leader > committee > employee.
export function pickPrimaryDashboard(roleSlugs: readonly string[]): DashboardKey {
  if (roleSlugs.includes('super_admin')) return 'org';
  if (roleSlugs.some((r) => isOneOf(RECRUITER_ROLES, r))) return 'recruiter';
  if (roleSlugs.includes('leader')) return 'manager';
  if (roleSlugs.includes('committee')) return 'leader';
  return 'employee';
}
