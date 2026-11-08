# FIT v2: per-instrument assessment fit (C# only, flag-gated)

> Status: built and tested, **dark**. Nothing is enabled anywhere.
> Flag: `Platform:FitEngineV2Enabled` (env `Platform__FitEngineV2Enabled`, terraform `feature_flags.fit_engine_v2`),
> default `false`. It is inert unless `Platform:FitEngineWriteEnabled` also maps the compute route.
> Code: `Tims.Domain/FitEngine/FitV2Kernels.cs` (rules), `FitV2Models.cs`,
> `Tims.Application/FitEngine/IAssessmentResultSource.cs` (port), `FitEngineWriteUseCase.cs` (switch),
> `Tims.Infrastructure/FitEngine/AtsAssessmentResultSource.cs` + `ProviderAssessmentResultSource.cs` (adapters).
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
  its >= 80 highlight). Others show the bare number: the candidate header (whose high-fit banner does not check
  `isPartial`), the candidate table, the talent-pool table and the candidate page's breakdown and assessment
  panels. No reader holds these rows apart from the ranking; that is a precondition for enabling the flag (see
  Rollout). A gate awaiting review moves no number and does not set `reviewPending`.
- **Gates never reject.** A gate entry contributes nothing to any dimension, the `languages` dimension included.
  A candidate whose gate is `not_met` is still scored and ranked; a person decides.
- **Weighting.** The `assessment` dimension is the weighted mean of the scored instruments that have a score,
  rounded with `JsRound`. The declared weights apply when every scored entry declares a valid one; otherwise all
  scored instruments weigh the same. Equivalently, instrument _i_ carries `profile.assessment × wᵢ / Σw` over the
  instruments with a score. When none has one, the dimension is null and the five-dimension renormalization drops
  it, exactly as v1 does for any missing dimension. `isPartial` keeps its v1 meaning and is also set by
  `reviewPending` (simulateWeights recomputes it from the five dimension keys, so it can report false there).
- **English verifies languages (scored only).** A SCORED english entry with a valid CEFR result decides whether
  "English" (also "Inglés"/"Ingles") counts as covered among `requiredLanguages`: covered iff achieved ≥ the
  entry's minimum, whatever the CV says. Other languages still come from the CV. If the CV lists no languages and
  a non-English language is also required, the dimension stays null as in v1. A scored English result therefore
  moves two numbers (its ladder score in `assessment`, and English coverage in `languages`). **Open, needs owner
  sign-off with the DEI rollout checks:** a below-minimum result counts twice, and `effectiveWeight` reports only
  its `assessment` share, not its effect on `languages`, so neither HR nor the explainer sees the combined weight.
  The alternatives are one channel only, or a combined weight in the breakdown. A GATE english entry moves
  neither number: HR sees its met / not met next to the CV self-report.
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
for scored entries with a score; `languagesEvidence` (english only) is `assessment` when a scored English result
decided English, `cv` when the CV stood (always so for a gate or advisory English entry), null when English is not
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
normalized score to the same readers. **Owner decision needed before the flag is enabled:** accept this for
`leader@team`, or coarsen what the breakdown stores (e.g. met / below only).

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
  - **"Cancelled with a result" is rare but reachable.** The result row and `completed` are written in one
    submission transaction, and `assessment.cancel` (`packages/api/src/routers/assessment.ts`) first checks that
    the assignment is `assigned` or `in_progress`. But it then updates by id with no status predicate, so a
    submission that commits between the check and the update leaves a `cancelled` assignment that holds a result.
    v2 reads that as needs review, which is the intended outcome. The TOCTOU itself is a TS bug (the update
    should carry the status predicate); it is outside this PR (survival rule) and tracked as a follow-up.
  - **The severity a reviewer would clear never goes down.** `flagProctoring` only raises `severity` to the
    maximum seen. Once sessions exist, an attempt a person reviewed and cleared would stay `needs_review` for
    good. Before a session writer ships (the proctoring work adds `proctoring_sessions.review_status` and
    per-event severity), define the review-completion signal and read it here, so a cleared result counts again.
