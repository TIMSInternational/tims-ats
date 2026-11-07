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
instrument": the assessment dimension is null.

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
  `unknown`, and it is excluded from the score. It is never read as a low score. A valid result without the
  judged value (e.g. a partial LIA battery with no global percentile) shows as `no_value`.
- **Gates never reject.** A gate entry contributes nothing to any dimension. A candidate whose gate is `not_met`
  is still scored and ranked; a person decides.
- **Weighting.** The `assessment` dimension is the weighted mean of the scored instruments that have a score,
  rounded with `JsRound`. The declared weights apply when every scored entry declares a valid one; otherwise all
  scored instruments weigh the same. Equivalently, instrument _i_ carries `profile.assessment × wᵢ / Σw` over the
  instruments with a score. When none has one, the dimension is null and the five-dimension renormalization drops
  it, exactly as v1 does for any missing dimension. `isPartial` keeps its v1 meaning.
- **English verifies languages.** A scored or gate english entry with a valid CEFR result decides whether
  "English" (also "Inglés"/"Ingles") counts as covered among `requiredLanguages`: covered iff achieved ≥ the
  entry's minimum, whatever the CV says. Other languages still come from the CV. If the CV lists no languages and
  a non-English language is also required, the dimension stays null as in v1.
- **Job-relatedness.** Results for instruments the vacancy does not list are ignored.

## Breakdown

The six v1 keys first, unchanged in meaning and order, then two new keys:

```json
{
  "assessment": 70,
  "interview": 80,
  "experience": 50,
  "education": null,
  "languages": 100,
  "llmJudgment": null,
  "fitVersion": 2,
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
for scored entries with a score; `languagesEvidence` (english only) is `assessment` when the test decided
English, `cv` when the CV stood, null when English is not in `requiredLanguages`.

Every v1 reader keeps working: `simulateWeights` reads the five dimension keys; the web panels read the same
five; the AI explainer (`packages/ai/src/agents/fit-explainer.ts`) now also explains the `assessments` entries.

**Visibility.** The breakdown is readable by every `fit_engine:read` holder, including `leader@team`, who holds no
`assessment:read`. So an entry carries the derived fit, the gate state, the requirement and the result id, never
the raw result (percentile, CEFR, level) nor `assessment_results.model_version` (classified internal). Advisory
entries carry status only. Note that a below-minimum fit score can be inverted to the raw value
(`p = score × min / 100`); v1's `assessment` key already exposes a normalized score to the same readers.

## Result sources (`IAssessmentResultSource`)

- `AtsAssessmentResultSource`: the existing ATS tables. Every row is `native_quiz`. Only assignments with a result
  row. Valid iff `status = 'completed'` and no proctoring session of severity `high`/`critical`; anything else
  (e.g. `cancelled`) is needs review. Explicit `organization_id` filter on all three tables plus TenantScope.
  Adds `proctoring_sessions` to `efcoreReadOnly[]` (SELECT only).
- `ProviderAssessmentResultSource`: a stub that returns nothing until the TIMS Assessments connector implements
  it against the tims-interop result schemas (`LiaResultV1`, …). Its doc comment holds the intended mapping.
- No table is created.

## Rollout notes

- The C# compute is not called by the web app yet (no FE wrapper for the fit-engine surface; see `cutover.sh`).
  The live TS writers (`fitEngine.computeForVacancy`, `candidateAiService.screenCandidate`) still write v1
  breakdowns, and a later TS recompute overwrites a v2 row with v1.
- Turning the flag off affects the next compute only; stored v2 rows keep their extra keys, which every v1 reader
  ignores.
- Before gates are used on real vacancies: monitor pass and fit rates by group (DEI), and confirm the LIA norms
  (assessment-platform design §6.3) — until then use LIA as a minimum threshold, which is what the curve does.
