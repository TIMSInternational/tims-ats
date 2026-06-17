export type DashboardKey =
  | 'org'
  | 'hrExec'
  | 'unit'
  | 'recruiter'
  | 'manager'
  | 'leader'
  | 'employee';

// Each admin-tier role gets its own purpose-built landing:
//   super_admin → Org Command Center ('org')
//   hr_admin    → HR-Exec dashboard ('hrExec')
//   hrbp        → Unit Health dashboard ('unit')
//   recruiter   → Recruiter dashboard ('recruiter')
//   leader      → Manager dashboard ('manager')
//   committee   → thin Leader dashboard ('leader') until Slice 4 gives it "My Tasks"
//   everyone else → Employee dashboard ('employee')
//
// Precedence on multi-role collisions:
//   super_admin > hr_admin > hrbp > recruiter > leader > committee > employee.
export function pickPrimaryDashboard(roleSlugs: readonly string[]): DashboardKey {
  if (roleSlugs.includes('super_admin')) return 'org';
  if (roleSlugs.includes('hr_admin')) return 'hrExec';
  if (roleSlugs.includes('hrbp')) return 'unit';
  if (roleSlugs.includes('recruiter')) return 'recruiter';
  if (roleSlugs.includes('leader')) return 'manager';
  if (roleSlugs.includes('committee')) return 'leader';
  return 'employee';
}
