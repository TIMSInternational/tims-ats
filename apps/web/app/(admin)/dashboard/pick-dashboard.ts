import { readLaunchScope, type LaunchScope } from '../../../lib/launch-scope';

export type DashboardKey =
  | 'org'
  | 'hrExec'
  | 'unit'
  | 'recruiter'
  | 'manager'
  | 'committee'
  | 'employee'
  | 'unassigned';

// Each role gets its own purpose-built landing:
//   super_admin → Org Command Center ('org')
//   hr_admin    → HR-Exec dashboard ('hrExec')
//   hrbp        → Unit Health dashboard ('unit')
//   recruiter   → Recruiter dashboard ('recruiter')
//   leader      → Manager dashboard ('manager') — the retired 'leader' key is gone
//   committee   → Committee "My Tasks" participant landing ('committee')
//   employee    → Employee "My Home" landing ('employee')
//   no recognized staff role → access-pending landing ('unassigned')
//
// Precedence on multi-role collisions:
//   super_admin > hr_admin > hrbp > recruiter > leader > committee > employee.
//
// Pilot launch scope (NEXT_PUBLIC_LAUNCH_SCOPE=pilot): the Org Command Center and HR-Exec dashboard are
// HR-suite surfaces, so super_admin and hr_admin land on the Recruiter dashboard instead.
export function pickPrimaryDashboard(
  roleSlugs: readonly string[],
  scope: LaunchScope = readLaunchScope(),
): DashboardKey {
  const pilot = scope === 'pilot';
  if (roleSlugs.includes('super_admin')) return pilot ? 'recruiter' : 'org';
  if (roleSlugs.includes('hr_admin')) return pilot ? 'recruiter' : 'hrExec';
  if (roleSlugs.includes('hrbp')) return 'unit';
  if (roleSlugs.includes('recruiter')) return 'recruiter';
  if (roleSlugs.includes('leader')) return 'manager';
  if (roleSlugs.includes('committee')) return 'committee';
  if (roleSlugs.includes('employee')) return 'employee';
  return 'unassigned';
}

/** The setup checklist belongs to the org stewards (super_admin, hr_admin) whichever dashboard they land on. */
export function showsSetupChecklistFor(roleSlugs: readonly string[]): boolean {
  return roleSlugs.includes('super_admin') || roleSlugs.includes('hr_admin');
}
