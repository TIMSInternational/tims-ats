import { describe, it, expect } from 'vitest';
import { computeBackfillPlan, isNonPartial } from '../../packages/db/prisma/backfill-assessment-norms';

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

describe('isNonPartial', () => {
  // Must mirror listOtherNormalizedScoresInTx's live-scoring predicate
  // (`breakdown: { path: ['pendingManual'], equals: [] }`) exactly, or the
  // backfill and the live path can disagree on who's eligible for scoring.

  it('treats a null breakdown as partial (excluded) — matches the live query, which requires the key to exist', () => {
    expect(isNonPartial(null)).toBe(false);
  });

  it('treats a breakdown with no pendingManual key at all as partial (excluded)', () => {
    expect(isNonPartial({})).toBe(false);
  });

  it('treats a DISC-shaped breakdown (seed-demo.ts / externally-ingested, no pendingManual key) as partial (excluded)', () => {
    expect(isNonPartial({ D: 10, I: 20, S: 5, C: 3 })).toBe(false);
  });

  it('treats an empty pendingManual array as non-partial (eligible)', () => {
    expect(isNonPartial({ pendingManual: [] })).toBe(true);
  });

  it('treats a non-empty pendingManual array as partial (excluded)', () => {
    expect(isNonPartial({ pendingManual: ['question-1'] })).toBe(false);
  });
});

describe('computeBackfillPlan — null/missing-pendingManual breakdown exclusion (Fix 1)', () => {
  it('excludes a null-breakdown row from scoring AND from other rows population, matching live-scoring semantics', () => {
    const results = [
      // breakdown: null -> partial -> must be excluded from scoring and population
      { assignmentId: 'a1', assessmentTypeId: 't1', normalizedScore: 50, hasPending: !isNonPartial(null) },
      {
        assignmentId: 'a2',
        assessmentTypeId: 't1',
        normalizedScore: 40,
        hasPending: !isNonPartial({ pendingManual: [] }),
      },
      {
        assignmentId: 'a3',
        assessmentTypeId: 't1',
        normalizedScore: 60,
        hasPending: !isNonPartial({ pendingManual: [] }),
      },
      // breakdown: {} (no pendingManual key) -> partial -> must be excluded too
      { assignmentId: 'a4', assessmentTypeId: 't1', normalizedScore: 70, hasPending: !isNonPartial({}) },
    ];
    const plan = computeBackfillPlan(results);

    expect(plan.find((p) => p.assignmentId === 'a1')).toBeUndefined();
    expect(plan.find((p) => p.assignmentId === 'a4')).toBeUndefined();
    // a2's eligible population is only { a3 } — a1 and a4 must NOT be counted
    expect(plan.find((p) => p.assignmentId === 'a2')).toMatchObject({ normSampleSize: 1 });
  });
});
