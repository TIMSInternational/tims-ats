import type { Module } from '@tims/shared';

export type NavItem = { readonly href: string; readonly labelKey: string; readonly icon: string; readonly module: Module | null };
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

const COMMAND_CENTER: NavSection = {
  labelKey: null,
  items: [{ href: '/dashboard', labelKey: 'sidebar.commandCenter', icon: 'grid', module: null }],
};
const RECRUITMENT: NavSection = {
  labelKey: 'sidebar.recruitment',
  items: [
    { href: '/recruitment/pipeline', labelKey: 'sidebar.pipeline', icon: 'kanban', module: 'pipeline' },
    { href: '/recruitment/vacancies', labelKey: 'sidebar.vacancies', icon: 'briefcase', module: 'vacancy' },
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
    { href: '/settings/billing', labelKey: 'sidebar.billing', icon: 'dollar', module: 'billing' },
    { href: '/settings/integrations', labelKey: 'sidebar.integrations', icon: 'settings', module: 'integration' },
  ],
};

// Leader = a two-world cockpit: hiring objects + team people. All @team via can()/API scope.
const LEADER_MY_HIRING: NavSection = {
  labelKey: 'sidebar.myHiring',
  items: [
    { href: '/recruitment/vacancies', labelKey: 'sidebar.vacancies', icon: 'briefcase', module: 'vacancy' },
    { href: '/recruitment/candidates', labelKey: 'sidebar.finalistCandidates', icon: 'user', module: 'candidate' },
    { href: '/recruitment/interviews', labelKey: 'sidebar.interviews', icon: 'video', module: 'interview' },
    { href: '/recruitment/offers', labelKey: 'sidebar.offersToApprove', icon: 'clipboard', module: 'offer' },
  ],
};
const LEADER_MY_TEAM: NavSection = {
  labelKey: 'sidebar.myTeam',
  items: [
    { href: '/people/performance', labelKey: 'sidebar.performance', icon: 'target', module: 'performance' },
    { href: '/learning', labelKey: 'sidebar.training', icon: 'book', module: 'learning' },
    { href: '/talent/nine-box', labelKey: 'sidebar.nineBox', icon: 'ninebox', module: 'ninebox' },
    { href: '/engagement/climate', labelKey: 'sidebar.climate', icon: 'heart', module: 'engagement' },
    { href: '/compensation', labelKey: 'sidebar.compensation', icon: 'dollar', module: 'compensation' },
  ],
};
const LEADER_COCKPIT: NavSection[] = [COMMAND_CENTER, LEADER_MY_HIRING, LEADER_MY_TEAM];

// Base admin IA = today's full sidebar. can() prunes per role → no regression.
const BASE_ADMIN: NavSection[] = [COMMAND_CENTER, RECRUITMENT, PEOPLE, TALENT, CULTURE, SETTINGS];
// Recruiter = purpose-built ATS shell (declared, not subtracted).
const RECRUITER_ATS: NavSection[] = [COMMAND_CENTER, RECRUITMENT];

const adminManifest = (sections: NavSection[]): RoleManifest => ({ shell: 'admin', landing: '/dashboard', sections });

export const MANIFESTS: Record<NavRole, RoleManifest> = {
  super_admin: adminManifest(BASE_ADMIN),
  hr_admin: adminManifest(BASE_ADMIN),
  hrbp: adminManifest(BASE_ADMIN),
  recruiter: adminManifest(RECRUITER_ATS),
  leader: adminManifest(LEADER_COCKPIT),
  committee: adminManifest(BASE_ADMIN), // participant shell arrives in Slice 4
  employee: adminManifest(BASE_ADMIN),  // participant shell arrives in Slice 4
};

const FALLBACK_MANIFEST: RoleManifest = adminManifest(BASE_ADMIN);

/** The manifest for the user's primary (highest-precedence) role. */
export function manifestFor(roles: readonly string[]): RoleManifest {
  const primary = PRECEDENCE.find((r) => roles.includes(r));
  return primary ? MANIFESTS[primary] : FALLBACK_MANIFEST;
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
