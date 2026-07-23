# Phase 5 Slice 11 — ENGAGEMENT READ surface → C# (strangler #9, dark)

**Status:** design + build · **Branch:** `feat/csharp-phase5-engagement-read`
**Flag:** `Platform:EngagementReadEnabled` (default `false`) · **Cutover:** deferred (Federico)
**Ledger:** `efcoreReadOnly` (reads over Prisma-owned tables; NO flip, NO new tables)

## Why this slice
NINTH strangler domain and GROUP 1 of the people-dashboards domain. The cleanest of the people-dashboard
reads: **NO native PG enums** (`surveys.type`/`.status`, `action_plans.status`, `leader_commitments.status`,
`alerts.module`/`.severity`/`.status` are all plain Prisma `String` — schema-confirmed), **NO FX**, and the
min-5 k-anonymity kernel (`KAnonymity.SuppressBelowMin5`, byte-identical to `access/aggregate.ts:19`) +
`OrgGate.RequireOrgScopeSatisfied` + `ReportingMath.JsRound` (JS half-up) are ALL already ported. Structurally
it resembles team-intel (k-anon reads) + compensation (all-or-nothing suppression) + nine-box (scopeWhereFor +
org-rollup gate + own-scoped reads).

DEI-minus-payequity = Slice 11b (native-enum datasource). `dei.getPayEquity` = Slice 11c (FX gateway).

## Source surface (spec = live TS `packages/api/src/routers/engagement.ts`, 911 lines, logic inline)
Port the 14 READS; do NOT port the 5 writes (`createSurvey`, `activateSurvey`, `submitSurveyResponse`,
`createActionPlan`, `updateActionPlan`).

| # | Read | Auth / mechanic | Notes |
|---|------|-----------------|-------|
| 1 | `listSurveys({status?,page,limit≤100})` | grant-only (perm) + k-anon (per-item `responseCount` floored) | paged `{items,total,page,limit}`; explicit select omits raw `responseCount` |
| 2 | `getSurveyResults({surveyId})` | `requireOrgScope` + k-anon (survey/question/skip all-or-nothing) | per-question summaries; answers-only minimal select |
| 3 | `myPendingSurveys` | grant-only, **OWN, NO org-gate** | active-window surveys the caller has NOT answered (anti-join on `userId`) |
| 4 | `getSurveyForResponse({surveyId})` | grant-only, **OWN, NO org-gate** | active-window renderable def (id/title/type/questions), else 404 |
| 5 | `getEnps({period,companyId?})` | `requireOrgScope` + k-anon (response/split/skip floors) | eNPS + promoter/passive/detractor split |
| 6 | `getClimateHeatmap({surveyId?})` | `requireOrgScope` + k-anon (survey/per-category/skip) | per-category scores |
| 7 | `getResultsByArea({surveyId,groupBy})` | `requireOrgScope` + k-anon (respondent/numeric-contributor/skip/unassigned) | per-area avg+count |
| 8 | `getWordCloud({surveyId})` | `requireOrgScope` | stub `{words:[]}` |
| 9 | `getSentiment({surveyId})` | `requireOrgScope` | stub `{positive,neutral,negative,highlights:[]}` |
| 10 | `getLowClimateAlerts({threshold?})` | `requireOrgScope` | `alerts` (module='engagement', status='active'), createdAt desc |
| 11 | `listActionPlans({status?})` | **`scopeWhereFor('actionPlan')`** row filter | + responsible user |
| 12 | `listLeaderCommitments({leaderId?,status?})` | **`scopeWhereFor('leaderCommitment')`** row filter | + leader user |
| 13 | `getDashboardKpis` | `requireOrgScope` + k-anon (org total + per-survey DIFFERENCING guard) | `{activeSurveys,totalResponses,totalResponsesSuppressed,actionPlansOpen,highRiskCount}` |
| 14 | `getRotationRisk({companyId?,businessUnitId?})` | `requireOrgScope` | mostly-stub `{summary:{high,medium,low,total},topRisk:[]}` (total = active user count) |

