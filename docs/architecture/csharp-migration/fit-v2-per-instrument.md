# FIT v2: per-instrument assessment fit (C# only, flag-gated)

> Status: built and tested, **dark**. Nothing is enabled anywhere. Two migrations are unapplied (see Rollout notes).
> Flag: `Platform:FitEngineV2Enabled` (env `Platform__FitEngineV2Enabled`, terraform `feature_flags.fit_engine_v2`),
> default `false`. It is inert unless `Platform:FitEngineWriteEnabled` also maps the compute route.
> Code: `Tims.Domain/FitEngine/FitV2Kernels.cs` (rules), `FitV2Models.cs`,
> `Tims.Application/FitEngine/IAssessmentResultSource.cs` (port), `FitEngineWriteUseCase.cs` (switch),
> `Tims.Infrastructure/FitEngine/AtsAssessmentResultSource.cs` + `Tims.Application/FitEngine/ProviderFitResultSource.cs`
> (adapters).
> Golden cases: `contracts/fit-v2-fixtures/*.json` (hand-derived; there is no TS oracle).

## Why

FIT v1 reads ONE assessment number: the `normalized_score` of the most recently completed assignment of any
type for the candidate and vacancy (`GetLatestAssessmentScoreAsync`). With two instruments, whichever finished
last wins. v1 also takes `languages` from the CV self-report only.

## What a vacancy configures

`job_profiles.fit_requirements` (jsonb, no DDL) gains an optional array:

```json
{
  "minYearsExperience": 2,
  "requiredLanguages": ["English", "Spanish"],
  "assessments": [
    {
      "instrument": "lia",
      "use": "scored",
      "min": { "globalPercentile": 40 },
      "weight": 0.25,
      "reason": "análisis de datos"
    },
    { "instrument": "english", "use": "gate", "min": { "cefr": "B2" } },
    { "instrument": "native_quiz", "use": "scored", "min": { "score": 60 } },
    { "instrument": "personality", "use": "advisory" }
  ]
}
```

- `instrument`: `lia | english | itcia | personality | mi | pca | native_quiz`.
- `use`: `scored` (feeds the number), `gate` (met / not met / unknown, never a rejection), `advisory` (shown only).
  Absent → lia/itcia/native_quiz `scored`, english `gate`, personality/mi/pca `advisory`. Personality, MI and PCA
  are always coerced to `advisory`.
- `min`: `globalPercentile` 0..100 (lia), `cefr` A1..C2 (english), integer `level` 1..5 (itcia), `score` 0..100
  (native_quiz). Required for lia/english/itcia when scored or gated, and for a native_quiz gate.
- `weight`: relative, a JSON number in (0, 100], scored entries only. `reason`: 1..500 characters.
- The parse is lenient, like v1's `parseRequirements`: a bad entry is dropped, never a 500. The first valid entry
  per instrument wins. Only the first 32 entries are read.

**No `assessments` array → v1 runs unchanged**, even with the flag on. An empty array means "this vacancy uses no
instrument": the assessment dimension is null. A **non-empty array in which no entry survives** (a typo such as
`native-quiz`) is treated as no array: v1 runs, so a mistake never silently drops the assessment dimension. Not yet
reported anywhere: an array where only SOME entries are dropped, and a weight that is invalid (which forces the
equal split). Both are silent until a C#-owned writer validates the configuration on save.

## Rules

**LIA is a minimum threshold only (owner default D20, 2026-11-08).** Until TIMS confirms the LIA norms (norm
population, Working Memory ceiling, global-percentile formula; assessment-platform design §6.3), a SCORED LIA entry is
evaluated as a GATE on the same minimum (`FitV2Kernels.ApplyLiaThresholdPolicy`): met / not met / unknown, never a
number and never a rejection, its weight dropped so the other scored instruments split the assessment weight. The
stored configuration is unchanged and the requirements writer reports `lia_threshold_only`; turning on
`Platform:FitEngineLiaScoredEnabled` (default false) restores the curve below at the next compute.

