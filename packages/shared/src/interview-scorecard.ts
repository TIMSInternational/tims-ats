import { z } from 'zod';

// ---------------------------------------------------------------------------
// Interview scorecard competency set — ONE definition for both sides (PR #303).
//
// The interview room (apps/web .../room/scorecard-model.ts) derives which
// competencies an evaluator must rate, and interview.submitScorecard
// (packages/api) refuses a card that does not cover that same set. Before this
// module existed the completeness rule lived only in the client, so a blinded
// evaluator could submit `ratings: {}` straight to the API, become "submitted",
// and read every other evaluator's card.
// Pure: no DB, no I/O, no clock.
// ---------------------------------------------------------------------------

export const RATING_KEY_MAX = 80;
export const MAX_COMPETENCIES = 20;
/**
 * Upper bound on keys in a submitted `ratings` map. Room for the job profile's
 * MAX_COMPETENCIES plus the generic fallback plus keys carried over from a
 * previously stored card (withStoredCompetencies), with headroom.
 */
export const MAX_RATING_KEYS = 50;

/** Used ONLY when the vacancy's job profile defines no competencies (or cannot be read). */
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

/**
 * Server-side completeness rule for interview.submitScorecard: does `ratings` rate
 * every competency the room would have asked this evaluator to rate?
 *
 * The room resolves the set from the vacancy's job profile, or falls back to the
 * generic DEFAULT_COMPETENCY_IDS when the profile defines none OR the viewer could
 * not read it (vacancy.getJobProfile needs vacancy:read + vacancy scope, which a
 * panel evaluator may lack). The server cannot tell which of those the client hit,
 * so a card is complete when it covers the server-resolved set, or — only when that
 * set came from the vacancy — the generic fallback set. Either way it is a fully
 * rated card, never a placeholder. Extra keys (ratings carried over from an earlier
 * card after the profile changed) are allowed; the caller bounds the key count.
 */
export function ratingsCoverCompetencySet(ratings: Record<string, number>, jobProfileCompetencies: unknown): boolean {
  const covers = (keys: readonly string[]) => keys.every((k) => Object.prototype.hasOwnProperty.call(ratings, k));
  const resolved = resolveCompetencies(jobProfileCompetencies);
  if (covers(resolved.items.map((c) => c.key))) return true;
  return resolved.source === 'vacancy' && covers(DEFAULT_COMPETENCY_IDS);
}
