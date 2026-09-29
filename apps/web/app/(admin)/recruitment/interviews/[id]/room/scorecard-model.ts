import { z } from 'zod';

// ---------------------------------------------------------------------------
// Pure scorecard model for the interview room. Mirrors the input contract of
// the existing `interview.submitScorecard` procedure
// (packages/api/src/routers/interview/scorecards.ts):
//   ratings:        Record<string(max 80), number 1..5>
//   recommendation: strong_yes | yes | neutral | no | strong_no
//   overallNotes:   string max 2000 (optional)
// Kept React-free so the rules are unit-testable on their own.
// ---------------------------------------------------------------------------

export const RATING_KEY_MAX = 80;
export const OVERALL_NOTES_MAX = 2000;
export const MAX_COMPETENCIES = 20;

export const RECOMMENDATIONS = ['strong_yes', 'yes', 'neutral', 'no', 'strong_no'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** Used ONLY when the vacancy's job profile defines no competencies. */
export const DEFAULT_COMPETENCY_IDS = ['leadership', 'analytical', 'communication', 'problem_solving'] as const;
export type DefaultCompetencyId = (typeof DEFAULT_COMPETENCY_IDS)[number];

export interface ScorecardCompetency {
  /** The key persisted in `ratings`. */
  key: string;
  /** Display label (vacancy competency name), or null → label comes from i18n. */
  label: string | null;
  /** Target level from the job profile (1..5), when defined. */
  targetLevel: number | null;
}

export type CompetencySource = 'vacancy' | 'default';

export interface ResolvedCompetencies {
  source: CompetencySource;
  items: ScorecardCompetency[];
}

// Job profile competencies are written by vacancy.updateJobProfile as
// Array<{ name: string(max 100); level: int 1..5 }>, but the column is Json
// with a `{}` default — so anything else is treated as "none defined".
const jobProfileCompetencySchema = z.object({
  name: z.string().trim().min(1).max(100),
  level: z.number().int().min(1).max(5).optional(),
});

export function resolveCompetencies(jobProfileCompetencies: unknown): ResolvedCompetencies {
  const items: ScorecardCompetency[] = [];
  const seen = new Set<string>();
  if (Array.isArray(jobProfileCompetencies)) {
    for (const raw of jobProfileCompetencies.slice(0, MAX_COMPETENCIES)) {
      const parsed = jobProfileCompetencySchema.safeParse(raw);
      if (!parsed.success) continue;
      const key = parsed.data.name.slice(0, RATING_KEY_MAX);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, label: parsed.data.name, targetLevel: parsed.data.level ?? null });
    }
  }
  if (items.length > 0) return { source: 'vacancy', items };
  return {
    source: 'default',
    items: DEFAULT_COMPETENCY_IDS.map((id) => ({ key: id, label: null, targetLevel: null })),
  };
}

export const storedRatingsSchema = z.record(z.string().max(RATING_KEY_MAX), z.number().int().min(1).max(5));

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
