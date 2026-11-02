import { describe, expect, it } from 'vitest';
import {
  LAUNCH_HIDDEN_HREFS,
  filterSectionsForScope,
  isHrefHiddenInScope,
  readLaunchScope,
} from '../../apps/web/lib/launch-scope';
import { MANIFESTS, NAV_ROLES, computeVisibleSections, type NavSection } from '../../apps/web/lib/nav/manifest';
import { pickPrimaryDashboard, showsSetupChecklistFor } from '../../apps/web/app/(admin)/dashboard/pick-dashboard';

// Pilot launch scope (NEXT_PUBLIC_LAUNCH_SCOPE=pilot): out-of-scope modules disappear for EVERY role,
// privileged included, and the in-scope recruitment spine stays.

const allow = () => true; // privileged can(): grants everything
const allFlagsOn = () => true;

function visibleHrefs(sections: readonly NavSection[], scope: 'pilot' | 'full'): string[] {
  return computeVisibleSections(filterSectionsForScope(sections, scope), allow, false, allFlagsOn).flatMap((s) =>
    s.items.map((i) => i.href),
  );
}

const MUST_HIDE = [
  '/recruitment/assessments',
  '/my-360',
  '/talent/360',
  '/engagement/dei',
  '/learning',
  '/people/performance',
  '/compensation',
  '/settings/billing',
  '/settings/integrations',
];
const MUST_KEEP_SUPER_ADMIN = [
  '/dashboard',
  '/recruitment/vacancies',
  '/recruitment/pipeline',
  '/recruitment/candidates',
  '/recruitment/interviews',
  '/recruitment/offers',
  '/recruitment/talent-pools',
  '/people/onboarding',
  '/settings/users',
  '/settings/branding',
];

describe('readLaunchScope', () => {
  it('only the exact value pilot narrows the scope', () => {
    expect(readLaunchScope('pilot')).toBe('pilot');
    expect(readLaunchScope(' pilot ')).toBe('pilot');
    expect(readLaunchScope(undefined)).toBe('full');
    expect(readLaunchScope('')).toBe('full');
    expect(readLaunchScope('PILOT-ish')).toBe('full');
  });
});

describe('nav filtering under the pilot scope', () => {
  it.each(NAV_ROLES)('%s (with a grant-everything can()) sees no hidden href', (role) => {
    const hrefs = visibleHrefs(MANIFESTS[role].sections, 'pilot');
    for (const h of hrefs) expect(isHrefHiddenInScope(h, 'pilot')).toBe(false);
    for (const h of MUST_HIDE) expect(hrefs).not.toContain(h);
  });

  it('super_admin keeps the recruitment spine, onboarding, team and settings', () => {
    const hrefs = visibleHrefs(MANIFESTS.super_admin.sections, 'pilot');
    for (const h of MUST_KEEP_SUPER_ADMIN) expect(hrefs).toContain(h);
  });

  it('employee keeps a non-empty home (own onboarding) and committee keeps its panels', () => {
    expect(visibleHrefs(MANIFESTS.employee.sections, 'pilot')).toEqual(['/my-onboarding']);
    expect(visibleHrefs(MANIFESTS.committee.sections, 'pilot')).toEqual(['/recruitment/interviews']);
  });

  it('is a no-op when the scope is full (behaviour unchanged)', () => {
    for (const role of NAV_ROLES) {
      const sections = MANIFESTS[role].sections;
      expect(filterSectionsForScope(sections, 'full')).toEqual([...sections]);
    }
    expect(visibleHrefs(MANIFESTS.super_admin.sections, 'full')).toContain('/my-360');
  });

  it('filters the platform sidebar shape too (feature flags hidden, orgs/users/invitations/health/billing kept)', () => {
    const platform = [
      { label: null, items: [{ href: '/dashboard' }] },
      { label: 'p', items: [{ href: '/platform/organizations' }, { href: '/platform/invoices' }, { href: '/platform/users' }, { href: '/platform/invitations' }] },
      { label: 's', items: [{ href: '/platform/health' }, { href: '/platform/feature-flags' }] },
    ];
    const hrefs = filterSectionsForScope(platform, 'pilot').flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain('/platform/feature-flags');
    expect(hrefs).toEqual([
      '/dashboard',
      '/platform/organizations',
      '/platform/invoices',
      '/platform/users',
      '/platform/invitations',
      '/platform/health',
    ]);
  });
});

describe('route guard decision (isHrefHiddenInScope)', () => {
  it('blocks every hidden href and its sub-routes under pilot', () => {
    for (const h of LAUNCH_HIDDEN_HREFS) {
      expect(isHrefHiddenInScope(h, 'pilot')).toBe(true);
      expect(isHrefHiddenInScope(`${h}/abc`, 'pilot')).toBe(true);
    }
  });

  it('is segment-aware and leaves in-scope routes open', () => {
    expect(isHrefHiddenInScope('/talentos', 'pilot')).toBe(false);
    expect(isHrefHiddenInScope('/recruitment/offers/123', 'pilot')).toBe(false);
    expect(isHrefHiddenInScope('/settings', 'pilot')).toBe(false);
    expect(isHrefHiddenInScope('/platform/organizations', 'pilot')).toBe(false);
  });

  it('blocks nothing when the scope is full', () => {
    for (const h of LAUNCH_HIDDEN_HREFS) expect(isHrefHiddenInScope(h, 'full')).toBe(false);
  });
});

describe('pilot landing', () => {
  it('super_admin, hr_admin and hrbp land on the recruiter dashboard; super_admin/hr_admin keep the setup checklist', () => {
    expect(pickPrimaryDashboard(['super_admin'], 'pilot')).toBe('recruiter');
    expect(pickPrimaryDashboard(['hr_admin'], 'pilot')).toBe('recruiter');
    expect(pickPrimaryDashboard(['super_admin'], 'full')).toBe('org');
    expect(pickPrimaryDashboard(['hr_admin'], 'full')).toBe('hrExec');
    expect(pickPrimaryDashboard(['committee'], 'pilot')).toBe('committee');
    expect(pickPrimaryDashboard(['hrbp'], 'pilot')).toBe('recruiter');
    expect(pickPrimaryDashboard(['hrbp'], 'full')).toBe('unit');
    expect(pickPrimaryDashboard(['leader'], 'pilot')).toBe('manager');
    expect(pickPrimaryDashboard(['employee'], 'pilot')).toBe('employee');
    expect(showsSetupChecklistFor(['super_admin'])).toBe(true);
    expect(showsSetupChecklistFor(['hr_admin', 'recruiter'])).toBe(true);
    expect(showsSetupChecklistFor(['recruiter'])).toBe(false);
  });
});
