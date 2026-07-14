import { describe, it, expect } from 'vitest';
import { aggregate360Report, MIN_360_BUCKET_SIZE, type AggregateInputRow } from '../../packages/api/src/services/evaluation360-aggregate';

// Sprint 1.7 Slice 4 — the aggregation truth table for the 360 anonymity
// rules. This is the MOST IMPORTANT test file in the sprint: a naive
// aggregation leaks individual peer ratings, so every LOCKED rule below has
// an explicit, exhaustive test. Rules (Federico-approved):
//   - self    -> always shown, attributed, with comments.
//   - manager -> always shown, attributed, with comments (normally 1 rater).
//   - peer / direct_report -> per-competency AVERAGE over SUBMITTED raters,
//     shown ONLY when raterCount >= 3 (MIN_360_BUCKET_SIZE); below 3 (0, 1,
//     or 2 raters) -> suppressed by OMISSION — NO bucket is emitted at all.
//
// Fix wave (anti-differencing presence leak, two independent adversarial
// reviewers, one Critical): a sub-threshold bucket used to still be emitted
// as `{ suppressed: true, raterCount: null, ... }`, while a 0-rater group
// emitted no bucket. That let the subject distinguish "1-2 raters
// responded" from "0 raters responded" purely from bucket PRESENCE, even
// though every field inside the bucket was null. The fix: 0/1/2 raters are
// now indistinguishable — no bucket, period. There is no `suppressed` field
// and no nullable raterCount/competencies left in the DTO; a peer/
// direct_report bucket only exists in the output when raterCount >= 3.
//   - peer/direct_report comments are NEVER surfaced, shown or omitted
//     (free-text can de-anonymize a small bucket).
//   - No bucket ever contains a user id (the input only carries
//     assignmentId, never a rater's user id).

const row = (overrides: Partial<AggregateInputRow>): AggregateInputRow => ({
  assignmentId: 'a1',
  relationship: 'peer',
  competencyKey: 'leadership',
  rating: 4,
  comment: null,
  ...overrides,
});

describe('MIN_360_BUCKET_SIZE', () => {
  it('is 3 (deliberately different from the platform min-5 k-anon floor in access/aggregate.ts)', () => {
    expect(MIN_360_BUCKET_SIZE).toBe(3);
  });
});

describe('aggregate360Report — peer/direct_report anonymity threshold (suppress by omission)', () => {
  it('omits the peer bucket entirely with 2 distinct raters (below threshold)', () => {
    const rows = [
      row({ assignmentId: 'p1', relationship: 'peer', rating: 4, comment: 'good' }),
      row({ assignmentId: 'p2', relationship: 'peer', rating: 5, comment: 'great' }),
    ];
    const buckets = aggregate360Report(rows);
    expect(buckets.find((b) => b.relationship === 'peer')).toBeUndefined();
  });

  it('omits the peer bucket entirely with exactly 1 distinct rater (the "1 peer x 6 competencies = 6 rows must not show" case)', () => {
    const rows = [
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'leadership', rating: 4 }),
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'communication', rating: 3 }),
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'collaboration', rating: 5 }),
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'execution', rating: 4 }),
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'adaptability', rating: 2 }),
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'integrity', rating: 5 }),
    ];
    const buckets = aggregate360Report(rows);
    expect(buckets.find((b) => b.relationship === 'peer')).toBeUndefined();
  });

  it('shows a peer bucket with exactly 3 distinct raters (at threshold)', () => {
    const rows = [
      row({ assignmentId: 'p1', relationship: 'peer', rating: 4 }),
      row({ assignmentId: 'p2', relationship: 'peer', rating: 5 }),
      row({ assignmentId: 'p3', relationship: 'peer', rating: 3 }),
    ];
    const buckets = aggregate360Report(rows);
    const peer = buckets.find((b) => b.relationship === 'peer');
    expect(peer).toBeDefined();
    expect(peer?.raterCount).toBe(3);
    expect(peer?.competencies).toEqual([{ competencyKey: 'leadership', average: 4 }]);
    expect(peer?.comments).toBeNull();
  });

  it('omits the direct_report bucket entirely with 2 distinct raters', () => {
    const rows = [
      row({ assignmentId: 'r1', relationship: 'direct_report', rating: 4 }),
      row({ assignmentId: 'r2', relationship: 'direct_report', rating: 2 }),
    ];
    const buckets = aggregate360Report(rows);
    expect(buckets.find((b) => b.relationship === 'direct_report')).toBeUndefined();
  });

  it('shows a direct_report bucket with 4 distinct raters', () => {
    const rows = [
      row({ assignmentId: 'r1', relationship: 'direct_report', rating: 4 }),
      row({ assignmentId: 'r2', relationship: 'direct_report', rating: 5 }),
      row({ assignmentId: 'r3', relationship: 'direct_report', rating: 3 }),
      row({ assignmentId: 'r4', relationship: 'direct_report', rating: 4 }),
    ];
    const buckets = aggregate360Report(rows);
    const dr = buckets.find((b) => b.relationship === 'direct_report');
    expect(dr).toBeDefined();
    expect(dr?.raterCount).toBe(4);
    expect(dr?.comments).toBeNull();
  });

  it('uses DISTINCT assignmentId count, not response-row count, for the threshold (2 raters x 2 competencies = 4 rows, still omitted)', () => {
    const rows = [
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'leadership', rating: 4 }),
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'communication', rating: 3 }),
      row({ assignmentId: 'p2', relationship: 'peer', competencyKey: 'leadership', rating: 5 }),
      row({ assignmentId: 'p2', relationship: 'peer', competencyKey: 'communication', rating: 5 }),
    ];
    const buckets = aggregate360Report(rows);
    expect(buckets.find((b) => b.relationship === 'peer')).toBeUndefined();
  });
});

