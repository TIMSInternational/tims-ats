import { describe, it, expect } from 'vitest';
import {
  MANIFESTS, manifestFor, resolveLabel, computeVisibleSections, NAV_ROLES, pickSidebarVariant, isNavItemActive,
  type NavSection,
} from '../../apps/web/lib/nav/manifest';
import { moduleForPath } from '../../apps/web/lib/nav/routes';
import es from '../../apps/web/lib/i18n/es.json';

describe('nav manifest', () => {
  it('manifestFor picks the highest-precedence role', () => {
    expect(manifestFor(['recruiter'])).toBe(MANIFESTS.recruiter);
    expect(manifestFor(['recruiter', 'hr_admin'])).toBe(MANIFESTS.hr_admin); // hr_admin outranks recruiter
    expect(manifestFor(['employee'])).toBe(MANIFESTS.employee);
  });
  it('falls back to a base manifest for unknown/empty roles', () => {
    expect(manifestFor([]).sections.length).toBeGreaterThan(0);
  });
  it('recruiter manifest is purpose-built ATS — no people/talent/culture modules', () => {
    const forbidden = new Set(['performance', 'onboarding', 'learning', 'ninebox', 'succession', 'team_intel', 'engagement', 'dei', 'compensation', 'monitoring', 'billing', 'integration', 'user']);
    for (const s of MANIFESTS.recruiter.sections)
      for (const it of s.items)
        expect(forbidden.has(it.module ?? ''), `recruiter should not nav to ${it.module}`).toBe(false);
  });
  it('super_admin manifest is the full base (has people + talent + culture)', () => {
    const modules = MANIFESTS.super_admin.sections.flatMap((s) => s.items.map((i) => i.module));
    expect(modules).toContain('performance');
    expect(modules).toContain('ninebox');
    expect(modules).toContain('engagement');
    expect(modules).toContain('fit_engine');
  });
  it('NO-DRIFT: every manifest item.module matches the route map for its href', () => {
    for (const role of NAV_ROLES)
      for (const s of MANIFESTS[role].sections)
        for (const it of s.items)
          expect(moduleForPath(it.href) ?? null, `${role} ${it.href}`).toBe(it.module ?? null);
  });
  it('every label key resolves to a non-empty Spanish string', () => {
    for (const role of NAV_ROLES)
      for (const s of MANIFESTS[role].sections) {
        if (s.labelKey) expect(resolveLabel(es, s.labelKey)).toBeTruthy();
        for (const it of s.items) {
          const label = resolveLabel(es, it.labelKey);
          expect(label, `${it.labelKey}`).toBeTruthy();
          expect(label).not.toBe(it.labelKey);
        }
      }
  });
  it('leader gets a bespoke two-world manifest (My Hiring + My Team), not BASE_ADMIN', () => {
    const labels = MANIFESTS.leader.sections.map((s) => s.labelKey);
    expect(labels).toContain('sidebar.myHiring');
    expect(labels).toContain('sidebar.myTeam');
    // My Hiring = the leader's hiring objects
    const hiring = MANIFESTS.leader.sections.find((s) => s.labelKey === 'sidebar.myHiring');
    const hiringModules = hiring?.items.map((i) => i.module) ?? [];
    expect(hiringModules).toEqual(expect.arrayContaining(['pipeline', 'vacancy', 'candidate', 'interview', 'offer']));
    // My Team = team people modules
    const team = MANIFESTS.leader.sections.find((s) => s.labelKey === 'sidebar.myTeam');
    const teamModules = team?.items.map((i) => i.module) ?? [];
    expect(teamModules).toEqual(expect.arrayContaining(['onboarding', 'performance', 'learning', 'ninebox', 'engagement', 'compensation']));
    // Curated: leader should NOT see admin/settings or org-only modules in nav
    const all = MANIFESTS.leader.sections.flatMap((s) => s.items.map((i) => i.module));
    for (const m of ['user', 'billing', 'integration', 'monitoring', 'dei', 'succession', 'team_intel'])
      expect(all, `leader nav should not include ${m}`).not.toContain(m);
  });
  it('hr_admin gets a people-first IA (People/Talent/Culture before Recruitment) with a reduced admin section', () => {
    const labels = MANIFESTS.hr_admin.sections.map((s) => s.labelKey);
    const peopleIdx = labels.indexOf('sidebar.people');
    const recruitmentIdx = labels.indexOf('sidebar.recruitment');
    expect(peopleIdx).toBeGreaterThanOrEqual(0);
    expect(recruitmentIdx).toBeGreaterThan(peopleIdx);
    const allModules = MANIFESTS.hr_admin.sections.flatMap((s) => s.items.map((i) => i.module));
    expect(allModules).toContain('user');        // business units
    expect(allModules).not.toContain('billing');
    expect(allModules).not.toContain('integration');
  });

  it('hrbp gets a unit-scoped IA (recruitment + people + talent + culture, NO org-admin settings)', () => {
    const sections = MANIFESTS.hrbp.sections;
    const labels = sections.map((s) => s.labelKey);
    expect(labels).toContain('sidebar.recruitment');
    expect(labels).toContain('sidebar.people');
    expect(labels).toContain('sidebar.organization'); // = the CULTURE section (climate/dei/comp/monitoring)
    // Unit-native ordering: recruitment leads (distinguishes HRBP_UNITS from BASE_ADMIN/people-first).
    expect(labels.indexOf('sidebar.recruitment')).toBeLessThan(labels.indexOf('sidebar.people'));
    const allModules = sections.flatMap((s) => s.items.map((i) => i.module));
    for (const m of ['user', 'billing', 'integration'])
      expect(allModules, `hrbp nav should not include ${m}`).not.toContain(m);
    // No org-admin settings section at all (the only null-label section is the command center).
    const nullLabelSections = sections.filter((s) => s.labelKey === null);
    expect(nullLabelSections).toHaveLength(1);
    expect(nullLabelSections[0]?.items.every((i) => i.module === null)).toBe(true);
  });

  it('committee + employee use the participant shell (not admin)', () => {
    expect(MANIFESTS.committee.shell).toBe('participant');
    expect(MANIFESTS.employee.shell).toBe('participant');
    for (const r of ['super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader'] as const)
      expect(MANIFESTS[r].shell).toBe('admin');
  });

  it('committee = My Tasks (panels); employee = My Home (performance/learning/onboarding); no admin/org modules', () => {
    const committeeMods = MANIFESTS.committee.sections.flatMap((s) => s.items.map((i) => i.module));
    expect(committeeMods).toEqual(expect.arrayContaining(['interview']));
    const employeeMods = MANIFESTS.employee.sections.flatMap((s) => s.items.map((i) => i.module));
    expect(employeeMods).toEqual(expect.arrayContaining(['performance', 'learning', 'onboarding']));
    const all = [...committeeMods, ...employeeMods];
    for (const m of ['user', 'billing', 'integration', 'monitoring', 'dei', 'vacancy', 'offer'])
      expect(all, `participant nav should not include ${m}`).not.toContain(m);
  });

  it('isNavItemActive: exact match or parent path, not sibling prefix', () => {
    expect(isNavItemActive('/people/performance', '/people/performance')).toBe(true);   // exact
    expect(isNavItemActive('/people/performance/123', '/people/performance')).toBe(true); // child
    expect(isNavItemActive('/people', '/people/performance')).toBe(false);              // parent ≠ active
    expect(isNavItemActive('/people/performance-review', '/people/performance')).toBe(false); // sibling prefix, NOT active
  });

  it('pickSidebarVariant: platform > participant > admin', () => {
    expect(pickSidebarVariant(true, 'participant')).toBe('platform');
    expect(pickSidebarVariant(false, 'participant')).toBe('participant');
    expect(pickSidebarVariant(false, 'admin')).toBe('admin');
    expect(pickSidebarVariant(false, 'platform')).toBe('admin');
  });
});

