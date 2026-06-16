import { describe, it, expect } from 'vitest';
import {
  MANIFESTS, manifestFor, resolveLabel, computeVisibleSections, NAV_ROLES,
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
