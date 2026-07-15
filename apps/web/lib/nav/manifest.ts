import type { Module } from '@tims/shared';

export type NavSubItem = { readonly href: string; readonly labelKey: string; readonly icon: string };
// `sub` is infrastructure only as of this change — no entry in MANIFESTS below populates it yet, and
// sub-items inherit their parent's module-gate rather than being independently permission-checked
// (there is no real case requiring per-sub-item permissions today; add one only when a manifest
// actually needs it).
export type NavItem = { readonly href: string; readonly labelKey: string; readonly icon: string; readonly module: Module | null; readonly sub?: readonly NavSubItem[] };
export type NavSection = { readonly labelKey: string | null; readonly items: readonly NavItem[] };
export type Shell = 'admin' | 'participant' | 'platform';
export type RoleManifest = { readonly shell: Shell; readonly landing: string; readonly sections: readonly NavSection[] };

export const NAV_ROLES = [
  'super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader', 'committee', 'employee',
] as const;
export type NavRole = (typeof NAV_ROLES)[number];

// Highest-precedence first (mirrors ROLE_PRECEDENCE in permissions.tsx, minus platform_owner
// which renders the separate PlatformSidebar). The primary role wins for nav.
const PRECEDENCE: NavRole[] = ['super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader', 'committee', 'employee'];

// Fix wave (FIX C): /my-360 is always-allowed (module: null) — self-service
// (myRaterTasks/submitRatings/myReport/myReportCycles) is identity-authorized
// via protectedProcedure, not RBAC-gated, so every staff role must be able to
// reach their own 360 tasks/reports. COMMAND_CENTER is shared by every
// admin-shell manifest (BASE_ADMIN, HR_ADMIN_PEOPLE_FIRST, HRBP_UNITS,
// RECRUITER_ATS, LEADER_COCKPIT), so adding it here covers super_admin,
// hr_admin, hrbp, recruiter, and leader in one place. Committee (participant
// shell, no COMMAND_CENTER) gets its own entry in COMMITTEE_TASKS below.
// Employee already has it in EMPLOYEE_HOME.
const COMMAND_CENTER: NavSection = {
  labelKey: null,
  items: [
    { href: '/dashboard', labelKey: 'sidebar.commandCenter', icon: 'grid', module: null },
    { href: '/my-360', labelKey: 'sidebar.my360', icon: 'target', module: null },
  ],
};
const RECRUITMENT: NavSection = {
  labelKey: 'sidebar.recruitment',
  items: [
    { href: '/recruitment/vacancies', labelKey: 'sidebar.vacancies', icon: 'briefcase', module: 'vacancy' },
    { href: '/recruitment/pipeline', labelKey: 'sidebar.pipeline', icon: 'kanban', module: 'pipeline' },
    { href: '/recruitment/candidates', labelKey: 'sidebar.candidates', icon: 'user', module: 'candidate' },
    { href: '/recruitment/interviews', labelKey: 'sidebar.interviews', icon: 'video', module: 'interview' },
    { href: '/recruitment/assessments', labelKey: 'sidebar.assessments', icon: 'clipboard', module: 'assessment' },
    { href: '/recruitment/offers', labelKey: 'sidebar.offers', icon: 'clipboard', module: 'offer' },
    { href: '/recruitment/talent-pools', labelKey: 'sidebar.talentPool', icon: 'users', module: 'candidate' },
    { href: '/recruitment/analytics', labelKey: 'sidebar.analytics', icon: 'chart', module: 'vacancy' },
  ],
};
const PEOPLE: NavSection = {
  labelKey: 'sidebar.people',
  items: [
    { href: '/people/onboarding', labelKey: 'sidebar.onboarding', icon: 'rocket', module: 'onboarding' },
    { href: '/people/performance', labelKey: 'sidebar.performance', icon: 'target', module: 'performance' },
    { href: '/learning', labelKey: 'sidebar.training', icon: 'book', module: 'learning' },
  ],
};
const TALENT: NavSection = {
  labelKey: 'sidebar.talent',
  items: [
    { href: '/talent/nine-box', labelKey: 'sidebar.nineBox', icon: 'ninebox', module: 'ninebox' },
    { href: '/talent/succession', labelKey: 'sidebar.succession', icon: 'succession', module: 'succession' },
    { href: '/talent/team-intelligence', labelKey: 'sidebar.teamIntel', icon: 'team', module: 'team_intel' },
    { href: '/talent/360', labelKey: 'sidebar.evaluations360', icon: 'clipboard', module: 'evaluation360' },
  ],
};
const CULTURE: NavSection = {
  labelKey: 'sidebar.organization',
  items: [
    { href: '/engagement/climate', labelKey: 'sidebar.climate', icon: 'heart', module: 'engagement' },
    { href: '/engagement/dei', labelKey: 'sidebar.dei', icon: 'dei', module: 'dei' },
    { href: '/compensation', labelKey: 'sidebar.compensation', icon: 'dollar', module: 'compensation' },
    { href: '/monitoring', labelKey: 'sidebar.monitoring', icon: 'monitor', module: 'monitoring' },
  ],
};
const SETTINGS: NavSection = {
  labelKey: null,
  items: [
    { href: '/settings/business-units', labelKey: 'sidebar.businessUnits', icon: 'team', module: 'user' },
    { href: '/settings/branding', labelKey: 'sidebar.branding', icon: 'image', module: 'organization' },
    { href: '/settings/fit-weights', labelKey: 'sidebar.fitWeights', icon: 'settings', module: 'fit_engine' },
    { href: '/settings/billing', labelKey: 'sidebar.billing', icon: 'dollar', module: 'billing' },
    { href: '/settings/integrations', labelKey: 'sidebar.integrations', icon: 'settings', module: 'integration' },
  ],
};

