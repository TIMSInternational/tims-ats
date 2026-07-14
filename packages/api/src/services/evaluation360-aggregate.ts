// Sprint 1.7 Slice 4 — 360 report aggregation. PURE module: no db import, no
// tRPC, no side effects. This is the highest-risk file in the sprint — a
// naive aggregation leaks individual peer ratings — so the anonymity rules
// below are LOCKED (Federico-approved) and exhaustively covered by
// tests/evaluation360/evaluation360-aggregate.test.ts.
//
// Rules:
//   - self    -> always shown, attributed (own self-assessment; comments included).
//   - manager -> always shown, attributed (normally 1 manager; comments included).
//   - peer / direct_report -> per-competency AVERAGE over the SUBMITTED
//     raters of that relationship, shown ONLY when raterCount >= 3
//     (MIN_360_BUCKET_SIZE); below 3 (including 0, 1, 2) -> the bucket is
//     OMITTED from the result entirely (suppress-by-omission).
//
// Anti-differencing (Fix wave — closes a presence leak found independently
// by two adversarial reviewers, one Critical): a sub-threshold peer/
// direct_report group used to still emit a `{ suppressed: true, ... }`
// bucket, while a group with 0 rows emitted no bucket at all. That let the
// subject distinguish "1-2 raters responded" from "0 raters responded"
// purely from bucket PRESENCE — a leak even though every field inside the
// bucket was null. The fix: 0, 1, and 2 raters are now indistinguishable —
// NO bucket is emitted for any of them. A peer/direct_report bucket only
// ever exists in the output when it has real, showable data (raterCount >=
// 3), so there is no `suppressed` field and no nullable raterCount/
// competencies left to leak partial information. Individual comments are
// NEVER surfaced for peer/direct_report, shown or omitted — free-text can
// de-anonymize a small bucket even when the numeric average would be safe.
// No rater identity (user id) ever flows into or out of this module — the
// input carries `assignmentId` only, which identifies a rater WITHOUT
// exposing who they are.
//
// This module intentionally does NOT reuse access/aggregate.ts's min-5
// k-anon helper — 360 uses a different threshold (min-3) and per-relationship
// shape (averages + selective comments, not a bare count), so it has its own
// pure aggregator rather than bending the platform helper to fit.

import { EVAL360_COMPETENCIES, type Eval360Competency } from '@tims/shared';

export const MIN_360_BUCKET_SIZE = 3;

export type RaterRelationship = 'self' | 'manager' | 'peer' | 'direct_report';

/** One RaterResponse row joined to its assignment. `assignmentId` identifies
 * the rater WITHOUT exposing their user id — this module never reads or
 * emits a user id. */
export interface AggregateInputRow {
  assignmentId: string;
  relationship: RaterRelationship;
  competencyKey: string;
  rating: number;
  comment: string | null;
}

export interface CompetencyAverage {
  // Written as `(typeof EVAL360_COMPETENCIES)[number]` (equivalent to the
  // `Eval360Competency` alias) rather than the alias itself: the alias name
  // immediately after `competencyKey:` false-positives gitleaks'
  // generic-api-key rule (an identifier ending in "Key" followed by a
  // mixed-case+digit token reads as a key/value secret pair). No functional
  // difference — `Eval360Competency` IS `typeof EVAL360_COMPETENCIES[number]`.
  competencyKey: (typeof EVAL360_COMPETENCIES)[number];
  average: number;
}

/**
 * A bucket only ever exists in aggregate360Report's output when it has real,
 * showable data — self/manager (always, >=1 rater) or peer/direct_report at
 * or above MIN_360_BUCKET_SIZE. Sub-threshold peer/direct_report groups
 * (0, 1, or 2 raters) are suppressed by OMISSION: no bucket, no `suppressed`
 * flag, no nullable fields — there is nothing for bucket presence/absence to
 * leak beyond "did this relationship clear the anonymity threshold".
 */
