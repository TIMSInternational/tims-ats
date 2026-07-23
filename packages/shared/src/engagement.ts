// Pure engagement shaping kernels (Phase-5 engagement strangler, Slice 11).
// Extracted from the inline logic of packages/api/src/routers/engagement.ts so BOTH the live TS router AND
// the C# port (Tims.Domain.Engagement.EngagementKernels) consume ONE definition, golden-fixtured against
// contracts/engagement-fixtures/. No DB, no I/O, no clock. Rounding uses JS Math.round (half-up) — mirror
// with ReportingMath.JsRound in C#. min-5 k-anon (suppressBelowMin5) is byte-identical to
// packages/api/src/access/aggregate.ts (kept private here so @tims/shared stays leaf-importable — shared
// must never depend on @tims/api).

const MIN_AGGREGATE_SIZE = 5;

/** k-anon floor — byte-identical to packages/api/src/access/aggregate.ts suppressBelowMin5:
 *  1..4 → suppressed (count null); 0 or ≥5 → not suppressed (an empty bucket reveals no one). */
function suppressBelowMin5(count: number): { suppressed: boolean; count: number | null } {
  if (count > 0 && count < MIN_AGGREGATE_SIZE) return { suppressed: true, count: null };
  return { suppressed: false, count };
}

// ── computeEnps (read #5) ──────────────────────────────────────────────────────

export interface EnpsResult {
  enps: number | null;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  totalResponses: number | null;
  suppressed: boolean;
  period: string;
}

/**
 * computeEnps: the eNPS score + promoter/passive/detractor split with the k-anon floors.
 * `responseAnswers` = each eNPS response's `answers` object (the router feeds them raw; the score is the
 * FIRST value — number as-is, else parseInt(base10) — matching the live router extraction). Suppression:
 *  - response floor: <5 valid scores OR a sub-floor SKIP bucket (fetched − valid) → whole result nulled.
 *  - per-split floor: with ≥1 valid score, any sub-floor promoter/passive/detractor split → whole result nulled
 *    (a visible split + the total would recover the hidden third via subtraction).
 */
export function computeEnps(responseAnswers: Array<Record<string, unknown>>, period: string): EnpsResult {
  const scores = responseAnswers
    .map((answers) => {
      const vals = Object.values(answers);
      return typeof vals[0] === 'number' ? (vals[0] as number) : parseInt(vals[0] as string, 10);
    })
    .filter((n: number) => !isNaN(n));

  // Contributor + skip floor: `scores` is the VALID-SCORE contributor set; the complementary skip bucket
  // (fetched responses − valid scores) is its own small group. Fold the skip bucket into the floor.
  const enpsSkipped = responseAnswers.length - scores.length;
  const responseSuppressed =
    suppressBelowMin5(scores.length).suppressed || suppressBelowMin5(enpsSkipped).suppressed;
  if (responseSuppressed) {
    return suppressedEnps(period);
  }

  const total = scores.length || 1;
  const promoters = scores.filter((s: number) => s >= 9).length;
  const detractors = scores.filter((s: number) => s <= 6).length;
  const passives = total - promoters - detractors;
  const enps = Math.round(((promoters - detractors) / total) * 100);

  // Per-split min-5: promoters/passives/detractors are a 3-way PARTITION. With total≥5 the response floor
  // passes, but a single split of 1..4 still leaks that head-count AND allows recovery of the hidden third.
  // Guard on scores.length > 0 so the `|| 1` sentinel (0 valid → passives = 1) never falsely suppresses.
  const splitSuppressed =
    scores.length > 0 &&
    [promoters, passives, detractors].some((n) => suppressBelowMin5(n).suppressed);
  if (splitSuppressed) {
    return suppressedEnps(period);
  }

  return {
    enps: enps as number | null,
    promoters: promoters as number | null,
    passives: passives as number | null,
    detractors: detractors as number | null,
    totalResponses: scores.length as number | null,
    suppressed: false,
    period,
  };
}

function suppressedEnps(period: string): EnpsResult {
  return {
    enps: null,
    promoters: null,
    passives: null,
    detractors: null,
    totalResponses: null,
    suppressed: true,
    period,
  };
}

// ── summarizeSurveyResults (read #2) ────────────────────────────────────────────

