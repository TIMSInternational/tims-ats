import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('S6 onboarding wiring', () => {
  const modal = read('apps/web/app/(admin)/people/onboarding/create-plan-modal.tsx');
  const page = read('apps/web/app/(admin)/people/onboarding/page.tsx');
  const table = read('apps/web/app/(admin)/people/onboarding/onboarding-table.tsx');
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));

  // ── Create-plan modal assertions ───────────────────────────────────────────

  it('calls the real onboarding.create mutation (not a comingSoon stub)', () => {
    expect(modal).toMatch(/trpc\.onboarding\.create\.useMutation/);
    expect(modal).not.toMatch(/comingSoon/);
  });

  it('invalidates onboarding.list on create success', () => {
    expect(modal).toMatch(/utils\.onboarding\.list\.invalidate/);
  });

  it('invalidates onboarding.getDashboardKpis on create success', () => {
    expect(modal).toMatch(/utils\.onboarding\.getDashboardKpis\.invalidate/);
  });

  it('renders inside the shared Modal component', () => {
    expect(modal).toMatch(/<Modal\b/);
    expect(modal).toMatch(/from '.*\/components'/);
  });

  it('uses UserPicker for new-hire selection', () => {
    expect(modal).toMatch(/UserPicker/);
  });

  it('has no inline style or any type', () => {
    expect(modal).not.toMatch(/style=\{\{/);
    expect(modal).not.toMatch(/:\s*any\b/);
    expect(modal).not.toMatch(/\bas any\b/);
  });

  // ── Host page assertions ───────────────────────────────────────────────────

  it('page.tsx mounts CreatePlanModal', () => {
    expect(page).toMatch(/<CreatePlanModal\b/);
  });

  it('page.tsx no longer toasts comingSoon for create button', () => {
    // The create button should not have a comingSoon toast
    // (the export button may still use comingSoon — that is acceptable)
    expect(page).not.toMatch(/onClick=\{.*\(\)\s*=>\s*toast\(`\$\{t\.common\.create\}/);
  });

  // ── Inline task toggle assertions ──────────────────────────────────────────

  it('onboarding-table.tsx wires onboarding.updateTask mutation', () => {
    // May live in the table itself OR in an extracted sibling imported by the table
    const taskList = (() => {
      try {
        return read('apps/web/app/(admin)/people/onboarding/onboarding-task-list.tsx');
      } catch {
        return '';
      }
    })();
    const combined = table + taskList;
    expect(combined).toMatch(/trpc\.onboarding\.updateTask\.useMutation/);
  });

  it('onboarding-table.tsx (or sibling) invalidates onboarding.list on toggle', () => {
    const taskList = (() => {
      try {
        return read('apps/web/app/(admin)/people/onboarding/onboarding-task-list.tsx');
      } catch {
        return '';
      }
    })();
    const combined = table + taskList;
    expect(combined).toMatch(/utils\.onboarding\.list\.invalidate/);
  });

  it('onboarding-table.tsx (or sibling) has a checkbox onChange wired to updateTask', () => {
    const taskList = (() => {
      try {
        return read('apps/web/app/(admin)/people/onboarding/onboarding-task-list.tsx');
      } catch {
        return '';
      }
    })();
    const combined = table + taskList;
    expect(combined).toMatch(/type="checkbox"/);
    expect(combined).toMatch(/onChange/);
    expect(combined).toMatch(/toggleTask\.mutate|updateTask\.mutate/);
  });

  it('table mounts OnboardingTaskList OR contains updateTask wiring directly', () => {
    const hasExtracted = table.includes('<OnboardingTaskList');
    const hasInline = table.includes('updateTask.useMutation') || table.includes('toggleTask.useMutation');
    expect(hasExtracted || hasInline).toBe(true);
  });

  it('no style={{ or any in new table/sibling files', () => {
    const taskList = (() => {
      try {
        return read('apps/web/app/(admin)/people/onboarding/onboarding-task-list.tsx');
      } catch {
        return '';
      }
    })();
    expect(taskList).not.toMatch(/style=\{\{/);
    expect(taskList).not.toMatch(/:\s*any\b/);
    expect(taskList).not.toMatch(/\bas any\b/);
  });

  // ── i18n assertions ────────────────────────────────────────────────────────

  it('i18n key createPlanTitle exists in BOTH locales', () => {
    expect(es.onboarding.createPlanTitle, 'es.onboarding.createPlanTitle').toBeTruthy();
    expect(en.onboarding.createPlanTitle, 'en.onboarding.createPlanTitle').toBeTruthy();
  });

  it('i18n key createPlanSuccess exists in BOTH locales', () => {
    expect(es.onboarding.createPlanSuccess, 'es.onboarding.createPlanSuccess').toBeTruthy();
    expect(en.onboarding.createPlanSuccess, 'en.onboarding.createPlanSuccess').toBeTruthy();
  });

  it('i18n key taskToggleSuccess exists in BOTH locales', () => {
    expect(es.onboarding.taskToggleSuccess, 'es.onboarding.taskToggleSuccess').toBeTruthy();
    expect(en.onboarding.taskToggleSuccess, 'en.onboarding.taskToggleSuccess').toBeTruthy();
  });

  it('i18n keys newHireLabel, buddyLabel, startDateLabel, phaseLabel exist in BOTH locales', () => {
    for (const key of ['newHireLabel', 'buddyLabel', 'startDateLabel', 'phaseLabel']) {
      expect(es.onboarding[key], `es.onboarding.${key}`).toBeTruthy();
      expect(en.onboarding[key], `en.onboarding.${key}`).toBeTruthy();
    }
  });

  it('i18n keys expandTasks and tasksLabel exist in BOTH locales', () => {
    expect(es.onboarding.expandTasks, 'es.onboarding.expandTasks').toBeTruthy();
    expect(en.onboarding.expandTasks, 'en.onboarding.expandTasks').toBeTruthy();
    expect(es.onboarding.tasksLabel, 'es.onboarding.tasksLabel').toBeTruthy();
    expect(en.onboarding.tasksLabel, 'en.onboarding.tasksLabel').toBeTruthy();
  });
});