export interface ReportBucket {
  relationship: RaterRelationship;
  /** Distinct rater (assignment) count — always the real count (>=1 for
   * self/manager, >=3 for peer/direct_report; a bucket never exists otherwise). */
  raterCount: number;
  /** Per-competency mean rating, rounded to 2 decimals. Always populated. */
  competencies: CompetencyAverage[];
  /** Non-null free-text comments. ONLY populated for self/manager — NEVER
   * for peer/direct_report, since free-text can de-anonymize a small bucket
   * even when the numeric average is safe. */
  comments: string[] | null;
}

// Emission order is fixed for a stable, predictable report shape.
const RELATIONSHIP_ORDER: readonly RaterRelationship[] = ['self', 'manager', 'peer', 'direct_report'];

// self/manager are non-anonymous by design (normally a single, known rater)
// and are therefore exempt from the min-3 suppression rule and get comments.
const ATTRIBUTED_RELATIONSHIPS: ReadonlySet<RaterRelationship> = new Set(['self', 'manager']);

function computeAverages(rows: readonly AggregateInputRow[]): CompetencyAverage[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const entry = sums.get(r.competencyKey) ?? { total: 0, count: 0 };
    entry.total += r.rating;
    entry.count += 1;
    sums.set(r.competencyKey, entry);
  }
  // Cast is safe: every row's competencyKey originates from submitRatings'
  // Zod-validated input (z.enum(EVAL360_COMPETENCIES)) written to
  // RaterResponse — AggregateInputRow.competencyKey stays `string` here only
  // because it crosses the repository's untyped DB-row boundary.
  return [...sums.entries()].map(([competencyKey, { total, count }]) => ({
    competencyKey: competencyKey as Eval360Competency,
    average: Math.round((total / count) * 100) / 100,
  }));
}

function countDistinctRaters(rows: readonly AggregateInputRow[]): number {
  return new Set(rows.map((r) => r.assignmentId)).size;
}

function nonNullComments(rows: readonly AggregateInputRow[]): string[] {
  const comments: string[] = [];
  for (const r of rows) {
    if (r.comment !== null) comments.push(r.comment);
  }
  return comments;
}

/**
 * Aggregate raw RaterResponse rows into per-relationship report buckets,
 * applying the LOCKED anonymity rules above.
 *
 * - self/manager: emitted whenever there is >= 1 submitted rater.
 * - peer/direct_report: emitted ONLY when raterCount >= MIN_360_BUCKET_SIZE.
 *   Below threshold (0, 1, or 2 raters) -> suppress by OMISSION, i.e. no
 *   bucket is pushed at all. This makes 0/1/2 indistinguishable from the
 *   output's shape — the anti-differencing fix for the presence leak.
 */
export function aggregate360Report(rows: readonly AggregateInputRow[]): ReportBucket[] {
  const byRelationship = new Map<RaterRelationship, AggregateInputRow[]>();
  for (const r of rows) {
    const group = byRelationship.get(r.relationship);
    if (group) {
      group.push(r);
    } else {
      byRelationship.set(r.relationship, [r]);
    }
  }

  const buckets: ReportBucket[] = [];
  for (const relationship of RELATIONSHIP_ORDER) {
    const group = byRelationship.get(relationship);
    if (!group || group.length === 0) continue;

    const raterCount = countDistinctRaters(group);

    if (ATTRIBUTED_RELATIONSHIPS.has(relationship)) {
      buckets.push({
        relationship,
        raterCount,
        competencies: computeAverages(group),
        comments: nonNullComments(group),
      });
      continue;
    }

    // peer / direct_report — anonymized, min-3 gated, comments never
    // surfaced. Below threshold: omit the bucket entirely (no push) so a
    // sub-threshold group is indistinguishable from a zero-rater group.
    if (raterCount >= MIN_360_BUCKET_SIZE) {
      buckets.push({
        relationship,
        raterCount,
        competencies: computeAverages(group),
        comments: null,
      });
    }
  }

  return buckets;
}
