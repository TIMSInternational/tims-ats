import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('S2 engagement wiring', () => {
  const modal = read('apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx');
  const host = read('apps/web/app/(admin)/engagement/climate/page.tsx');
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));

  it('calls createSurvey mutation (not a comingSoon stub)', () => {
    // Cut over to the platform-api wrapper (apps/web/lib/platform-api/engagement.ts, Phase-5
    // Slice-16 write wrapper). As of 2026-07-29 that wrapper is C#-ONLY for this mutation —
    // trpc.engagement.createSurvey was deleted — so this assertion targets the wrapper hook name
    // rather than a raw trpc call (same pattern as tests/access/survey-take-ui.test.ts's fix).
    expect(modal).toMatch(/useEngagementCreateSurvey/);
    expect(modal).not.toMatch(/comingSoon/);
  });

  it('chains activateSurvey after createSurvey onSuccess', () => {
    expect(modal).toMatch(/useEngagementActivateSurvey/);
    expect(modal).toMatch(/activate\.mutate/);
  });

  it('invalidates listSurveys and getDashboardKpis', () => {
    expect(modal).toMatch(/utils\.engagement\.listSurveys\.invalidate/);
    expect(modal).toMatch(/utils\.engagement\.getDashboardKpis\.invalidate/);
  });

  it('renders inside the shared Modal', () => {
    expect(modal).toMatch(/<Modal\b/);
    expect(modal).toMatch(/from '.*\/components'/);
  });

  it('exports addQuestion helper for unit testing', () => {
    expect(modal).toMatch(/export.*function addQuestion|export const addQuestion|export \{[^}]*addQuestion/);
  });

  it('host mounts LaunchSurveyModal instead of toasting comingSoon', () => {
    expect(host).toMatch(/<LaunchSurveyModal\b/);
  });

  it('no inline style or any type', () => {
    expect(modal).not.toMatch(/style=\{\{/);
    expect(modal).not.toMatch(/:\s*any\b/);
    expect(modal).not.toMatch(/\bas any\b/);
  });

  it('new i18n keys exist in BOTH locales', () => {
    for (const key of ['launchSurveyTitle', 'launchSurveySuccess']) {
      expect(es.climate[key]).toBeTruthy();
      expect(en.climate[key]).toBeTruthy();
    }
  });
});