describe('aggregate360Report — self/manager always shown, attributed', () => {
  it('self (1 rater) is shown with averages + comments', () => {
    const rows = [row({ assignmentId: 's1', relationship: 'self', rating: 4, comment: 'my self view' })];
    const buckets = aggregate360Report(rows);
    const self = buckets.find((b) => b.relationship === 'self');
    expect(self).toEqual({
      relationship: 'self',
      raterCount: 1,
      competencies: [{ competencyKey: 'leadership', average: 4 }],
      comments: ['my self view'],
    });
  });

  it('manager (1 rater) is shown, attributed, with comments', () => {
    const rows = [row({ assignmentId: 'm1', relationship: 'manager', rating: 5, comment: 'strong performer' })];
    const buckets = aggregate360Report(rows);
    const manager = buckets.find((b) => b.relationship === 'manager');
    expect(manager).toEqual({
      relationship: 'manager',
      raterCount: 1,
      competencies: [{ competencyKey: 'leadership', average: 5 }],
      comments: ['strong performer'],
    });
  });

  it('self/manager comments exclude null comments but include all non-null ones', () => {
    const rows = [
      row({ assignmentId: 'm1', relationship: 'manager', competencyKey: 'leadership', rating: 4, comment: 'good' }),
      row({ assignmentId: 'm1', relationship: 'manager', competencyKey: 'communication', rating: 4, comment: null }),
    ];
    const buckets = aggregate360Report(rows);
    const manager = buckets.find((b) => b.relationship === 'manager');
    expect(manager?.comments).toEqual(['good']);
  });

  it('manager bucket is never omitted even with only 1 rater (self/manager are exempt from the min-3 rule)', () => {
    const rows = [row({ assignmentId: 'm1', relationship: 'manager', rating: 3 })];
    const buckets = aggregate360Report(rows);
    expect(buckets.find((b) => b.relationship === 'manager')).toBeDefined();
  });
});

describe('aggregate360Report — averages', () => {
  it('computes the mean rating per competency across peers ([4,5,3] -> 4)', () => {
    const rows = [
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'leadership', rating: 4 }),
      row({ assignmentId: 'p2', relationship: 'peer', competencyKey: 'leadership', rating: 5 }),
      row({ assignmentId: 'p3', relationship: 'peer', competencyKey: 'leadership', rating: 3 }),
    ];
    const buckets = aggregate360Report(rows);
    const peer = buckets.find((b) => b.relationship === 'peer');
    expect(peer?.competencies).toEqual([{ competencyKey: 'leadership', average: 4 }]);
  });

  it('computes independent averages per competency', () => {
    const rows = [
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'leadership', rating: 4 }),
      row({ assignmentId: 'p1', relationship: 'peer', competencyKey: 'communication', rating: 2 }),
      row({ assignmentId: 'p2', relationship: 'peer', competencyKey: 'leadership', rating: 5 }),
      row({ assignmentId: 'p2', relationship: 'peer', competencyKey: 'communication', rating: 3 }),
      row({ assignmentId: 'p3', relationship: 'peer', competencyKey: 'leadership', rating: 3 }),
      row({ assignmentId: 'p3', relationship: 'peer', competencyKey: 'communication', rating: 4 }),
    ];
    const buckets = aggregate360Report(rows);
    const peer = buckets.find((b) => b.relationship === 'peer');
    expect(peer?.competencies).toEqual(
      expect.arrayContaining([
        { competencyKey: 'leadership', average: 4 },
        { competencyKey: 'communication', average: 3 },
      ]),
    );
    expect(peer?.competencies).toHaveLength(2);
  });

  it('rounds an average to 2 decimals (e.g. [4,4,5] -> 4.33)', () => {
    const rows = [
      row({ assignmentId: 'p1', relationship: 'peer', rating: 4 }),
      row({ assignmentId: 'p2', relationship: 'peer', rating: 4 }),
      row({ assignmentId: 'p3', relationship: 'peer', rating: 5 }),
    ];
    const buckets = aggregate360Report(rows);
    const peer = buckets.find((b) => b.relationship === 'peer');
    expect(peer?.competencies?.[0]?.average).toBeCloseTo(4.33, 2);
  });
});