| Instrument           | Fit (0–100)                                                                           | Gate              |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------- |
| lia                  | `min(100, round(p / min × 100))`, 100 when min ≤ 0 (the experience curve)             | p ≥ min           |
| english              | 100 at/above, else `round((achieved + 1) / 6 × 100)` on A1..C2 (the education ladder) | achieved ≥ min    |
| itcia                | 100 at/above, else `round(level / 5 × 100)`                                           | level ≥ min       |
| native_quiz          | the stored normalized score; the lia curve when `min.score` is set                    | score ≥ min.score |
| personality, mi, pca | never scored                                                                          | never a gate      |

`round` is v1's `JsRound` (half toward +∞).

- **Latest per instrument.** Results are grouped by instrument; the most recent (completedAt DESC, nulls last,
  then result id) is the one judged, even when it needs review.
- **Several native quizzes.** A native quiz result carries its quiz (`assessment_type_id`) as its variant. The
  `native_quiz` entry judges the most recent result of EACH quiz the candidate sat for the vacancy
  (`FitV2Kernels.CombineVariants`): if any of them needs review, the instrument needs review (never a mean of the rest);
  otherwise its value is the mean normalized score of those with one. Before this, a second quiz hid the first. The
  entry then lists every combined id in `resultIds` (most recent first; `resultId` is the most recent). The adapter
  reads only each quiz's latest result, picked in SQL (`DISTINCT ON` the quiz) before any bound, so many attempts of
  one quiz can never hide another quiz awaiting review; past 50 quizzes it fails closed (needs review).
- **Integrity.** A result that is voided, flagged or awaiting review shows as `needs_review`, its gate as
  `unknown`, and it is excluded from the `assessment` dimension: it is never read as a low instrument score. A
  valid result without the judged value (e.g. a partial LIA battery with no global percentile) shows as
  `no_value`.
- **Review pending (the overall number).** Excluding a scored result still moves the OVERALL score. The remaining
  dimensions are renormalized exactly as for a candidate with no result (so a flagged low result can raise the
  overall), and when nothing else is available the overall is v1's no-data value, `0` with `isPartial`. So when the
  latest result of any SCORED instrument needs review, the breakdown carries `reviewPending: true` and the row is
  stored with `isPartial: true`. Some web readers flag `isPartial`: the vacancy FIT ranking (its status column),
  and the pipeline kanban card, list view and table row (a `*`; the kanban card also keeps a partial score out of
  its >= 80 highlight). The candidate header and its high-fit banner mark a `reviewPending` score as provisional
  (from the stored breakdown, which `candidate.getById` already returns), and the candidate table and the
  talent-pool table mark it from the C# read `POST /fit-engine/scores/review-state` (their `candidate.list` query
  carries the fit score id but not the breakdown). The candidate page's breakdown and assessment panels still show
  the dimension numbers without the marker. A gate awaiting review moves no number and does not set
  `reviewPending`.
- **Gates never reject.** A gate entry contributes nothing to the `assessment` dimension. The one exception to
  "a gate moves no number" is English (owner default D23, 2026-11-09): an English gate decides English in the
  `languages` dimension exactly like a scored English entry (below), and additionally shows met / not met. A
  candidate whose gate is `not_met` is still scored and ranked; a person decides.
- **Weighting.** The `assessment` dimension is the weighted mean of the scored instruments that have a score,
  rounded with `JsRound`. The declared weights apply when every scored entry declares a valid one; otherwise all
  scored instruments weigh the same. A scored English entry is not part of this mean (owner default D3, below). Equivalently, instrument _i_ carries `profile.assessment × wᵢ / Σw` over the
  instruments with a score. When none has one, the dimension is null and the five-dimension renormalization drops
  it, exactly as v1 does for any missing dimension. `isPartial` keeps its v1 meaning and is also set by
  `reviewPending` (simulateWeights recomputes it from the five dimension keys, so it can report false there).
