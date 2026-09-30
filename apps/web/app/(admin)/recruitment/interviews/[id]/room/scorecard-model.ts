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
  const seenNames = new Set<string>();
  const usedKeys = new Set<string>();
  if (Array.isArray(jobProfileCompetencies)) {
    for (const raw of jobProfileCompetencies.slice(0, MAX_COMPETENCIES)) {
      const parsed = jobProfileCompetencySchema.safeParse(raw);
      if (!parsed.success) continue;
      // Dedupe on the FULL name: two profile names (max 100) can share their first
      // RATING_KEY_MAX (80) characters and are still different competencies.
      if (seenNames.has(parsed.data.name)) continue;
      seenNames.add(parsed.data.name);
      const key = ratingKeyFor(parsed.data.name);
      // Only reachable on a 32-bit hash collision between two >80-char names that also
      // share their first 70 characters; keep the first rather than merge two ratings.
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      items.push({ key, label: parsed.data.name, targetLevel: parsed.data.level ?? null });
    }
  }
  if (items.length > 0) return { source: 'vacancy', items };
  return {
    source: 'default',
    items: DEFAULT_COMPETENCY_IDS.map((id) => ({ key: id, label: null, targetLevel: null })),
  };
}

/**
 * A persisted rating key, derived from the competency's FULL name alone — never from
 * its position in the list — so reordering the job profile's competencies can never
 * re-attach a saved rating to a different competency (codex r3 P2).
 *
 * - Names that fit RATING_KEY_MAX (80) are their own key (unchanged from before, so
 *   every short-name and default-competency key already stored still matches).
 * - Longer names become a truncation plus a hash of the full name, so two long names
 *   sharing their first 80 characters still get distinct, stable keys.
 *
 * Compatibility: an earlier, never-merged revision of this PR keyed long names by
 * list position ("<truncation> #2"). Any such stored key no longer matches a live
 * competency, and withStoredCompetencies() surfaces it as its own row instead of
 * dropping it. No main-branch data uses long-name keys: the room never submitted
 * before this PR.
 */
export function ratingKeyFor(name: string): string {
  if (name.length <= RATING_KEY_MAX) return name;
  const suffix = ` #${fnv1a32Hex(name)}`;
  return name.slice(0, RATING_KEY_MAX - suffix.length) + suffix;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex chars. Deterministic; not a security hash. */
function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

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
