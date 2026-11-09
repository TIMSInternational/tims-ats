/**
 * Owner default D6 (2026-11-08): a reader below company scope (a team leader: own, team or unit scope) sees only
 * "below minimum" for an assessment instrument the candidate did not meet, never the exact level nor a number that
 * reveals it. HR and admins (company or organization scope) see the stored row.
 *
 * The TS twin of `Tims.Domain.FitEngine.FitV2Visibility` + the C# ranking's overall recompute, rule for rule, for the
 * TS reads that still serve FIT data (`fitEngine.getRankingForVacancy`, `fitEngine.simulateWeights`,
 * `fitEngine.explainFit` and the `fitScores` of `candidate.getById`) and for the FIT explainer's input. It lives in
 * `@tims/ai` because the explainer is its first consumer and packages/api takes no new logic (the survival rule).
 *
 * Why the derived numbers must go too: below the minimum the per-instrument fit is invertible (the English and ITC-IA
 * ladders are one-to-one there, the LIA curve inverts as p = score × min / 100), the `assessment` dimension is a
 * known-weight mean of those fits and the overall is a known-weight mean of the dimensions. So a redacted row drops the
 * entry's `score` (and sets `belowMinimum: true`), drops the `assessment` dimension when the entry feeds it (English
 * feeds only `languages`, which already says covered or not), and its overall is recomputed from the dimensions that
 * remain and marked partial. A v1 row is never touched.
 */

export const FIT_DIMENSION_KEYS = ['assessment', 'interview', 'experience', 'education', 'languages'] as const;

const WIDE_SCOPES: ReadonlySet<string> = new Set(['company', 'organization']);

/** True for a reader below company scope; an unknown scope fails closed (redacted). */
export function hidesBelowMinimum(scope: string | null | undefined): boolean {
  return !(typeof scope === 'string' && WIDE_SCOPES.has(scope));
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A scored entry with a minimum whose fit is under 100 (every v2 curve is 100 at or above the minimum).
function isScoredBelowMinimum(entry: JsonObject): boolean {
  return (
    entry.use === 'scored' &&
    isObject(entry.min) &&
    typeof entry.score === 'number' &&
    Number.isFinite(entry.score) &&
    entry.score < 100
  );
}

/**
 * The breakdown a narrow-scoped reader may see, and whether anything was hidden. Returns the input itself when
 * nothing is below a minimum (or the row is not FIT v2), else a redacted copy.
 */
export function redactFitBreakdownBelowMinimum(breakdown: unknown): { breakdown: unknown; redacted: boolean } {
  if (!isObject(breakdown) || breakdown.fitVersion !== 2 || !Array.isArray(breakdown.assessments)) {
    return { breakdown, redacted: false };
  }

  let hideAssessment = false;
  let any = false;
  const entries = breakdown.assessments.map((raw) => {
    if (!isObject(raw) || !isScoredBelowMinimum(raw)) return raw;
    any = true;
    if (raw.instrument !== 'english') hideAssessment = true;
    return { ...raw, score: null, belowMinimum: true };
  });
  if (!any) return { breakdown, redacted: false };

  const copy: JsonObject = { ...breakdown, assessments: entries };
  if (hideAssessment) copy.assessment = null;
  return { breakdown: copy, redacted: true };
}

/**
 * The overall score of a breakdown under a weight profile: the fit engine's weighted mean over the dimensions that
 * have a number, renormalized, rounded half up (`Math.round`, the C# `JsRound`); 0 and partial when none has one.
 * A non-number weight or dimension counts as absent, as in `FitEngineKernels.ParseWeights` / `ParseBreakdownScores`.
 */
export function weightedOverallScore(
  breakdown: unknown,
  weights: unknown,
): { overallScore: number; isPartial: boolean } {
  const scores = isObject(breakdown) ? breakdown : {};
  const w = isObject(weights) ? weights : {};
  let weightedSum = 0;
  let availableWeight = 0;
  let missingAny = false;
  for (const dim of FIT_DIMENSION_KEYS) {
    const raw = scores[dim];
    const weight = typeof w[dim] === 'number' ? (w[dim] as number) : 0;
    if (typeof raw !== 'number') {
      missingAny = true;
      continue;
    }
    weightedSum += raw * weight;
    availableWeight += weight;
  }
  if (availableWeight === 0) return { overallScore: 0, isPartial: true };
  return { overallScore: Math.round(weightedSum / availableWeight), isPartial: missingAny };
}

/**
 * One stored fit score as a narrow-scoped reader may see it: the row unchanged when nothing is below a minimum, else
 * the redacted breakdown, the overall recomputed from its `weights`, and `isPartial: true` (set only when the row
 * carries the key). `weights` is read, never added; the caller decides whether it is returned.
 */
export function redactFitScoreForNarrowReader<
  T extends { overallScore: number; breakdown: unknown; weights?: unknown },
>(row: T): T {
  const { breakdown, redacted } = redactFitBreakdownBelowMinimum(row.breakdown);
  if (!redacted) return row;
  const { overallScore } = weightedOverallScore(breakdown, row.weights);
  const shown = { ...row, breakdown, overallScore } as T & { isPartial?: boolean };
  if ('isPartial' in row) shown.isPartial = true;
  return shown;
}

/**
 * A stored fit score as returned to a reader: redacted for a narrow-scoped one (`hideBelowMinimum`), and always
 * without its `weights` (read only to recompute the overall, never part of the response).
 */
export function fitScoreAsShown<T extends { overallScore: number; breakdown: unknown; weights?: unknown }>(
  row: T,
  hideBelowMinimum: boolean,
): Omit<T, 'weights'> {
  const shown = hideBelowMinimum ? redactFitScoreForNarrowReader(row) : row;
  const { weights: _weights, ...rest } = shown;
  return rest;
}

/**
 * A stored fit score on a LIST surface (candidate list, pipeline board, risk factors), which reads no breakdown: for a
 * narrow-scoped reader the overall is the stored D6 overall (`restrictedOverallScore`, written by the C# FIT v2 compute
 * when the row hides something; null otherwise) and the row is partial (`isPartial`, when it has the key); anyone else
 * gets the stored overall. `restrictedOverallScore` itself is never returned.
 */
export function fitOverallAsShown<T extends { overallScore: number; restrictedOverallScore?: number | null }>(
  row: T,
  hideBelowMinimum: boolean,
): Omit<T, 'restrictedOverallScore'> {
  const { restrictedOverallScore, ...rest } = row;
  if (!hideBelowMinimum || typeof restrictedOverallScore !== 'number') return rest;
  return { ...rest, overallScore: restrictedOverallScore, ...('isPartial' in rest ? { isPartial: true } : {}) };
}

/**
 * The where-fragment of a fit-range filter on the stored overall. For a narrow-scoped reader it filters on the overall
 * that reader sees (the D6 overall where one is stored), so the filter cannot be used to probe the hidden one.
 */
export function fitOverallRangeWhere(range: { gte?: number; lte?: number }, hideBelowMinimum: boolean) {
  if (!hideBelowMinimum) return { overallScore: range };
  return {
    OR: [{ restrictedOverallScore: range }, { restrictedOverallScore: null, overallScore: range }],
  };
}