export interface QuestionSummary {
  question: unknown;
  type: unknown;
  average?: number | null;
  count: number | null;
  suppressed: boolean;
}

export interface SurveyResultsSummary {
  totalResponses: number | null;
  suppressed: boolean;
  questionSummaries: QuestionSummary[];
}

/**
 * summarizeSurveyResults: per-question summaries + the survey/question/skip all-or-nothing suppression.
 * A survey with 1..4 respondents is suppressed WHOLE (totalResponses nulled). Otherwise each question gets a
 * contributor + skip floor; when ANY question is sub-floor the WHOLE result collapses to an EMPTY
 * questionSummaries array (a per-question flag or count would distinguish/recover a sparse question).
 * (0 respondents passes through as an empty, non-suppressed result — reveals no individual.)
 */
export function summarizeSurveyResults(
  questions: Array<Record<string, unknown>>,
  responses: Array<{ answers: Record<string, unknown> | null }>,
): SurveyResultsSummary {
  const totalResponses = responses.length;

  const surveyLevel = suppressBelowMin5(totalResponses);
  if (surveyLevel.suppressed) {
    return { totalResponses: null, suppressed: true, questionSummaries: [] };
  }

  const rawSummaries: QuestionSummary[] = questions.map((q) => {
    const answers = responses.map((r) => r.answers?.[q.text as string]).filter(Boolean);

    if (q.type === 'scale') {
      const nums = answers.map(Number).filter((n: number) => !isNaN(n));
      const skipped = totalResponses - nums.length;
      const s = suppressBelowMin5(nums.length).suppressed || suppressBelowMin5(skipped).suppressed;
      if (s) {
        return { question: q.text, type: q.type, average: null, count: null, suppressed: true };
      }
      const avg = nums.length ? nums.reduce((a: number, b: number) => a + b, 0) / nums.length : 0;
      return { question: q.text, type: q.type, average: Math.round(avg * 100) / 100, count: nums.length, suppressed: false };
    }

    const skipped = totalResponses - answers.length;
    const s = suppressBelowMin5(answers.length).suppressed || suppressBelowMin5(skipped).suppressed;
    if (s) {
      return { question: q.text, type: q.type, count: null, suppressed: true };
    }
    return { question: q.text, type: q.type, count: answers.length, suppressed: false };
  });

  const anyQuestionSuppressed = rawSummaries.some((q) => q.suppressed);
  if (anyQuestionSuppressed) {
    return { totalResponses: totalResponses as number | null, suppressed: true, questionSummaries: [] };
  }

  return { totalResponses: totalResponses as number | null, suppressed: false, questionSummaries: rawSummaries };
}

// ── buildClimateHeatmap (read #6) ───────────────────────────────────────────────

export interface HeatCell {
  category: string;
  score: number | null;
}

export interface ClimateHeatmap {
  suppressed: boolean;
  data: HeatCell[];
}

/**
 * buildClimateHeatmap: per-category average scores with the survey-level floor + per-category
 * contributor/skip all-or-nothing suppression. When the survey has 1..4 respondents, OR any category's
 * distinct numeric-contributor set (or its complementary skip bucket) is 1..4, every category score is nulled
 * and suppressed:true. (0 respondents passes through as an empty, non-suppressed result.)
 */
export function buildClimateHeatmap(
  questions: Array<Record<string, unknown>>,
  responses: Array<{ answers: Record<string, unknown> | null }>,
): ClimateHeatmap {
  const surveyLevel = suppressBelowMin5(responses.length);
  if (surveyLevel.suppressed) {
    return { suppressed: true, data: [] };
  }

  const categories = [...new Set(questions.map((q) => q.category as string).filter(Boolean))];

  const perCategory = categories.map((cat: string) => {
    const catQuestions = questions.filter((q) => q.category === cat);
    let contributors = 0;
    const scores = responses.flatMap((r) => {
      const rowScores = catQuestions
        .map((q) => Number(r.answers?.[q.text as string]))
        .filter((n: number) => !isNaN(n));
      if (rowScores.length) contributors += 1;
      return rowScores;
    });
    return { cat, scores, contributors };
  });

  const anyCategorySuppressed = perCategory.some(
    (c) =>
      suppressBelowMin5(c.contributors).suppressed ||
      suppressBelowMin5(responses.length - c.contributors).suppressed,
  );
  if (anyCategorySuppressed) {
    return { suppressed: true, data: perCategory.map((c) => ({ category: c.cat, score: null })) };
  }

  const data: HeatCell[] = perCategory.map(({ cat, scores }) => {
    const avg = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;
    return { category: cat, score: Math.round(avg * 100) / 100 };
  });

  return { suppressed: false, data };
}