- **English counts once, in languages (owner default D3, 2026-11-08; owner default D23, 2026-11-09: whatever its
  role).** A SCORED or GATE english entry never enters the `assessment` mean. It decides whether "English" (also "Inglés"/"Ingles") counts as covered among
  `requiredLanguages`: covered iff achieved ≥ the entry's minimum, whatever the CV says; English is added to the
  required languages when the vacancy lists the test but not the language. Other languages still come from the CV.
  If the CV lists no languages and a non-English language is also required, the dimension stays null as in v1.
  Without a usable result (no result, no value, needs review) the CV self-report stands for English. The entry's
  `weight` and `assessmentShare` are null and its `effectiveWeight` is English's share of the `languages` weight
  (that weight divided by the number of required languages); a scored entry's `score` is the CEFR ladder fit, shown
  only. A GATE english entry does all of the above too (D23) and keeps its met / not met (the below-minimum flag); it
  has no `score`. An ADVISORY english entry has no minimum, so it decides nothing: the CV self-report stands.
- **Job-relatedness.** Results for instruments the vacancy does not list are ignored.

## Breakdown

The six v1 keys first, unchanged in meaning and order, then three new keys:

```json
{
  "assessment": 70,
  "interview": 80,
  "experience": 50,
  "education": null,
  "languages": 100,
  "llmJudgment": null,
  "fitVersion": 2,
  "reviewPending": false,
  "assessments": [
    {
      "instrument": "lia",
      "use": "scored",
      "status": "completed",
      "score": 100,
      "gate": null,
      "weight": 1,
      "assessmentShare": 0.25,
      "effectiveWeight": 0.125,
      "min": { "globalPercentile": 40 },
      "reason": "análisis de datos",
      "resultId": "…",
      "source": "provider",
      "contentVersion": "…",
      "normVersion": "…",
      "languagesEvidence": null
    }
  ]
}
```

`status` ∈ `completed | no_result | needs_review | no_value`; `gate` ∈ `met | not_met | unknown` (gate entries
only); `assessmentShare` and `effectiveWeight` (rounded to 4 dp, before the five-dimension renormalization) only
for scored entries with a score, except that a scored or gate English entry carries an `effectiveWeight` (its share
of `languages`) and no `assessmentShare`; `languagesEvidence` (english only) is `assessment` when a scored English result
decided English (a scored or gate entry, D23), `cv` when the CV stood (always so for an advisory English entry), null when English is not
in `requiredLanguages`. `reviewPending` (top level) is true when a scored instrument's latest result needs review;
see Rules.

Every v1 reader keeps working: `simulateWeights` reads the five dimension keys; the web panels read the same
five; the AI explainer (`packages/ai/src/agents/fit-explainer.ts`) now also explains the `assessments` entries.

**Visibility.** The breakdown is readable by every `fit_engine:read` holder, including `leader@team`, who holds no
`assessment:read`. So a scored or gate entry carries the derived fit, the gate state, the requirement, the result
id and source, and the content and norm version when the source has them, never the raw result (percentile, CEFR,
level) nor `assessment_results.model_version` (classified internal). An advisory entry (personality, MI, PCA)
carries its status and the vacancy's reason only: no result id, source or version.

**The derived fit is not opaque below the minimum, and `min` sits in the same entry.** The English ladder maps
A1..C1 to 17/33/50/67/83 and the ITC-IA ladder maps levels 1..4 to 20/40/60/80, both one-to-one, so a reader
recovers the exact CEFR level or ITC-IA level of every candidate below the minimum. The LIA curve inverts as
`p = score × min / 100`. At or above the minimum all three read 100. v1's `assessment` key already exposes a
normalized score to the same readers.

**Owner default D6 (2026-11-08): team leaders see only "below minimum".** The stored row keeps the derived fits (HR
and admins see the exact level). The C# reads redact on the way out for a reader below company scope (own, team,
unit; `FitV2Visibility`): a scored entry with a minimum whose fit is under 100 loses its `score` and gains
`belowMinimum: true`; the `assessment` dimension it feeds is dropped too, because it is a known-weight mean of
those fits; the ranking's overall is recomputed from the dimensions that remain (and the row marked partial), and
the list re-sorted, since the stored overall would invert as well; simulateWeights runs over the redacted
breakdown. English (D3) feeds only `languages`, which says covered or not, i.e. exactly "below minimum", so it
stays.