describe('aggregate360Report — mixed input / anti-differencing', () => {
  it('a sub-threshold peer group contributes NO bucket while shown manager + shown self are present', () => {
    const rows = [
      row({ assignmentId: 's1', relationship: 'self', rating: 4, comment: 'self note' }),
      row({ assignmentId: 'm1', relationship: 'manager', rating: 5, comment: 'manager note' }),
      row({ assignmentId: 'p1', relationship: 'peer', rating: 4, comment: 'peer note A' }),
      row({ assignmentId: 'p2', relationship: 'peer', rating: 2, comment: 'peer note B' }),
    ];
    const buckets = aggregate360Report(rows);

    const self = buckets.find((b) => b.relationship === 'self');
    const manager = buckets.find((b) => b.relationship === 'manager');
    const peer = buckets.find((b) => b.relationship === 'peer');

    expect(self).toMatchObject({ raterCount: 1 });
    expect(manager).toMatchObject({ raterCount: 1 });
    expect(peer).toBeUndefined();

    // Anti-differencing: the sub-threshold peer relationship is absent from
    // the result entirely — nothing (not even a null-filled bucket) reveals
    // its size or content.
    expect(JSON.stringify(buckets)).not.toMatch(/peer note/);
    expect(buckets.map((b) => b.relationship)).toEqual(['self', 'manager']);
  });

  it('does not emit a bucket for a relationship with zero submitted raters', () => {
    const rows = [row({ assignmentId: 's1', relationship: 'self', rating: 4 })];
    const buckets = aggregate360Report(rows);
    expect(buckets.map((b) => b.relationship)).toEqual(['self']);
    expect(buckets.find((b) => b.relationship === 'manager')).toBeUndefined();
    expect(buckets.find((b) => b.relationship === 'peer')).toBeUndefined();
    expect(buckets.find((b) => b.relationship === 'direct_report')).toBeUndefined();
  });

  it('a sub-threshold peer group AND a sub-threshold direct_report group are both absent alongside a >=3 peer group and shown self/manager', () => {
    const rows = [
      row({ assignmentId: 's1', relationship: 'self', rating: 4 }),
      row({ assignmentId: 'm1', relationship: 'manager', rating: 5 }),
      // peer clears the threshold (3 raters)
      row({ assignmentId: 'p1', relationship: 'peer', rating: 4 }),
      row({ assignmentId: 'p2', relationship: 'peer', rating: 5 }),
      row({ assignmentId: 'p3', relationship: 'peer', rating: 3 }),
      // direct_report is sub-threshold (2 raters)
      row({ assignmentId: 'r1', relationship: 'direct_report', rating: 4 }),
      row({ assignmentId: 'r2', relationship: 'direct_report', rating: 2 }),
    ];
    const buckets = aggregate360Report(rows);
    expect(buckets.map((b) => b.relationship)).toEqual(['self', 'manager', 'peer']);
    expect(buckets.find((b) => b.relationship === 'direct_report')).toBeUndefined();
  });
});

describe('aggregate360Report — no user id ever surfaces; peer/direct_report comments always null', () => {
  it('no bucket ever contains a user id (only assignmentId flows in, and it is never emitted in a bucket)', () => {
    const rows = [
      row({ assignmentId: 'LOOKS-LIKE-A-USER-ID', relationship: 'self', rating: 4 }),
      row({ assignmentId: 'p1', relationship: 'peer', rating: 4 }),
      row({ assignmentId: 'p2', relationship: 'peer', rating: 5 }),
      row({ assignmentId: 'p3', relationship: 'peer', rating: 3 }),
    ];
    const buckets = aggregate360Report(rows);
    expect(JSON.stringify(buckets)).not.toMatch(/LOOKS-LIKE-A-USER-ID/);
  });

  it('peer bucket comments is always null, even when shown (>=3 raters)', () => {
    const rows = [
      row({ assignmentId: 'p1', relationship: 'peer', rating: 4, comment: 'a' }),
      row({ assignmentId: 'p2', relationship: 'peer', rating: 5, comment: 'b' }),
      row({ assignmentId: 'p3', relationship: 'peer', rating: 3, comment: 'c' }),
    ];
    const buckets = aggregate360Report(rows);
    expect(buckets.find((b) => b.relationship === 'peer')?.comments).toBeNull();
  });

  it('direct_report bucket comments is always null, even when shown (>=3 raters)', () => {
    const rows = [
      row({ assignmentId: 'r1', relationship: 'direct_report', rating: 4, comment: 'a' }),
      row({ assignmentId: 'r2', relationship: 'direct_report', rating: 5, comment: 'b' }),
      row({ assignmentId: 'r3', relationship: 'direct_report', rating: 3, comment: 'c' }),
    ];
    const buckets = aggregate360Report(rows);
    expect(buckets.find((b) => b.relationship === 'direct_report')?.comments).toBeNull();
  });
});

describe('aggregate360Report — empty input', () => {
  it('returns an empty array for no rows', () => {
    expect(aggregate360Report([])).toEqual([]);
  });
});
