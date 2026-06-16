import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const PERMISSIONS = 'apps/web/lib/permissions.tsx';
// PATH_MODULE / moduleForPath were extracted into a pure, React-free module
// (re-exported from permissions.tsx). The route-map tripwire reads from here.
const NAV_ROUTES = 'apps/web/lib/nav/routes.ts';
const ADMIN_SHELL = 'apps/web/app/(admin)/admin-shell.tsx';
const ES = 'apps/web/lib/i18n/es.json';
const EN = 'apps/web/lib/i18n/en.json';

describe('slice 5 — permissions provider (static tripwires)', () => {
  it('permissions.tsx exists and wires getSessionInfo.useQuery', () => {
    const src = read(PERMISSIONS);
    expect(src).toContain('getSessionInfo.useQuery');
  });

  it('permissions.tsx implements the privileged bypass (isPlatformOwner + super_admin)', () => {
    const src = read(PERMISSIONS);
    expect(src).toContain('isPlatformOwner');
    expect(src).toContain('super_admin');
    expect(src).toContain('platform_owner');
  });

  it('PATH_MODULE is defined (nav/routes) with >= 20 entries and re-exported from permissions.tsx', () => {
    const navSrc = read(NAV_ROUTES);
    expect(navSrc).toContain('PATH_MODULE');
    // count "'/...': " style map entries
    const entries = navSrc.match(/'\/[a-z-]/g) ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(20);
    // permissions.tsx still surfaces it for existing importers
    expect(read(PERMISSIONS)).toContain('PATH_MODULE');
  });

  it('permissions.tsx exposes RouteAccessGuard + AccessDenied + usePermissions/useCan', () => {
    const src = read(PERMISSIONS);
    expect(src).toContain('RouteAccessGuard');
    expect(src).toContain('AccessDenied');
    expect(src).toContain('usePermissions');
    expect(src).toContain('useCan');
  });

  it('AccessDenied uses i18n only (no hardcoded English/Spanish strings)', () => {
    const src = read(PERMISSIONS);
    expect(src).toMatch(/accessDenied\.title/);
    expect(src).toMatch(/accessDenied\.message/);
    expect(src).toMatch(/accessDenied\.back/);
    // no raw "Access denied" / "Acceso denegado" literals
    expect(src).not.toContain('Access denied');
    expect(src).not.toContain('Acceso denegado');
  });

  it('fail-open + load semantics are documented in a comment', () => {
    const src = read(PERMISSIONS);
    expect(src.toLowerCase()).toContain('console.warn');
    // the API stays the enforcement boundary sentence
    expect(src.toLowerCase()).toMatch(/boundary/);
  });
});

describe('slice 5 — admin-shell wiring', () => {
  it('mounts PermissionsProvider inside TRPCProvider and wraps children with RouteAccessGuard', () => {
    const src = read(ADMIN_SHELL);
    expect(src).toContain('PermissionsProvider');
    expect(src).toContain('RouteAccessGuard');
    const trpcIdx = src.indexOf('<TRPCProvider>');
    const provIdx = src.indexOf('<PermissionsProvider');
    expect(trpcIdx).toBeGreaterThanOrEqual(0);
    expect(provIdx).toBeGreaterThan(trpcIdx);
    // guard wraps children, not the sidebar
    expect(src).toMatch(/<RouteAccessGuard>[\s\S]*\{children\}[\s\S]*<\/RouteAccessGuard>/);
  });

  it('passes isPlatformOwner to the provider', () => {
    const src = read(ADMIN_SHELL);
    expect(src).toMatch(/<PermissionsProvider[\s\S]*isPlatformOwner/);
  });
});

describe('slice 5 — i18n keys (both locales)', () => {
  it('es.json has accessDenied.title and roles.employee', () => {
    const es = JSON.parse(read(ES));
    expect(es.accessDenied?.title).toBeTruthy();
    expect(es.accessDenied?.message).toBeTruthy();
    expect(es.accessDenied?.back).toBeTruthy();
    expect(es.roles?.employee).toBeTruthy();
    expect(es.roles?.platform_owner).toBeTruthy();
  });

  it('en.json has accessDenied.title and roles.employee', () => {
    const en = JSON.parse(read(EN));
    expect(en.accessDenied?.title).toBeTruthy();
    expect(en.accessDenied?.message).toBeTruthy();
    expect(en.accessDenied?.back).toBeTruthy();
    expect(en.roles?.employee).toBeTruthy();
    expect(en.roles?.platform_owner).toBeTruthy();
  });

  it('both locales cover the full role set', () => {
    const es = JSON.parse(read(ES));
    const en = JSON.parse(read(EN));
    const slugs = ['super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader', 'committee', 'employee', 'platform_owner'];
    for (const s of slugs) {
      expect(es.roles?.[s], `es roles.${s}`).toBeTruthy();
      expect(en.roles?.[s], `en roles.${s}`).toBeTruthy();
    }
  });
});

const SIDEBAR = 'apps/web/app/(admin)/sidebar.tsx';

describe('role-aware sidebar (task 3 — manifest-driven)', () => {
  const src = () => read(SIDEBAR);
  it('derives nav from the role manifest (no duplicated section/module mapping)', () => {
    // Task 3 deleted the inline useNavSections()/moduleForPath wiring; the
    // manifest now carries modules. The sidebar renders from manifestFor(roles).
    expect(src()).toMatch(/manifestFor\(roles\)/);
    expect(src()).not.toMatch(/useNavSections/);
  });
  it('filters items through can() via computeVisibleSections and hides empty sections', () => {
    // can()-based pruning + empty-section drop moved into the pure manifest
    // helper (covered behaviourally by tests/nav/manifest.test.ts).
    expect(src()).toMatch(/computeVisibleSections\(.*\bcan\b/);
  });
  it('renders the real role label with t.nav.admin only as fallback', () => {
    expect(src()).toMatch(/roleLabel\s*\?\?\s*t\.nav\.admin|roleLabel \|\| t\.nav\.admin/);
  });
});

describe('codex fixes (slice 5)', () => {
  const src = () => read(PERMISSIONS);
  it('can() is action-aware (module:action grant set, no read-collapse)', () => {
    expect(src()).toMatch(/grants\.has\(`\$\{module\}:\$\{action\}`\)/);
    expect(src()).not.toMatch(/readable\.has/);
  });
  it('guard resolves the path BEFORE waiting on sessionInfo (ungated routes never skeleton)', () => {
    const guard = src().slice(src().indexOf('function RouteAccessGuard'));
    expect(guard.indexOf('moduleForPath(pathname)')).toBeLessThan(guard.indexOf('GuardSkeleton'));
  });
});
