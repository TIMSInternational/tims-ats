import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('S1 succession wiring', () => {
  const modal = read('apps/web/app/(admin)/talent/succession/add-successor-modal.tsx');
  const host = read('apps/web/app/(admin)/talent/succession/page.tsx');
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));

  it('calls the real mutation (not a comingSoon stub)', () => {
    expect(modal).toMatch(/trpc\.succession\.addSuccessor\.useMutation/);
    expect(modal).not.toMatch(/comingSoon/);
  });

  it('invalidates the affected queries', () => {
    expect(modal).toMatch(/utils\.succession\.listCriticalRoles\.invalidate/);
    expect(modal).toMatch(/utils\.succession\.getDashboardKpis\.invalidate/);
    expect(modal).toMatch(/utils\.succession\.getCompetencyCoverage\.invalidate/);
    expect(modal).toMatch(/utils\.succession\.getRolesWithoutSuccessor\.invalidate/);
    // Sprint 1.4 Task 1 -> Task 4 cross-feature handoff: adding a suggested
    // successor must live-refresh the comp-gap check and drop the candidate
    // from the suggestion list, not just wait for next reload.
    expect(modal).toMatch(/utils\.succession\.getCompGapAlerts\.invalidate/);
    expect(modal).toMatch(/utils\.succession\.getSuggestedSuccessors\.invalidate/);
  });

  it('renders inside the shared Modal', () => {
    expect(modal).toMatch(/<Modal\b/);
    expect(modal).toMatch(/from '.*\/components'/);
  });

  it('host opens the modal instead of toasting comingSoon', () => {
    expect(host).toMatch(/<AddSuccessorModal\b/);
  });

  it('no inline style or any', () => {
    expect(modal).not.toMatch(/style=\{\{/);
    expect(modal).not.toMatch(/:\s*any\b/);
    expect(modal).not.toMatch(/\bas any\b/);
  });

  it('new i18n keys exist in BOTH locales', () => {
    for (const key of ['addSuccessorTitle', 'addSuccessorSuccess']) {
      expect(es.succession[key]).toBeTruthy();
      expect(en.succession[key]).toBeTruthy();
    }
  });
});