**D6 on every FIT read the web app makes (release slice "fit").** Under `NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP` the
vacancy ranking, its what-if and its Compute button use the C# routes, and the candidate page (header, breakdown and
assessment panels) reads `GET /fit-engine/candidates/{id}/fit-scores` (fit_engine:read, the vacancy scope probe per
row, #312 rows hidden, the same redaction). The TS reads stay callable until they are deleted, so they apply the same
rule: `@tims/ai` `fit-visibility.ts` is the TS twin of `FitV2Visibility` + the overall recompute, run on the same
golden file (`contracts/fit-v2-fixtures/visibility.json`) by both stacks, and minimal call-site guards in
`packages/api` apply it to `fitEngine.getRankingForVacancy` (re-sorted), `simulateWeights`, `explainFit` (the
explainer is told `belowMinimum` and never to guess a level) and `candidate.getById`'s `fitScores`; the stored weights
are read for the recompute and never returned. The list surfaces read no breakdown, and their stored overall inverts
too (with the visible dimensions and the weight profile), so the C# v2 compute also stores the overall a narrow reader
may see, `fit_scores.restricted_overall_score` (the D6-redacted breakdown's overall; NULL when the row hides nothing
and on every v1 row; kept by the v2 guard). For such a reader `candidate.list` (and its fit-range filter, so it cannot
probe the hidden overall), `pipeline.getBoard` and `candidate.getRisks` use it (Codex release round 2). **Still
exposed to a narrow reader:** the native quiz's own `normalizedScore`/percentile on the candidate page's assessment
panel (pre-existing, `candidate:read`), and a v2 row computed before this column existed (recompute it).

## Result sources (`IAssessmentResultSource`)

- `AtsAssessmentResultSource`: the existing ATS tables. Every row is `native_quiz`. Only assignments with a result
  row. Valid iff `status = 'completed'`, no proctoring session of severity `high`/`critical`, and
  `assessment_results.breakdown.pendingManual` empty or absent; anything else (e.g. `cancelled`) is needs review.
  - **Manual grading pending is needs review.** The TS submission completes the assignment and stores
    `normalized_score` over the auto-scored questions only, with the essay ids in `breakdown.pendingManual`; one
    correct choice plus an ungraded essay reads 100. v2 holds such a result as needs review (`reviewPending`)
    instead of counting it or meeting a gate with it. A `pendingManual` that is present but not an array fails
    closed. Found by Codex round 5. v1 still reads the auto-only score (unchanged, byte for byte). Nothing on main
    grades essays yet, so such a result stays needs review until an essay-grading pass empties the list. Explicit `organization_id` filter on all three tables plus TenantScope.
  Adds `proctoring_sessions` to `efcoreReadOnly[]` (SELECT only).
  - **The proctoring rule is inert today.** Nothing on main creates a `proctoring_sessions` row (the TS
    `assessment.flagProctoring` only updates an existing session and returns NOT_FOUND without one).
  - **"Cancelled with a result" no longer happens.** `assessment.cancel` now writes with the status predicate
    (`updateMany … status IN ('assigned','in_progress')`, CONFLICT on 0 rows), so a submission that commits between
    its check and its write wins. A pre-existing cancelled-with-result row still reads as needs review.
  - **The review-completion signal is `proctoring_sessions.review_status`** (migration 20261109100000_fit_v2_integrity,
    the same definition as the proctoring branch, CHECK `unreviewed | clear | concern | inconclusive`). `clear` (a
    person reviewed the session and found no concern) releases the result whatever the severity; `concern`,
    `inconclusive` or an unknown value always hold it; `unreviewed` holds it only at `high`/`critical`. The writer of
    the review is the proctoring branch's review UI; nothing on this release sets it yet.
- `ProviderFitResultSource` (release/assessments-fit-provider): an adapter over the AS-5 connector's
  `IProviderAssessmentResultSource`, whose `ProviderFitMapping` reads the stored typed results (`LiaResultV1`
  global percentile, `EnglishResultV1` CEFR, `ItciaResultV1` level; advisory instruments carry no value) and decides
  integrity: one current attempt per instrument, only a `valid` `selection` result sat at its assigned time
  multiplier is valid, anything voided, flagged or sat at another multiplier is needs review with no value. It is
  composed only with `Platform:AssessmentProvidersEnabled` on (its tables exist only after migration
  `20261107232524_assessment_providers`); with it off a provider instrument shows as `no_result`. See
  `assessment-provider-connector.md`, "FIT v2".
- No table is created.

## Rollout notes

- **Preconditions for enabling `FitEngineV2Enabled`:**
  1. **Done in this PR — a writer for `assessments[]` that does not get erased:** `PUT
     /fit-engine/vacancies/{id}/requirements` (C#, `vacancy:update` + the vacancy scope probe) merges the array in
     one `INSERT … ON CONFLICT` statement, normalizes what it stores by the parse rules above and reports every
     dropped or changed entry (a non-empty array with no valid entry is refused). Under
     `NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP` the requirements card saves through it, without an `assessments` key.
     **Done (release slice "atsux") — a web editor for the array itself:** `GET` and `PUT
     /fit-engine/vacancies/{id}/requirements/assessments` (same flags as the writer; `vacancy:read` / `vacancy:update` +
     the vacancy scope probe) read the array as FIT parses it with a version token (`md5` of the stored jsonb,
     computed by Postgres), and replace ONLY `assessments[]` (the card's keys are carried over in the same `UPDATE`),
     strictly (an entry the parser would drop, or one without a job-relatedness reason, refuses the whole write) and
     conditionally (a `FOR UPDATE` row lock and the version the editor read; a stale version or a lost concurrent
     insert is a 409 with the current array). The vacancy page's assessments card uses them: tests from the provider
     catalog, use, minimum, reason, the pinned version, and the D3/D20 notes.
  2. **Done — readers that mark `reviewPending`:** the candidate header and banner, the candidate table and the
     talent-pool table, and (release slice "fit") the candidate page's breakdown panel (the provisional badge and one
     line per instrument: needs review, below minimum, gate state, advisory, score) and assessment panel (each
     assignment a stored score holds as needs review); the ranking and the pipeline views flag `isPartial`.
  3. **Done for the three reads that show the breakdown — D6** (above): the web app reads ranking, what-if and the
     candidate page's fit scores from C# under the flag, and the TS reads apply the same rule while they exist.
     **Still open:** the stored overall on the TS list surfaces and the quiz's own score on the assessment panel
     (above).
  4. **Done — the review-completion signal** (`proctoring_sessions.review_status`), read by the ATS adapter; its
     writer ships with the proctoring branch.
  5. **Done — recompute on change, and the TS writers kept off v2 rows** (below). **Still open:** the DEI
     adverse-impact check (owner step before gates go live) and TIMS's confirmation of the LIA norms (until then LIA
     is a threshold gate, above).
  6. **Migrations to apply first** (unapplied): Prisma `20261109100000_fit_v2_integrity` (review column, the
     `fit_scores_keep_v2` trigger, the queue and its triggers) BEFORE the C# service runs with
     `FitEngineV2Enabled`, then `db/manual/20261109011531_fit_v2_provider_recompute.sql` (provider triggers; safe in
     either order).
- **Recompute on change (release slice "fit").** Database triggers enqueue a request in `fit_recompute_requests`
  (Prisma-owned) in the same transaction that changes an input a FIT v2 row depends on: `assessment_assignments.status`
  (a cancel, a completion), `assessment_results` (a submission, a grade), `proctoring_sessions` (a flag, a review) and,
  through EF migration 20261109011531_fit_v2_provider_recompute, a provider attempt's state or a stored provider result
  — for vacancies configured for FIT v2 only (their job profile has an `assessments` key). Each change bumps the
  request's sequence. `FitRecomputeHostedService` (registered only with `FitEngineWriteEnabled` AND `FitEngineV2Enabled`)
  drains it every 30 s: it claims due requests per organization (`FOR UPDATE SKIP LOCKED`, a lease doubling from 60 s),
  recomputes the stored row through `RecomputeExistingAsync` (the same consent guard, FIT v2 lock and in-lock read; the
  row's existence is checked under the lock, so a recompute never creates a row and waits for a first compute in
  flight), and deletes the request only at the sequence it claimed, so a change during the recompute is not lost. After
  8 failed claims a request rests until a new change re-arms it. Tenant isolation: the enqueue function is SECURITY
  DEFINER and executable by its owner only (app_tenant has neither EXECUTE nor INSERT on the queue); the five
  triggers are SECURITY DEFINER, cannot be called directly and pass only the written row's ids, and the function
  refuses an organization other than the session's tenant (Codex release round 1).
- **The TS requirements writers can no longer erase `assessments[]`** (Codex release round 3). The
  `job_profiles_keep_assessments` trigger (BEFORE UPDATE) keeps a stored array against any write that drops the key
  (`vacancy.updateFitRequirements`, `upsertJobProfile`, a stale tab, a direct call) unless the writer set
  `tims.fit_writer = fit_v2_aware`; the C# requirements writer does, and removes the array only on an explicit
  `assessments: null`. This replaces "one active writer per deploy" as the guarantee.
- **The TS writers can no longer overwrite a v2 row.** The `fit_scores_keep_v2` trigger (BEFORE UPDATE) keeps a v2
  row's score, breakdown, weights, partial flag and calculation time against any write that would replace it with a
  non-v2 breakdown, unless the writer set `tims.fit_writer = fit_v2_aware` for its transaction (only the C# engine
  does; its v1 compute is how a vacancy goes back to v1). A non-null `llmJudgment` (candidate.screenCandidate) is still
  merged in. The TS caller sees no error; `screenCandidate` returns its own v1 number to its caller, while the stored
  row stays v2.
- **Essays (owner default D5).** A quiz with an essay awaiting a grade is needs review. `GET
  /fit-engine/assignments/{id}/essays` and `POST …/essays/{questionId}/grade` (`assessment:read` /
  `assessment:update` + the assignment's vacancy scope; mapped with the v2 flag) let a recruiter grade it from the
  candidate's assessment results. A grade runs in one transaction that locks the result row: it writes the
  response's points, removes the essay from `pendingManual`, records the grader in `breakdown.manualGrades`, and
  recomputes `raw_score` / `normalized_score` as the TS `computeResult` does. Grading the LAST essay also writes the
  local norm (`percentile`, `band`, `norm_sample_size`) exactly as the TS submission does for a quiz without essays
  (`AssessmentNormBands`, the `computeNormBandFromCounts` arithmetic over the organization's other completed, fully
  graded results of the same quiz; no percentile below 5). The grade's result change enqueues the FIT recompute. A
  grade takes the #312 withdrawal's candidate lock and re-checks consent first (409 `consent_withdrawn`), and the
  pending-essays read shows nothing for a withdrawn candidate (Codex release round 3).
- The web app calls the C# compute under `NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP` (the vacancy ranking's Compute
  button). The TS writers stay live for the flag-off path and for `screenCandidate`; the trigger above keeps them
  off v2 rows.
- **Concurrent recomputes: the results are read inside the write.** The results carry the integrity state (a
  cancel, a proctoring flag, an essay awaiting a grade), so a v2 compute reads them, evaluates and upserts the row in
  ONE transaction that holds a per-(organization, candidate, vacancy) advisory lock, taken after the #312 consent
  lock and re-check. Two computes therefore never interleave a read and a write: in the race the Codex review found
  (A reads a clean result, a cancel lands, B writes `needs_review`, A overwrites it with the stale clean score), B
  now waits for A's commit and reads the cancel, or A waits for B's and reads it. If the read, the evaluation or the
  write fails or is cancelled, the transaction rolls back and the stored row is untouched, so a compute never
  leaves a row it could not stand behind. This replaces the earlier write-then-verify loop and its settling write
  (Codex rounds 4-6). What remains:
  - a change that commits after the last compute's in-lock read is picked up by the recompute queue (above);
  - only the results are read in the lock; the CV, interview and weight inputs keep v1's snapshot semantics;
  - the live TS writers (v1) take no lock, but cannot replace a v2 row (the `fit_scores_keep_v2` trigger).
- Turning the flag off affects the next compute only; stored v2 rows keep their extra keys, which every v1 reader
  ignores.
- Before gates are used on real vacancies: monitor pass and fit rates by group (DEI), and confirm the LIA norms
  (assessment-platform design §6.3) — until then use LIA as a minimum threshold, which is what the curve does.
