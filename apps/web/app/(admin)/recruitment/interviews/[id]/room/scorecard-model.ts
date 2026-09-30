import { z } from 'zod';
import {
  DEFAULT_COMPETENCY_IDS,
  RATING_KEY_MAX,
  type ScorecardCompetency,
} from '@tims/shared';

// ---------------------------------------------------------------------------
// Pure scorecard model for the interview room. Mirrors the input contract of
// the existing `interview.submitScorecard` procedure
// (packages/api/src/routers/interview/scorecards.ts):
//   ratings:        Record<string(max 80), number 1..5>
//   recommendation: strong_yes | yes | neutral | no | strong_no
//   overallNotes:   string max 2000 (optional)
// Kept React-free so the rules are unit-testable on their own.
// ---------------------------------------------------------------------------

// The competency-set derivation (resolveCompetencies, ratingKeyFor, the generic
// fallback) lives in @tims/shared so interview.submitScorecard enforces the SAME
// completeness rule server-side (PR #303 tier-3 finding: an empty card used to be
// accepted by the API and un-blinded its submitter).
export {
  DEFAULT_COMPETENCY_IDS,
  MAX_COMPETENCIES,
  RATING_KEY_MAX,
  ratingKeyFor,
  resolveCompetencies,
  type CompetencySource,
  type DefaultCompetencyId,
  type ResolvedCompetencies,
  type ScorecardCompetency,
} from '@tims/shared';

export const OVERALL_NOTES_MAX = 2000;

export const RECOMMENDATIONS = ['strong_yes', 'yes', 'neutral', 'no', 'strong_no'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

// Mirrors submitScorecard's input contract exactly (z.number().min(1).max(5), NOT
// .int()): a stored fractional rating is valid data and must not blank the whole map.
export const storedRatingsSchema = z.record(z.string().max(RATING_KEY_MAX), z.number().min(1).max(5));

/** Narrows a persisted `ratings` Json value; anything malformed reads as empty. */
export function parseStoredRatings(value: unknown): Record<string, number> {
  const parsed = storedRatingsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function parseRecommendation(value: unknown): Recommendation | null {
  return (RECOMMENDATIONS as readonly unknown[]).includes(value) ? (value as Recommendation) : null;
}

/**
 * Appends competencies that exist in a previously submitted scorecard but not in
 * the current list (e.g. the job profile changed after submission), so a
 * re-submission never silently drops a rating the evaluator already gave.
 */
export function withStoredCompetencies(
  items: ScorecardCompetency[],
  stored: Record<string, number>,
): ScorecardCompetency[] {
  const known = new Set(items.map((c) => c.key));
  const extra = Object.keys(stored)
    .filter((k) => !known.has(k))
    .map((k) => ({
      key: k,
      label: (DEFAULT_COMPETENCY_IDS as readonly string[]).includes(k) ? null : k,
      targetLevel: null,
    }));
  return [...items, ...extra];
}

export const scorecardSubmissionSchema = z.object({
  ratings: storedRatingsSchema,
  recommendation: z.enum(RECOMMENDATIONS),
  overallNotes: z.string().max(OVERALL_NOTES_MAX).optional(),
});

export type ScorecardSubmission = z.infer<typeof scorecardSubmissionSchema>;

export interface ScorecardDraft {
  ratings: Record<string, number>;
  recommendation: Recommendation | null;
  overallNotes: string;
}

/** Returns the submission payload, or null while the draft is incomplete/invalid. */
export function buildSubmission(
  competencies: ScorecardCompetency[],
  draft: ScorecardDraft,
): ScorecardSubmission | null {
  if (competencies.length === 0) return null;
  const ratings: Record<string, number> = {};
  for (const c of competencies) {
    const value = draft.ratings[c.key];
    if (value === undefined) return null;
    ratings[c.key] = value;
  }
  const notes = draft.overallNotes.trim();
  const parsed = scorecardSubmissionSchema.safeParse({
    ratings,
    recommendation: draft.recommendation,
    // Always send a string: an empty one is how an evaluator CLEARS saved notes. `undefined`
    // would be skipped by the upsert's update branch and silently keep the old text.
    overallNotes: notes,
  });
  return parsed.success ? parsed.data : null;
}

export function averageRating(ratings: Record<string, number>): number | null {
  const values = Object.values(ratings);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
