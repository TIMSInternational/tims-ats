import { describe, expect, it } from 'vitest';
import {
  MANIFESTS,
  NAV_ROLES,
  computeVisibleSections,
  manifestFor,
  resolveLabel,
} from '../../apps/web/lib/nav/manifest';
import { filterSectionsForScope } from '../../apps/web/lib/launch-scope';
import { notificationModuleLabel, notificationTypeLabel } from '../../apps/web/lib/notification-labels';
import { grantsFor } from '../../packages/db/prisma/seed-access-matrix';
import { resolveAccess } from '../../packages/api/src/access/resolve';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

const hrefs = (roles: string[]) => manifestFor(roles).sections.flatMap((s) => s.items.map((i) => i.href));

describe('home item ("Inicio") in every nav', () => {
  it.each(NAV_ROLES)('%s has /dashboard as its first item', (role) => {
    expect(MANIFESTS[role].sections[0]?.items[0]?.href).toBe('/dashboard');
  });

  it('is labelled "Inicio" / "Home", not "Command Center"', () => {
    expect(resolveLabel(es, 'sidebar.commandCenter')).toBe('Inicio');
    expect(resolveLabel(en, 'sidebar.commandCenter')).toBe('Home');
    expect(es.recruitingDashboard.overviewMetrics).toBe('Resumen de reclutamiento');
  });
});

describe('a staff user who is also a new hire keeps "Mi Onboarding"', () => {
  it.each(['super_admin', 'hr_admin', 'recruiter', 'leader', 'committee'])('%s + employee', (role) => {
    expect(hrefs([role, 'employee'])).toContain('/my-onboarding');
    // The primary role still drives the rest of the nav.
    expect(hrefs([role, 'employee'])).toEqual([...hrefs([role]), '/my-onboarding']);
  });

  it('is not added for hrbp + employee: unit scope (unitMemberIds) can exclude the caller, so the page would say "no plan"', () => {
    expect(hrefs(['hrbp', 'employee'])).toEqual(hrefs(['hrbp']));
  });

  it('is not added for a role set without employee, nor duplicated for employee alone', () => {
    for (const role of NAV_ROLES.filter((r) => r !== 'employee')) expect(hrefs([role])).not.toContain('/my-onboarding');
    expect(hrefs(['employee']).filter((h) => h === '/my-onboarding')).toHaveLength(1);
  });

  it('is only offered where the resolved onboarding:read scope still contains the caller (seed matrix)', () => {
    // Access resolution takes the WIDEST scope across the roles held. The own plan stays visible at
    // organization, at team (teamMemberIds always includes self) and at own; unit (unitMemberIds) does not
    // include the caller. If a grant change makes a merged role resolve to unit, this fails.
    const grants = (roles: string[]) => roles.flatMap((role) => grantsFor(role).map((g) => ({ ...g, role })));
    for (const role of NAV_ROLES.filter((r) => r !== 'employee')) {
      const decision = resolveAccess(grants([role, 'employee']), 'onboarding', 'read');
      const scope = decision.allowed ? decision.scope : 'none';
      const offered = hrefs([role, 'employee']).includes('/my-onboarding');
      expect(offered, `${role} + employee resolves onboarding:read @${scope}`).toBe(scope !== 'unit');
    }
  });

  it('is stable per role set (same object on repeated calls)', () => {
    expect(manifestFor(['recruiter', 'employee'])).toBe(manifestFor(['employee', 'recruiter']));
  });

  it('survives the pilot scope and the onboarding gate for a recruiter whose employee role grants onboarding read', () => {
    const can = (m: string, a?: string) => (m === 'onboarding' ? a === 'read' : true);
    const visible = computeVisibleSections(
      filterSectionsForScope(manifestFor(['recruiter', 'employee']).sections, 'pilot'),
      can,
      false,
      () => true,
    ).flatMap((s) => s.items.map((i) => i.href));
    expect(visible).toContain('/my-onboarding');
  });
});

describe('settings group has a heading', () => {
  it.each(['super_admin', 'hr_admin'] as const)('%s settings items sit under "Configuración"', (role) => {
    const section = MANIFESTS[role].sections.find((s) => s.items.some((i) => i.href === '/settings/business-units'));
    expect(section?.labelKey).toBe('sidebar.settings');
    expect(resolveLabel(es, 'sidebar.settings')).toBe('Configuración');
    expect(resolveLabel(en, 'sidebar.settings')).toBe('Settings');
  });
});

describe('notification labels', () => {
  it('maps known modules and hides unknown or prototype slugs', () => {
    expect(notificationModuleLabel(es.nav.notificationModules, 'candidate')).toBe('Candidatos');
    expect(notificationModuleLabel(es.nav.notificationModules, 'platform')).toBe('Plataforma');
    expect(notificationModuleLabel(es.nav.notificationModules, 'raw_slug')).toBeNull();
    expect(notificationModuleLabel(es.nav.notificationModules, 'toString')).toBeNull();
    expect(notificationModuleLabel(es.nav.notificationModules, null)).toBeNull();
    expect(notificationModuleLabel(es.nav.notificationModules, '')).toBeNull();
  });

  it('names every severity, unknown types read as info', () => {
    expect(notificationTypeLabel(es.nav.notificationTypes, 'critical')).toBe('Crítica');
    expect(notificationTypeLabel(es.nav.notificationTypes, 'warning')).toBe('Advertencia');
    expect(notificationTypeLabel(es.nav.notificationTypes, 'mystery')).toBe(es.nav.notificationTypes.info);
  });

  it('both locales label the same modules and types', () => {
    expect(Object.keys(en.nav.notificationModules).sort()).toEqual(Object.keys(es.nav.notificationModules).sort());
    expect(Object.keys(en.nav.notificationTypes).sort()).toEqual(Object.keys(es.nav.notificationTypes).sort());
  });
});