describe('computeVisibleSections', () => {
  const base = MANIFESTS.super_admin.sections;
  it('hides gated items while loading (only null-module items show)', () => {
    const out = computeVisibleSections(base, () => true, true);
    const items = out.flatMap((s) => s.items);
    expect(items.some((it) => it.module === null)).toBe(true);  // command center still shows
    expect(items.every((it) => it.module === null)).toBe(true); // nothing gated leaks during load
  });
  it('after load, keeps items where module===null OR can(module) is true', () => {
    const canOnlyPipeline = (m: string) => m === 'pipeline';
    const out = computeVisibleSections(base, canOnlyPipeline, false);
    const modules = out.flatMap((s) => s.items.map((i) => i.module));
    expect(modules).toContain(null);
    expect(modules).toContain('pipeline');
    expect(modules).not.toContain('dei');
  });
  it('drops sections that end up empty', () => {
    const out = computeVisibleSections(base, () => false, false);
    for (const s of out) expect(s.items.length).toBeGreaterThan(0);
  });
});

describe('manifest sub-item type support (non-regression)', () => {
  const sectionWithSub: NavSection = {
    labelKey: 'sidebar.recruitment',
    items: [
      {
        href: '/recruitment/pipeline',
        labelKey: 'sidebar.pipeline',
        icon: 'kanban',
        module: 'pipeline',
        sub: [
          { href: '/recruitment/pipeline/kanban', labelKey: 'sidebar.pipelineKanban', icon: 'kanban' },
          { href: '/recruitment/pipeline/list', labelKey: 'sidebar.pipelineList', icon: 'clipboard' },
        ],
      },
    ],
  };

  it('keeps an item with sub-items when the user can read its module', () => {
    const visible = computeVisibleSections([sectionWithSub], () => true, false);
    expect(visible).toHaveLength(1);
    expect(visible[0].items[0].sub).toHaveLength(2);
  });

  it('prunes an item with sub-items when the user cannot read its module (same as a sub-less item)', () => {
    const visible = computeVisibleSections([sectionWithSub], () => false, false);
    expect(visible).toHaveLength(0);
  });

  it('isNavItemActive matches a sub-item href the same way it matches a top-level href', () => {
    expect(isNavItemActive('/recruitment/pipeline/kanban', '/recruitment/pipeline/kanban')).toBe(true);
    expect(isNavItemActive('/recruitment/pipeline/kanban/123', '/recruitment/pipeline/kanban')).toBe(true);
    expect(isNavItemActive('/recruitment/vacancies', '/recruitment/pipeline/kanban')).toBe(false);
  });
});