// ── buildResultsByArea (read #7) ────────────────────────────────────────────────

export interface AreaResultRow {
  answers: Record<string, unknown> | null;
  /** The area key (companyId | businessUnitId per groupBy), resolved from the response's user; null when the
   *  user has no company/business-unit (or the user was deleted) — the implicit unassigned/skipped bucket. */
  areaKey: string | null;
}

export interface AreaResult {
  groupId: string;
  average: number | null;
  responses: number | null;
  suppressed: boolean;
}

export interface ResultsByArea {
  results: AreaResult[];
  suppressed: boolean;
}

/**
 * buildResultsByArea: per-area (company/business-unit) average + respondent count with the min-5 floor and the
 * cross-endpoint differencing guard. When the survey total, ANY area's respondent count, its numeric-contributor
 * count (or the complementary skip bucket), OR the implicit unassigned/skipped bucket is 1..4, emit an EMPTY
 * results array (no per-area keys) + suppressed:true — so nothing is recoverable via cardinality or N−Σ.
 * (0 respondents passes through as [] — no individual.)
 */
export function buildResultsByArea(rows: AreaResultRow[]): ResultsByArea {
  const groups: Record<string, { scores: number[]; respondents: number; numericContributors: number }> = {};
  let skippedCount = 0;
  for (const r of rows) {
    if (!r.areaKey) {
      skippedCount += 1;
      continue;
    }
    if (!groups[r.areaKey]) groups[r.areaKey] = { scores: [], respondents: 0, numericContributors: 0 };
    groups[r.areaKey]!.respondents += 1;
    const vals = Object.values(r.answers ?? {})
      .map(Number)
      .filter((n: number) => !isNaN(n));
    if (vals.length) groups[r.areaKey]!.numericContributors += 1;
    groups[r.areaKey]!.scores.push(...vals);
  }

  const anyAreaSuppressed =
    Object.values(groups).some(
      (a) =>
        suppressBelowMin5(a.respondents).suppressed ||
        suppressBelowMin5(a.numericContributors).suppressed ||
        suppressBelowMin5(a.respondents - a.numericContributors).suppressed,
    ) || suppressBelowMin5(skippedCount).suppressed;

  if (suppressBelowMin5(rows.length).suppressed || anyAreaSuppressed) {
    return { results: [], suppressed: true };
  }

  const results: AreaResult[] = Object.entries(groups).map(([id, { scores, respondents }]) => ({
    groupId: id,
    average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0,
    responses: respondents as number | null,
    suppressed: false,
  }));

  return { results, suppressed: false };
}

// ── buildEngagementKpis (read #13) ──────────────────────────────────────────────

export interface EngagementKpis {
  activeSurveys: number;
  totalResponses: number | null;
  totalResponsesSuppressed: boolean;
  actionPlansOpen: number;
  highRiskCount: number;
}

/**
 * buildEngagementKpis: the org-rollup KPIs with the min-5 org-total floor + the cross-endpoint per-survey
 * DIFFERENCING guard. `perSurveyCounts` are the per-survey response counts; if ANY is sub-floor (1..4), the
 * org total is nulled too — otherwise a caller sums the visible (≥5) surveys and subtracts from the org total
 * to recover a single suppressed survey's 1..4 count. A 0-response survey reveals no individual (not suppressed).
 */
export function buildEngagementKpis(
  activeSurveys: number,
  totalResponses: number,
  perSurveyCounts: number[],
  actionPlansOpen: number,
): EngagementKpis {
  const anySurveySubFloor = perSurveyCounts.some((c) => suppressBelowMin5(c).suppressed);
  const totalResponsesSuppressed = suppressBelowMin5(totalResponses).suppressed || anySurveySubFloor;
  return {
    activeSurveys,
    totalResponses: totalResponsesSuppressed ? null : totalResponses,
    totalResponsesSuppressed,
    actionPlansOpen,
    highRiskCount: 0,
  };
}