// Leader = a two-world cockpit: hiring objects + team people. All @team via can()/API scope.
const LEADER_MY_HIRING: NavSection = {
  labelKey: 'sidebar.myHiring',
  items: [
    { href: '/recruitment/vacancies', labelKey: 'sidebar.vacancies', icon: 'briefcase', module: 'vacancy' },
    { href: '/recruitment/pipeline', labelKey: 'sidebar.pipeline', icon: 'kanban', module: 'pipeline' },
    { href: '/recruitment/candidates', labelKey: 'sidebar.finalistCandidates', icon: 'user', module: 'candidate' },
    { href: '/recruitment/interviews', labelKey: 'sidebar.interviews', icon: 'video', module: 'interview' },
    { href: '/recruitment/offers', labelKey: 'sidebar.offersToApprove', icon: 'clipboard', module: 'offer' },
  ],
};
const LEADER_MY_TEAM: NavSection = {
  labelKey: 'sidebar.myTeam',
  items: [
    { href: '/people/onboarding', labelKey: 'sidebar.onboarding', icon: 'rocket', module: 'onboarding' },
    { href: '/people/performance', labelKey: 'sidebar.performance', icon: 'target', module: 'performance' },
    { href: '/learning', labelKey: 'sidebar.training', icon: 'book', module: 'learning' },
    { href: '/talent/nine-box', labelKey: 'sidebar.nineBox', icon: 'ninebox', module: 'ninebox' },
    { href: '/engagement/climate', labelKey: 'sidebar.climate', icon: 'heart', module: 'engagement' },
    { href: '/compensation', labelKey: 'sidebar.compensation', icon: 'dollar', module: 'compensation' },
  ],
};
const LEADER_COCKPIT: NavSection[] = [COMMAND_CENTER, LEADER_MY_HIRING, LEADER_MY_TEAM];

// hr_admin = org-wide HR steward, people-first IA + a reduced admin section (business units only;
// no billing/integrations — org-config is read-only per the access spec). can() still prunes.
const HR_ADMIN_SETTINGS: NavSection = {
  labelKey: null,
  items: [
    { href: '/settings/business-units', labelKey: 'sidebar.businessUnits', icon: 'team', module: 'user' },
  ],
};
const HR_ADMIN_PEOPLE_FIRST: NavSection[] = [
  COMMAND_CENTER, PEOPLE, TALENT, CULTURE, RECRUITMENT, HR_ADMIN_SETTINGS,
];

// hrbp = HR business partner scoped to assigned units ("Mis Unidades"). Unit-native IA, no org-admin
// chrome. CULTURE keeps monitoring (hrbp has monitoring:read@unit); can() prunes DEI (no dei grant).
// TALENT shows Nine-Box + Succession (hrbp has both @unit); can() prunes Team Intelligence (no
// team_intel grant — hrbp's grant set omits it, same mechanism as the DEI prune above).
const HRBP_UNITS: NavSection[] = [COMMAND_CENTER, RECRUITMENT, PEOPLE, TALENT, CULTURE];