## Kernels (net-new + PARITY RISK — all inline in the TS router today)
Extracted to `packages/shared/src/engagement.ts` (HONEST fixtures: the TS router is refactored to CALL them —
#141 synthetic-fixture lesson, never a hand-rolled mirror), golden-fixtured against
`contracts/engagement-fixtures/*.json`, ported to `Tims.Domain.Engagement.EngagementKernels`:

- `computeEnps(scores, skipped, period)` — promoter (≥9) / detractor (≤6) / passive split + eNPS score
  (`round((p−d)/total*100)`, JS half-up) + response-floor + skip-floor + per-split floor (all-or-nothing).
- `summarizeSurveyResults(questions, responseAnswers)` — per-question contributor+skip floor, then a UNIFORM
  survey/question all-or-nothing suppression (empty `questionSummaries`, `totalResponses` nulled below the floor).
- `buildClimateHeatmap(questions, responseAnswers)` — per-category avg + survey-level floor + per-category
  contributor+skip all-or-nothing (nulled per-category scores when any category is sub-floor).
- `buildResultsByArea(rows{areaKey,values}, )` — per-area avg+respondent-count + respondent /
  numeric-contributor / skip / unassigned all-or-nothing (empty `results` when any fires).
- `buildEngagementKpis(activeSurveys, totalResponses, perSurveyCounts, actionPlansOpen)` — org total floor +
  **cross-endpoint per-survey DIFFERENCING guard** (any 1..4 per-survey count nulls the org total).

Rounding is JS `Math.round` half-up → `ReportingMath.JsRound` (`Floor(x+0.5)`), NOT banker's. The eNPS score can
be negative (detractors > promoters); `JsRound` is faithful JS `Math.round` (toward +∞) there too.

## Reuse (do NOT re-port)
- `KAnonymity.SuppressBelowMin5` + `OrgGate.RequireOrgScopeSatisfied` + `ReportingMath.JsRound` + `NodeIso*` +
  `ScopeWhereFor.BuildAsync` + `ScopePredicateSqlTranslator` + `IAnchorLoaderFactory` — all reused.
- `ScopeWhereFor(ActionPlan)` → `SubjectAsync("responsibleId")` and `ScopeWhereFor(LeaderCommitment)` →
  `SubjectAsync("leaderId")` ALREADY exist (`ScopeWhereFor.cs:148,150`; enum `ScopedEntity.cs:29,30`).

## DEVIATION from the intake brief: 2 NEW `ScopeProbeRegistry.Tables` registrations
The brief claimed `scopeWhereFor('actionPlan'|'leaderCommitment')` were "ALREADY registered in
ScopeProbeRegistry (Slice-6) — 0 new registrations." VERIFIED FALSE against `ScopeProbeRegistry.cs`: only the
`ScopedEntity` enum members + the `ScopeWhereFor` LOGIC exist. The `ScopeProbeRegistry.Tables` map (which drives
`ScopePredicateSqlTranslator.Column(table, field)`) has NO `action_plans`/`leader_commitments` entry, so the row
filter would throw `No probe registry entry for table 'action_plans'`. This slice adds the two missing probe
tables (`action_plans.responsibleId→responsible_id`, `leader_commitments.leaderId→leader_id`), mirroring how
Slice-8/9 registered `successors`/`salary_adjustments` as scopeWhereFor-only (row-filter, never a by-id probe
root → no `EntityRootTable` entry, no `SoftDeletable` entry). These are the FIRST live C# scopeWhereFor use of
those two entities — exercised + bitten by the integration corpus.

## New this slice
- `EngagementReadDbContext` (plain-string, NO `NpgsqlDataSource`/`MapEnum` — like reporting/team-intel/nine-box):
  maps `surveys`, `survey_responses`, `action_plans`, `leader_commitments`, `alerts` (+ `users` reused).
- Ledger `efcoreReadOnly += surveys, survey_responses, action_plans, leader_commitments, alerts`.
- `EngagementStaffGate` (`engagement:read`) → returns the resolved scope; each endpoint applies its own mechanic.
- INTERNAL reads = raw model / kernel shape, NO `schemaVersion`; input validation AFTER auth (tRPC parity).
- Field-authed? NO — these aggregate, they do not field-authorize rows (no `selectFor`), so no `FieldClassification`.

## Minimal-select improvement (documented, not strict parity)
`getSurveyResults` in TS uses `include:{ responses: { select: { answers: true } } }` — this slice ports it with
an answers-only minimal projection (never `userId`/other response columns), the same posture the TS comment
already documents (§21 minimal-select). Behaviorally identical; a defense-in-depth improvement, pinned by a test.

## Regression corpus (Testcontainers real RLS + goldens) — each bite-proven
- **min-5 floor** on EVERY group/bucket/skip/contributor.
- **empty-distribution NOT null-keyed** (present-key cardinality — empty `results`/`questionSummaries`/`data`).
- **cross-endpoint DIFFERENCING oracle** — `getDashboardKpis.totalResponses` ↔ per-survey recovery, and
  `getResultsByArea` per-area recovery (the highest-value k-anon bite).
- **minimal-select** — `getSurveyResults` never over-fetches response rows.
- **OWN-scoped reads** (`myPendingSurveys`/`getSurveyForResponse`) must NOT org-gate (identity-anchored).
- **input bounds** (page/limit ≤ 100).
- `scopeWhereFor('actionPlan'|'leaderCommitment')` row-drop; cross-org RLS isolation; dark-by-default 404 on all
  routes; auth matrix (grant→403 / JWT→401 / dark→404) with VALID staff slugs.

## Gate (SDD)
3 adversarial reviews (security/auth + correctness/parity + Codex) → fix in-branch bite-proven → PR → admin-merge.
Local gate: build 0-warn / format / unit / integration (Docker real RLS) / table-ownership; TS touched (kernels
+ router refactor) → `@tims/api` tsc + `apps/web` tsc + vitest.