- `ProviderAssessmentResultSource`: a stub that returns nothing until the TIMS Assessments connector implements
  it against the tims-interop result schemas (`LiaResultV1`, …). Its doc comment holds the intended mapping.
- No table is created.

## Rollout notes

- **Preconditions for enabling `FitEngineV2Enabled`** (none is met by this PR):
  1. **A writer for `assessments[]` that does not get erased.** The only writer of `fit_requirements` is the TS
     `vacancy.jobProfile.updateFitRequirements` (`packages/api/src/routers/vacancy/job-profile.ts`), whose input
     schema has no `assessments` field and which replaces the whole jsonb on save. Saving the requirements card
     after a vacancy was configured therefore drops the array, and the next compute silently returns to v1. The
     survival rule forbids patching that router; a C#-owned writer (merge-on-update, plus the web form) must land
     first. It should also report dropped entries and invalid weights instead of the silent lenient parse.
  2. **Readers that hold `reviewPending` rows apart** (or show "needs review" rather than a number), the vacancy
     ranking first. Today they rank on a provisional number, flagged only where a reader shows `isPartial`.
  3. **The owner visibility decision** above, and the DEI / LIA-norm checks below.
  4. **A review-completion signal** read by the ATS adapter before any proctoring-session writer ships.
- The C# compute is not called by the web app yet (no FE wrapper for the fit-engine surface; see `cutover.sh`).
  The live TS writers (`fitEngine.computeForVacancy`, `candidateAiService.screenCandidate`) still write v1
  breakdowns, and a later TS recompute overwrites a v2 row with v1.
- **Concurrent recomputes: write, then verify.** Results are read before, and outside, the transaction that
  writes `fit_scores`. Two concurrent computes that straddle an integrity change could therefore end with the
  slower one's stale view: compute A reads a clean result, the result becomes needs review (HR flags it high, or a
  cancel lands on it through the TOCTOU above), compute B writes `needs_review`, then A overwrites it with
  `completed`, the counted score and `reviewPending: false`. Found by the Codex review of this branch; reachable
  today through the cancel TOCTOU. Each v2 compute now re-reads the candidate's results AFTER its write and, when
  they changed, evaluates and writes again (at most `MaxV2Writes` = 3 checked writes). When the results still
  differ after the third check, that write is not left standing: one more **settling write** evaluates the newest
  read with `reviewPending: true` (so `isPartial: true`) and is not re-checked. Whatever happens after it, the
  stored row never presents a just-shown-stale result as a clean, final score; the next compute clears the flag
  once the results are stable. (Codex round 5 found that the earlier "the third write stands" let a cancel seen by
  the last check be stored as counted, with `reviewPending: false`.) What remains:
  - a change after the last check is picked up by the next compute, as for every other input (v1 snapshot
    semantics);
  - under continuous churn the row is held as `reviewPending` until a compute sees stable results;
  - only the results are re-read; the CV, interview and weight inputs keep v1's last-writer-wins snapshot;
  - the live TS writers (v1) do not verify and can still overwrite a v2 row (see above);
  - **open (Codex round 6 [P1]):** a write whose check never completes leaves that write until the next compute,
    and it can be a stale clean score. That happens when the process dies, but also when the check's read throws
    or the request is cancelled or times out: the upsert has already committed and the check has no failure
    handling. The fix is to keep the row provisional until a check succeeds, or to make the integrity read and the
    write atomic. That is not done in this PR. It is a precondition for enabling the flag.
- Turning the flag off affects the next compute only; stored v2 rows keep their extra keys, which every v1 reader
  ignores.
- Before gates are used on real vacancies: monitor pass and fit rates by group (DEI), and confirm the LIA norms
  (assessment-platform design §6.3) — until then use LIA as a minimum threshold, which is what the curve does.