// Base admin IA = today's full sidebar. can() prunes per role → no regression.
const BASE_ADMIN: NavSection[] = [COMMAND_CENTER, RECRUITMENT, PEOPLE, TALENT, CULTURE, SETTINGS];
// Recruiter = purpose-built ATS shell (declared, not subtracted).
const RECRUITER_ATS: NavSection[] = [COMMAND_CENTER, RECRUITMENT];

const adminManifest = (sections: NavSection[]): RoleManifest => ({ shell: 'admin', landing: '/dashboard', sections });

const participantManifest = (sections: NavSection[]): RoleManifest => ({ shell: 'participant', landing: '/dashboard', sections });

// committee = interview panels they're assigned to (their real task). "Mis Calibraciones" is now
// surfaced as a panel ON the committee landing (ninebox.myCalibrations, member-scoped) rather than a
// nav route — there is no committee-reachable /talent/calibrations page, so no nav item is added here.
const COMMITTEE_TASKS: NavSection[] = [
  {
    labelKey: 'sidebar.myTasks',
    items: [
      { href: '/recruitment/interviews', labelKey: 'sidebar.myPanels', icon: 'video', module: 'interview' },
      // Fix wave (FIX C): always-allowed self-service, see COMMAND_CENTER docstring.
      { href: '/my-360', labelKey: 'sidebar.my360', icon: 'target', module: null },
    ],
  },
];

// employee = self-service "My Home". Only sections with a real own-scoped endpoint (D5):
// performance, learning, onboarding, 360 (Sprint 1.7 Slice 5 — myRaterTasks/submitRatings/
// myReport are identity-anchored own-scope endpoints). Surveys/comp/privacy omitted until
// their backend ships.
// Fix wave (FIX C): /my-360's module is null (always-allowed) — self-service is
// identity-authorized via protectedProcedure, not RBAC-gated, so it needs no grant.
const EMPLOYEE_HOME: NavSection[] = [
  {
    labelKey: 'sidebar.myHome',
    items: [
      { href: '/people/performance', labelKey: 'sidebar.myPerformance', icon: 'target', module: 'performance' },
      { href: '/learning', labelKey: 'sidebar.myLearning', icon: 'book', module: 'learning' },
      { href: '/people/onboarding', labelKey: 'sidebar.myOnboarding', icon: 'rocket', module: 'onboarding' },
      { href: '/my-360', labelKey: 'sidebar.my360', icon: 'target', module: null },
    ],
  },
];

export const MANIFESTS: Record<NavRole, RoleManifest> = {
  super_admin: adminManifest(BASE_ADMIN),
  hr_admin: adminManifest(HR_ADMIN_PEOPLE_FIRST),
  hrbp: adminManifest(HRBP_UNITS),
  recruiter: adminManifest(RECRUITER_ATS),
  leader: adminManifest(LEADER_COCKPIT),
  committee: participantManifest(COMMITTEE_TASKS),
  employee: participantManifest(EMPLOYEE_HOME),
};

const FALLBACK_MANIFEST: RoleManifest = adminManifest(BASE_ADMIN);

/** The manifest for the user's primary (highest-precedence) role. */
export function manifestFor(roles: readonly string[]): RoleManifest {
  const primary = PRECEDENCE.find((r) => roles.includes(r));
  return primary ? MANIFESTS[primary] : FALLBACK_MANIFEST;
}

/** Which sidebar chrome to render. Platform owner always wins; participant manifests get the
 *  lighter ParticipantSidebar; everything else gets the admin Sidebar. */
export function pickSidebarVariant(isPlatformOwner: boolean, shell: Shell): 'platform' | 'participant' | 'admin' {
  if (isPlatformOwner) return 'platform';
  if (shell === 'participant') return 'participant';
  return 'admin';
}

/** Whether a nav item is the active route: exact match or a parent of the current path. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

/** Resolve a dot-path label key against an i18n message object. Falls back to the key. */
export function resolveLabel(messages: Record<string, unknown>, key: string): string {
  const v = key.split('.').reduce<unknown>(
    (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    messages,
  );
  return typeof v === 'string' ? v : key;
}

/** Prune sections to what the user may see. UX only — the API is the real gate.
 *  While loading, show only null-module items (no flash-then-vanish). */
export function computeVisibleSections(
  sections: readonly NavSection[],
  can: (module: string, action?: string) => boolean,
  isLoading: boolean,
): NavSection[] {
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => {
        if (it.module === null) return true;
        if (isLoading) return false;
        return can(it.module, 'read');
      }),
    }))
    .filter((s) => s.items.length > 0);
}
