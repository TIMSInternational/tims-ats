import { describe, it, expect } from 'vitest';
import { computeBackfillPlan } from '../../packages/db/prisma/backfill-assessment-norms';

describe('computeBackfillPlan', () => {
  it('computes a percentile/band for each non-partial result using every OTHER non-partial result in the same org+type', () => {
    const results = [
      { assignmentId: 'a1', assessmentTypeId: 't1', normalizedScore: 20, hasPending: false },
      { assignmentId: 'a2', assessmentTypeId: 't1', normalizedScore: 40, hasPending: false },
      { assignmentId: 'a3', assessmentTypeId: 't1', normalizedScore: 60, hasPending: false },
      { assignmentId: 'a4', assessmentTypeId: 't1', normalizedScore: 80, hasPending: false },
      { assignmentId: 'a5', assessmentTypeId: 't1', normalizedScore: 100, hasPending: false },
    ];
    const plan = computeBackfillPlan(results);
    expect(plan).toHaveLength(5);
    // a1 (score 20) vs population [40,60,80,100] (4, below MIN_NORM_SAMPLE_SIZE=5) -> null
    expect(plan.find((p) => p.assignmentId === 'a1')).toMatchObject({
      percentile: null,
      band: null,
      normSampleSize: 4,
    });
  });

  it('skips partial results entirely (never computes a band, never counts them in others population)', () => {
    const results = [
      { assignmentId: 'a1', assessmentTypeId: 't1', normalizedScore: 20, hasPending: true },
      { assignmentId: 'a2', assessmentTypeId: 't1', normalizedScore: 40, hasPending: false },
    ];
    const plan = computeBackfillPlan(results);
    expect(plan.find((p) => p.assignmentId === 'a1')).toBeUndefined();
  });

  it('never mixes populations across different assessment types', () => {
    const results = [
      { assignmentId: 'a1', assessmentTypeId: 't1', normalizedScore: 20, hasPending: false },
      { assignmentId: 'a2', assessmentTypeId: 't2', normalizedScore: 20, hasPending: false },
    ];
    const plan = computeBackfillPlan(results);
    expect(plan.find((p) => p.assignmentId === 'a1')).toMatchObject({ normSampleSize: 0 });
  });
});
