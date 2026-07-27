import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('S3 compensation approve/reject wiring', () => {
  const modal = read('apps/web/app/(admin)/compensation/approve-adjustment-modal.tsx');
  const host = read('apps/web/app/(admin)/compensation/comp-right-column.tsx');
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));

  it('calls the real mutation (not a comingSoon stub)', () => {
    // Cut over to the dark platform-api wrapper (apps/web/lib/platform-api/compensation.ts,
    // Phase-5 Slice-12 write wrapper) — it still calls trpc.compensation.approveAdjustment.useMutation
    // internally on the default (non-C#) path, so this assertion follows the refactor rather
    // than the raw call (same pattern as tests/access/survey-take-ui.test.ts's engagement fix).
    expect(modal).toMatch(/useCompensationApproveAdjustment/);
    expect(modal).not.toMatch(/comingSoon/);
  });

  it('handles both approve (true) and reject (false) paths', () => {
    // approved flag is derived from the mode prop — no duplicated mutate blocks
    expect(modal).toMatch(/approved:\s*mode\s*===\s*['"]approve['"]/);
    // host passes both verbs through the mode prop
    expect(host).toMatch(/mode:\s*['"]approve['"]/);
    expect(host).toMatch(/mode:\s*['"]reject['"]/);
  });

  it('invalidates listPendingAdjustments', () => {
    expect(modal).toMatch(/utils\.compensation\.listPendingAdjustments\.invalidate/);
  });

  it('invalidates all five queries', () => {
    expect(modal).toMatch(/utils\.compensation\.getDashboardKpis\.invalidate/);
    expect(modal).toMatch(/utils\.compensation\.getBandDistribution\.invalidate/);
    expect(modal).toMatch(/utils\.compensation\.getCompaRatioDistribution\.invalidate/);
    expect(modal).toMatch(/utils\.compensation\.getTotalCompBreakdown\.invalidate/);
  });

  it('renders inside the shared Modal', () => {
    expect(modal).toMatch(/<Modal\b/);
    expect(modal).toMatch(/from '.*\/components'/);
  });

  it('host mounts ApproveAdjustmentModal', () => {
    expect(host).toMatch(/<ApproveAdjustmentModal\b/);
  });

  it('no inline style or any', () => {
    expect(modal).not.toMatch(/style=\{\{/);
    expect(modal).not.toMatch(/:\s*any\b/);
    expect(modal).not.toMatch(/\bas any\b/);
  });

  it('new i18n keys exist in BOTH locales', () => {
    for (const key of ['approveTitle', 'approveSuccess', 'rejectSuccess']) {
      expect(es.compensation[key]).toBeTruthy();
      expect(en.compensation[key]).toBeTruthy();
    }
  });
});
