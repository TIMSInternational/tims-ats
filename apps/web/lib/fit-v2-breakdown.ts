// FIT v2: the per-instrument entries of a stored breakdown (`assessments`, written by the C# compute), narrowed from the
// untyped jsonb for the candidate page. A v1 breakdown, or anything malformed, has no entries. Never trusted for more
// than display: an entry with an unknown instrument, use or status is dropped.

export const FIT_INSTRUMENTS = ['lia', 'english', 'itcia', 'personality', 'mi', 'pca', 'native_quiz'] as const;
export type FitInstrument = (typeof FIT_INSTRUMENTS)[number];

export interface FitV2Entry {
  instrument: FitInstrument;
  use: 'scored' | 'gate' | 'advisory';
  status: 'completed' | 'no_result' | 'needs_review' | 'no_value';
  score: number | null;
  gate: 'met' | 'not_met' | 'unknown' | null;
  /** Owner default D6: this reader sees only that the minimum was not reached. */
  belowMinimum: boolean;
  source: string | null;
  /** The results the entry judged (several native quizzes), else its one result id. */
  resultIds: string[];
}

const USES = new Set(['scored', 'gate', 'advisory']);
const STATUSES = new Set(['completed', 'no_result', 'needs_review', 'no_value']);
const GATES = new Set(['met', 'not_met', 'unknown']);
const MAX_ENTRIES = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 64) : [];
}

export function fitV2Entries(breakdown: unknown): FitV2Entry[] {
  if (!isRecord(breakdown) || breakdown.fitVersion !== 2 || !Array.isArray(breakdown.assessments)) return [];
  const entries: FitV2Entry[] = [];
  for (const raw of breakdown.assessments.slice(0, MAX_ENTRIES)) {
    if (!isRecord(raw)) continue;
    const { instrument, use, status } = raw;
    if (typeof instrument !== 'string' || !(FIT_INSTRUMENTS as readonly string[]).includes(instrument)) continue;
    if (typeof use !== 'string' || !USES.has(use) || typeof status !== 'string' || !STATUSES.has(status)) continue;
    const resultIds = strings(raw.resultIds);
    entries.push({
      instrument: instrument as FitInstrument,
      use: use as FitV2Entry['use'],
      status: status as FitV2Entry['status'],
      score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : null,
      gate: typeof raw.gate === 'string' && GATES.has(raw.gate) ? (raw.gate as FitV2Entry['gate']) : null,
      belowMinimum: raw.belowMinimum === true,
      source: typeof raw.source === 'string' ? raw.source : null,
      resultIds: resultIds.length > 0 ? resultIds : typeof raw.resultId === 'string' ? [raw.resultId] : [],
    });
  }
  return entries;
}

/**
 * The ATS assignments some stored FIT v2 score holds as "needs review" (a cancelled assignment, a flagged proctoring
 * session, an essay awaiting a grade): the assessment panel marks them, so their numbers are not read as final.
 */
export function assignmentsAwaitingReview(fitScores: ReadonlyArray<{ breakdown: unknown }>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const fit of fitScores) {
    for (const entry of fitV2Entries(fit.breakdown)) {
      if (entry.source === 'ats' && entry.status === 'needs_review') entry.resultIds.forEach((id) => ids.add(id));
    }
  }
  return ids;
}
