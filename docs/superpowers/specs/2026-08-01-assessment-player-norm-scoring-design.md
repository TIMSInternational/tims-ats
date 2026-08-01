# Assessment Player — Slice 5: Local Norm Scoring (design)

> Status: APPROVED (Federico, 2026-08-01). Extends Wave 1.5a (`docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`,
> slices 1-4 shipped). Closes the "no band/norm/item-bank scoring engine exists in TIMS" gap from
> `docs/REMAINING-WORK.md` Tier 3 — scoped to what's honestly buildable today, explicitly NOT the
> LIA-battery gap (Tier 5, external-blocked, out of scope here).

## Problem

`AssessmentResult` already has `percentile` and `interpretation` fields, but nothing populates
them — every candidate only ever sees a raw/normalized MCQ score with no comparative context.
Staff reviewing results have no sense of whether a 72% is strong or weak for that assessment type.

## Scope decision: dynamic/local norms, not static reference norms

Two things could be meant by "band/norm scoring":

1. **Dynamic/local norms** (this spec): percentile computed from the real distribution of scores
   other candidates got on the _same assessment type within the same org_. No external data,
   never fabricates numbers — this is what's in scope.
2. **Static published reference norms**: bands based on an externally-validated psychometric norm
   table (e.g. a real personality/aptitude battery's published distribution). This is the LIA gap
   in Tier 5 — blocked on an external party's data, explicitly called out in the roadmap as NOT
   AI-doable. Out of scope for this slice.

## Architecture

Reuse the existing `submitAssessment` write path in `candidate-portal.service` — no new
infrastructure, no background workers. After computing `rawScore`/`normalizedScore` as today (per
Wave 1.5a slice 2), if the result is **non-partial** (no essay questions pending — i.e. an
MCQ-only assessment, or an assessment whose essays have since been scored by a future Wave 3
agent), the same write transaction also computes a percentile + band against the org's other
non-partial completed results for that assessment type, and stores it.

**Why not compute live at read-time instead?** A candidate's percentile would then shift every
time someone views it, as more people take the assessment later — bad for an HR/compliance
artifact that feeds real hiring decisions. Snapshotting at submit time keeps a candidate's shown
result stable once computed, matching how `rawScore`/`normalizedScore` already behave.

**Why not a background job?** `workers/` (Trigger.dev) is an empty stub today (`docs/REMAINING-WORK.md`
Tier 4) — standing up real job infra just for this would be scope creep (YAGNI). The population
query is a single cheap aggregate (one numeric column, indexed columns in the WHERE clause);
computing it inline at submit time is simpler and sufficient.

## Data model (additive migration, idempotent SQL like prior migrations)

```prisma
enum ScoreBand {
  below_average
  average
  above_average
  excellent
}
```

- `AssessmentResult.band ScoreBand?` (new nullable column)
- `AssessmentResult.normSampleSize Int?` (new nullable column — how many _other_ completed
  non-partial results this candidate was compared against; lets the UI honestly distinguish "no
  band computed" from "band computed off a tiny sample")
- `AssessmentResult.percentile Float?` — already exists, currently always `null`; this slice is
  the first writer of it.

No changes to `AssessmentQuestion`, `AssessmentResponse`, `AssessmentAssignment`, or
`AssessmentType`.

## Computation logic

**Pure function** (TDD-first, no DB/network — mirrors the existing `scoreChoice`/`computeResult`
pattern from Wave 1.5a slice 2):

```ts
function computeNormBand(
  candidateScore: number,
  populationScores: number[], // other candidates' normalizedScore, same org + assessment type
): { percentile: number; band: ScoreBand } | null;
```

- Returns `null` if `populationScores.length < MIN_SAMPLE_SIZE` (5). Below this threshold, a
  percentile is statistically meaningless — matches the existing Tier-2 "honest data" precedent
  (real metric or honest N/D, never fabricated) rather than showing a number computed off 1-2
  data points.
- Percentile formula: `(countBelow + 0.5 * countEqual) / populationScores.length * 100` (standard
  midpoint percentile rank — ties don't arbitrarily favor either side).
- Band mapping (4-quartile): `[0, 25) → below_average`, `[25, 50) → average`,
  `[50, 75) → above_average`, `[75, 100] → excellent`.

**Repository method**: fetches only `normalizedScore` (explicit `select`, no other candidate
fields — rule #3 data-exposure) for other `AssessmentResult` rows with non-null `normalizedScore`,
same `organizationId` + `assessmentTypeId`, excluding the current `assignmentId`, where the
result is non-partial (`breakdown.pendingManual` is empty — no essay questions on that
assignment, or a future essay-scoring pass has already resolved them).

**Essay-containing assessments never get a band today.** Any assessment type with a free-text
question stays partial until Wave 3's `assessment-evaluator` agent (or manual staff scoring)
exists — this is an honest consequence of the existing partial/pending design, not a new gap
introduced here, and this spec makes no attempt to score essays.

## Backfill

A one-time idempotent script (`packages/db/prisma/scripts/backfill-assessment-norms.ts`,
following the existing `seed.ts` location convention) iterates every org → assessment type →
already-completed non-partial `AssessmentResult` rows with non-null `normalizedScore`, and
computes each one's band/percentile using every _other_ non-partial result in that same org+type
as of today (today's final population, not a point-in-time snapshot — this is a one-off catch-up,
not a re-run of history). Safe to re-run: recomputes and overwrites deterministically, no
duplicate side effects.

## Surfacing

- **Candidate result screen** (Wave 1.5a slice 3 Player UI): show band label (i18n es/en) +
  percentile next to the existing raw/normalized score, or an honest "not enough data yet" state
  when `normSampleSize` is below threshold — never blank/undefined.
- **Staff results / compare views** (existing `assessment.*` staff API — `results`, `compare`):
  same band + `normSampleSize`, so staff can judge how much confidence to place in the comparison.

## Testing

- Pure-function unit tests for `computeNormBand`: below-threshold → null, exact quartile
  boundaries, tie-handling, single-population-member edge case.
- Integration test extending the existing `submitAssessment` test suite: band/percentile populate
  correctly after N completions cross the threshold; essay-containing assessment never gets a
  band; org isolation (a candidate's band never reflects another org's population — same RLS
  pattern as every other tenant-scoped query in this codebase).
- Backfill script test: idempotent re-run produces identical output; correctly skips partial
  results.

## Out of scope (explicit, not deferred-forgotten)

- Static/published reference norms (LIA gap, Tier 5, external-blocked).
- Cross-org norm population (considered, rejected — per-org keeps this inside the existing RLS
  tenant-isolation model with zero new cross-tenant surface).
- Configurable per-assessment-type band thresholds/labels (fixed 4-quartile scheme for all types
  in this slice; a future slice could make this configurable if a real need shows up).
- Essay/free-text scoring (Wave 3 `assessment-evaluator` agent — separate, already-tracked item).
- Recomputing/reshuffling historical bands as the population grows after backfill (a candidate's
  band is a snapshot as of when it was computed, matching how score itself already behaves).
