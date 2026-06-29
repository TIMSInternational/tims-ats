import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('S4 performance OKR/commitment/coaching wiring', () => {
  const okrModal = read('apps/web/app/(admin)/people/performance/create-okr-modal.tsx');
  const commitModal = read('apps/web/app/(admin)/people/performance/create-commitment-modal.tsx');
  const coachModal = read('apps/web/app/(admin)/people/performance/log-coaching-modal.tsx');
  const page = read('apps/web/app/(admin)/people/performance/page.tsx');
  const coachPanel = read('apps/web/app/(admin)/people/performance/coaching-panel.tsx');
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));

  // --- OKR modal ---
  it('OKR modal calls createOkr mutation (not a comingSoon stub)', () => {
    expect(okrModal).toMatch(/trpc\.performance\.createOkr\.useMutation/);
    expect(okrModal).not.toMatch(/comingSoon/);
  });

  it('OKR modal invalidates listOkrs and getDashboardKpis', () => {
    expect(okrModal).toMatch(/utils\.performance\.listOkrs\.invalidate/);
    expect(okrModal).toMatch(/utils\.performance\.getDashboardKpis\.invalidate/);
  });

  it('OKR modal renders inside shared Modal', () => {
    expect(okrModal).toMatch(/<Modal\b/);
    expect(okrModal).toMatch(/from '.*\/components'/);
  });

  it('OKR modal uses UserPicker for owner', () => {
    expect(okrModal).toMatch(/UserPicker/);
    expect(okrModal).toMatch(/userId.*owner\.id|owner\.id.*userId/);
  });

  it('OKR modal converts targetValue to Number on submit', () => {
    expect(okrModal).toMatch(/Number\(.*targetValue|targetValue.*Number\(/);
  });

  it('no inline style or any in OKR modal', () => {
    expect(okrModal).not.toMatch(/style=\{\{/);
    expect(okrModal).not.toMatch(/:\s*any\b/);
    expect(okrModal).not.toMatch(/\bas any\b/);
  });

  // --- Commitment modal ---
  it('commitment modal calls createCommitment mutation', () => {
    expect(commitModal).toMatch(/trpc\.performance\.createCommitment\.useMutation/);
    expect(commitModal).not.toMatch(/comingSoon/);
  });

  it('commitment modal invalidates listCommitments, myCommitments, getDashboardKpis', () => {
    expect(commitModal).toMatch(/utils\.performance\.listCommitments\.invalidate/);
    expect(commitModal).toMatch(/utils\.performance\.myCommitments\.invalidate/);
    expect(commitModal).toMatch(/utils\.performance\.getDashboardKpis\.invalidate/);
  });

  it('commitment modal renders inside shared Modal', () => {
    expect(commitModal).toMatch(/<Modal\b/);
    expect(commitModal).toMatch(/from '.*\/components'/);
  });

  it('commitment modal constructs Date from dueDate string', () => {
    expect(commitModal).toMatch(/new Date\(dueDate\)/);
  });

  it('no inline style or any in commitment modal', () => {
    expect(commitModal).not.toMatch(/style=\{\{/);
    expect(commitModal).not.toMatch(/:\s*any\b/);
    expect(commitModal).not.toMatch(/\bas any\b/);
  });

  // --- Coaching session modal ---
  it('coaching modal calls createCoachingSession mutation', () => {
    expect(coachModal).toMatch(/trpc\.performance\.createCoachingSession\.useMutation/);
    expect(coachModal).not.toMatch(/comingSoon/);
  });

  it('coaching modal invalidates listCoachingSessions and getDashboardKpis', () => {
    expect(coachModal).toMatch(/utils\.performance\.listCoachingSessions\.invalidate/);
    expect(coachModal).toMatch(/utils\.performance\.getDashboardKpis\.invalidate/);
  });

  it('coaching modal has no notes field', () => {
    expect(coachModal).not.toMatch(/\bnotes\b/);
  });

  it('coaching modal renders inside shared Modal', () => {
    expect(coachModal).toMatch(/<Modal\b/);
    expect(coachModal).toMatch(/from '.*\/components'/);
  });

  it('coaching modal constructs Date from scheduledAt string', () => {
    expect(coachModal).toMatch(/new Date\(scheduledAt\)/);
  });

  it('coaching modal uses two UserPickers (employee + leader)', () => {
    expect(coachModal).toMatch(/employeeId.*employee\.id|employee\.id.*employeeId/);
    expect(coachModal).toMatch(/leaderId.*coach\.id|coach\.id.*leaderId/);
  });

  it('no inline style or any in coaching modal', () => {
    expect(coachModal).not.toMatch(/style=\{\{/);
    expect(coachModal).not.toMatch(/:\s*any\b/);
    expect(coachModal).not.toMatch(/\bas any\b/);
  });

  // --- page.tsx trigger (OKR) ---
  it('page.tsx mounts CreateOkrModal and no longer uses createComingSoon for new-OKR button', () => {
    expect(page).toMatch(/<CreateOkrModal\b/);
    // The button that was wired to createComingSoon should now open the modal
    expect(page).not.toMatch(/createComingSoon.*newOkr|newOkr.*createComingSoon/);
  });

  // --- coaching-panel.tsx triggers ---
  it('coaching-panel.tsx mounts LogCoachingModal', () => {
    expect(coachPanel).toMatch(/<LogCoachingModal\b/);
  });

  it('coaching-panel.tsx mounts CreateCommitmentModal', () => {
    expect(coachPanel).toMatch(/<CreateCommitmentModal\b/);
  });

  // --- i18n keys in both locales ---
  it('OKR i18n keys exist in both locales', () => {
    for (const key of ['newOkr', 'createOkrTitle', 'createOkrSuccess', 'objectiveLabel', 'periodLabel', 'keyResultsLabel', 'addKeyResult']) {
      expect(es.performance[key], `es.performance.${key}`).toBeTruthy();
      expect(en.performance[key], `en.performance.${key}`).toBeTruthy();
    }
  });

  it('commitment i18n keys exist in both locales', () => {
    for (const key of ['createCommitmentTitle', 'createCommitmentSuccess', 'descriptionLabel', 'dueDateLabel', 'newCommitment']) {
      expect(es.performance[key], `es.performance.${key}`).toBeTruthy();
      expect(en.performance[key], `en.performance.${key}`).toBeTruthy();
    }
  });

  it('coaching i18n keys exist in both locales', () => {
    for (const key of ['logCoachingTitle', 'logCoachingSuccess', 'employeeLabel', 'coachLabel', 'topicLabel', 'logCoachingAction']) {
      expect(es.performance[key], `es.performance.${key}`).toBeTruthy();
      expect(en.performance[key], `en.performance.${key}`).toBeTruthy();
    }
  });
});
