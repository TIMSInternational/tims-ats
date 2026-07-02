# M4 pt.2 — Wire ErrorState into Silent-Failure Query Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 130 confirmed silent-failure query variables across 73 files under `apps/web/app`. Today, when
a `trpc.*.useQuery()` call fails, these pages/components render nothing, a false "empty" state, zeroed KPIs,
or (for two detail pages) an indistinguishable "not found" message — instead of telling the user the fetch
failed and offering a retry. The shared `apps/web/components/error-state.tsx` `ErrorState` component
(`{ onRetry?, message? }`, exported from the `components` barrel, renders a centered icon + `t.common.error`
message + optional retry button) was built for exactly this and is currently unused anywhere in `apps/web/app`.

**Verified scope:** two research passes over the full 73-file / 130-variable list (first: raw
`isError`-unread scan; second: traced every variable's downstream usage including one level into child
components) confirmed **all 130 are genuinely silent** — none already have equivalent inline error handling
this plan would be duplicating. Full per-file breakdown of what currently renders on failure is in the task
briefs below.

**Architecture:** No new components, no new i18n keys (`ErrorState` already sources `t.common.error` /
`t.common.retry` internally). This is a mechanical-but-judgment-requiring pattern application: for each
flagged query variable, render `<ErrorState onRetry={...} />` in place of the silently-broken output when
`query.isError` is true. The exact code shape varies by file (early-return page, inline ternary chain, child
component receiving props, lazy CSV-export query, ambiguous not-found page) — see Patterns below.

## Global Constraints

- **Import path:** `ErrorState` is exported from the `components` barrel (`apps/web/components/index.ts`).
  Match the exact relative import depth the file already uses for other barrel imports (e.g. `KpiCard`,
  `EmptyState`, `Modal`) — do not guess a fresh path.
- **No `any`, no inline `style={{}}`, no new hardcoded strings** (unchanged repo rules). `ErrorState` needs no
  `t.*` prop for the default case — only pass `message` if the file wants a non-generic message (rare; default
  to omitting it).
- **Pattern A — early-return page/component** (file currently does `if (query.isLoading) return <Skeleton />`
  before its main return): add `if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;`
  immediately after the loading early-return.
- **Pattern B — inline ternary chain** (file currently does
  `query.isLoading ? <Skeleton/> : query.data ? (<Content/>) : null` or similar, this exact 3-way shape is
  already a known code shape elsewhere in the repo — reuse it, don't invent a new shape): insert an `isError`
  branch between the loading and data checks:
  `query.isLoading ? <Skeleton/> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : query.data ? (<Content/>) : null`.
- **Pattern C — child component currently receives only `data`+`loading` props** (e.g. a `XxxKpis` /
  `XxxPanel` component rendering a fixed grid/section): add `isError: boolean` (and `onRetry?: () => void` if
  the component already threads callbacks similarly) to its props interface; thread
  `isError={query.isError}` (`onRetry={() => query.refetch()}` if added) from the parent; inside the child,
  add a branch rendering `<ErrorState onRetry={onRetry} />` in place of the section's content — placed after
  the existing loading check, before the data render, matching the existing shape in
  `apps/web/app/(admin)/talent/succession/succession-kpis.tsx` (which already does this, just with bespoke
  markup instead of the shared component — replacing bespoke markup with `ErrorState` is in scope only for the
  *flagged* variables, do not touch already-working `isError` branches on unflagged sibling variables in the
  same file).
- **Pattern D — lazy CSV-export query** (`trpc.*.useQuery(undefined, { enabled: false })` triggered via
  `.refetch()` inside a `handleExport`-style handler that currently only checks `if (result.data)`): add an
  `else` / early-return branch — `if (result.isError) { toast(t.common.error, { type: 'error' }); return; }`
  (or equivalent) — so export failures surface instead of silently no-opping. No `ErrorState` component
  needed here (it's a button action, not a rendered section); use the existing `toast()` pattern from
  `lib/toast.ts`.
- **Pattern E — ambiguous not-found page** (`invoice-detail.tsx`, `job-detail-view.tsx`'s `vacancy` query,
  `candidates/[id]/page.tsx`): the file currently renders the SAME "not found" message whether the query
  actually returned null/undefined OR the fetch itself failed. Add an explicit `if (query.isError) return
  <ErrorState onRetry={() => query.refetch()} />;` check BEFORE the existing not-found branch, so a real fetch
  error is no longer indistinguishable from a genuine 404.
- **Multiple independent queries feeding one page** (e.g. `kpis` + `candidates` on the same page, only one of
  which may be flagged): only touch the FLAGGED variable(s) listed in the task brief. If an unflagged sibling
  query on the same page already has working `isError` handling, leave it untouched. If two flagged variables
  feed genuinely separate page sections (e.g. a KPI strip and a table below it), give each its own `ErrorState`
  in its own section rather than tearing down the whole page for one section's failure — only collapse to a
  single page-level `ErrorState` when the flagged variables feed the SAME visual section (e.g. a KPI grid
  populated by one query with no independent siblings).
- **Do not modify files outside your task's list.** Do not "fix" unflagged variables you happen to notice —
  if you spot one, note it in your report as a concern, do not change it.
- **Per-task gate (must be green before commit):** `cd packages/db && npx prisma generate --schema=prisma/schema`
  (only if not already generated this session) → `pnpm --filter @tims/api exec tsc --noEmit` (repo root) →
  (in `apps/web`) `npx tsc --noEmit` → (repo root) `npx vitest run`. No new tests are required for this
  mechanical pattern application — do not create new test files. If a file already has a dedicated test file
  that directly exercises its error-state rendering, you may extend it, but this is optional.
- **Each task is one commit**, independently reviewable. Task order does not matter (files are fully
  disjoint across tasks — verify no overlap before committing).

---

## Task 1: Dashboard shell & panels (20 files)

Files + flagged variables (all Pattern A/B/C by file's existing shape — use judgment per the Global
Constraints patterns above):

1. `apps/web/app/(admin)/dashboard/activity-feed.tsx` — `activity`, `health` (currently: stale/empty lists render forever on error)
2. `apps/web/app/(admin)/dashboard/alerts-pending-panel.tsx` — `pendingAssessments`, `pendingScorecards` (shows "0 pending"/empty list on failure)
3. `apps/web/app/(admin)/dashboard/alerts-risk-panel.tsx` — `board` (empty risk-candidates list on failure)
4. `apps/web/app/(admin)/dashboard/alerts-sla-panel.tsx` — `slaQuery` (shows false "no SLA overdue" success state on failure)
5. `apps/web/app/(admin)/dashboard/attention-bar.tsx` — `data` (whole banner `return null`s on error — silent)
6. `apps/web/app/(admin)/dashboard/charts/ai-cost-anomaly-panel.tsx` — `data` (panel renders nothing)
7. `apps/web/app/(admin)/dashboard/charts/churn-risk-panel.tsx` — `data` (panel renders nothing)
8. `apps/web/app/(admin)/dashboard/charts/customer-health.tsx` — `data` (false "No customer data" empty state on real error)
9. `apps/web/app/(admin)/dashboard/charts/mrr-forecast-chart.tsx` — `data` (panel renders nothing)
10. `apps/web/app/(admin)/dashboard/charts/mrr-trend-chart.tsx` — `data` (chart silently renders empty array)
11. `apps/web/app/(admin)/dashboard/charts/plan-distribution.tsx` — `data` (false "No subscription data" on real error)
12. `apps/web/app/(admin)/dashboard/charts/revenue-by-customer.tsx` — `data` (false "No revenue data yet" on real error)
13. `apps/web/app/(admin)/dashboard/charts/upsell-panel.tsx` — `data` (panel renders nothing)
14. `apps/web/app/(admin)/dashboard/customer-table.tsx` — `data`, `healthData` (table renders empty rows)
15. `apps/web/app/(admin)/dashboard/kpi-strip.tsx` — `kpis`, `mrrTrend` (`kpis` failure = `return null`, silent)
16. `apps/web/app/(admin)/dashboard/pipeline-funnel.tsx` — `funnelQuery` (falls back to a fabricated proportional-estimate dataset on error, indistinguishable from real data — this is the highest-priority fix in this batch, it actively lies)
17. `apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx` — `vacancyKpis`, `candidateKpis`, `publishedVacancies` (stale/zeroed KPIs)
18. `apps/web/app/(admin)/impersonation-banner.tsx` — `data` (banner silently doesn't render)
19. `apps/web/app/(admin)/navbar/notification-dropdown.tsx` — `unreadData`, `notifData` (badge shows 0/empty list)
20. `apps/web/app/(admin)/navbar/search-command.tsx` — `searchResults` (search silently returns nothing)

- [ ] Task 1 complete

## Task 2: Recruitment core + Talent (14 files)

1. `apps/web/app/(admin)/recruitment/assessments/page.tsx` — `types`, `questions`
2. `apps/web/app/(admin)/recruitment/candidates/[id]/page.tsx` — `candidate`, `timeline` — **Pattern E applies to `candidate`** (check whether this page already distinguishes "not found" from "still loading"; if so, insert the isError check before that branch)
3. `apps/web/app/(admin)/recruitment/candidates/page.tsx` — `kpis`, `candidates`
4. `apps/web/app/(admin)/recruitment/interviews/page.tsx` — `interviews`, `aiScreenEnabled`
5. `apps/web/app/(admin)/recruitment/interviews/schedule-modal.tsx` — `candidates`, `vacancies`, `orgUsers` (Pattern C — raw query objects are passed to `schedule-modal.fields.tsx`, which reads `.isLoading`/`.data`; add `isError` there too)
6. `apps/web/app/(admin)/recruitment/offers/page.tsx` — `offers`
7. `apps/web/app/(admin)/recruitment/pipeline/page.tsx` — `vacancies`, `board` (stale/empty kanban board)
8. `apps/web/app/(admin)/recruitment/talent-pools/page.tsx` — `query` (Pattern C — `TalentPoolTable` currently only receives `isLoading`)
9. `apps/web/app/(admin)/recruitment/vacancies/[id]/page.tsx` — `vacancy`, `stats` — **Pattern E applies to `vacancy`** (passed to `GeneralInfo`/`SlaCard` as plain data today)
10. `apps/web/app/(admin)/recruitment/vacancies/page.tsx` — `kpis`, `vacancies`
11. `apps/web/app/(admin)/talent/nine-box/page.tsx` — `gridQ`, `kpisQ`, `sessionsQ`, `benchQ`, `successionQ`, `detailQ` (6 vars, all currently pass only `.data`/`.isLoading` throughout — grid/KPIs silently show zeros; use judgment on whether each gets its own section-level `ErrorState` per the Global Constraints multi-query rule, most of these look like independent grid sections)
12. `apps/web/app/(admin)/talent/succession/exit-simulator.tsx` — `sim` (currently stuck on a loading message forever on error, never resolves)
13. `apps/web/app/(admin)/talent/succession/page.tsx` — `roles` **ONLY** (siblings `kpis`/`coverage`/`flightRisk`/`noSuccessor` on this same page already have working `isError` handling via `SuccessionKpis`/`CompetencyCoverage`/`FlightRiskPanel`/`RolesWithoutSuccessor` — do not touch those, they are not flagged). `roles` is currently passed to `SuccessionPipeline`/`ExitSimulator`/`AddSuccessorModal` as plain data — Pattern C, and note `SuccessionKpis`'s existing bespoke-markup `isError` branch (`apps/web/app/(admin)/talent/succession/succession-kpis.tsx`) as the sibling reference shape you're extending to `roles`'s consumer(s), though you should use the shared `ErrorState` component rather than copying that bespoke markup.
14. `apps/web/app/(admin)/talent/team-intelligence/page.tsx` — `kpis`

- [ ] Task 2 complete

## Task 3: HR modules — Engagement, Learning, Monitoring, People, Compensation, Settings (11 files)

1. `apps/web/app/(admin)/engagement/climate/page.tsx` — `enps`, `kpis` (child `ClimateKpis` currently only receives `data`+`loading`)
2. `apps/web/app/(admin)/engagement/dei/dei-kpis.tsx` — `genders`, `pay`, `inclusion` (a sibling `kpis` var on this file already handles `isError` correctly — not flagged, leave it; these three fall back silently to `0`/`N/A`)
3. `apps/web/app/(admin)/learning/page.tsx` — `kpis`, `courses`, `paths`
4. `apps/web/app/(admin)/monitoring/alert-rules-modal.tsx` — `rulesQuery` (shows false "no rules configured" empty state on real fetch error)
5. `apps/web/app/(admin)/monitoring/page.tsx` — `kpis`
6. `apps/web/app/(admin)/people/onboarding/page.tsx` — `kpis`, `plans`
7. `apps/web/app/(admin)/people/performance/page.tsx` — `kpisQuery`, `okrsQuery`, `sessionsQuery`, `commitmentsQuery`, `feedbackQuery`, `recognitionsQuery` (6 vars, each passes only `.data ?? []`/`.isLoading` to its own child panel today — treat each as its own section per the multi-query Global Constraint)
8. `apps/web/app/(admin)/compensation/page.tsx` — `kpis`
9. `apps/web/app/(admin)/settings/billing/page.tsx` — `config`, `plan`, `usage` (silently shows trial/default plan labels and hides the usage section on error)
10. `apps/web/app/(admin)/settings/business-units/page.tsx` — `companies`, `units` (a sibling `members` query on this page already has working `isError` handling — not flagged, leave it)
11. `apps/web/app/(admin)/settings/integrations/page.tsx` — `kpis`

- [ ] Task 3 complete

## Task 4: Platform — AI agents, Analytics, Audit, Feature Flags, Health, Notifications, Support (11 files)

1. `apps/web/app/(admin)/platform/ai-agents/agent-detail-drawer.tsx` — `agentDetail`, `usage` (tabs currently render "no data"/loading-forever, no error branch)
2. `apps/web/app/(admin)/platform/ai-agents/ai-interview-org-controls.tsx` — `billingPreview` (currently falls back to a `"$0.00"`-style `?? null` chain — silent)
3. `apps/web/app/(admin)/platform/ai-agents/page.tsx` — `kpis`, `agents` (Pattern A/C) **and** `exportCsv` (Pattern D — `handleExport` currently only checks `if (result.data)`; add the isError/toast branch)
4. `apps/web/app/(admin)/platform/analytics/page.tsx` — `data` (whole page returns nothing/blank on error)
5. `apps/web/app/(admin)/platform/audit/page.tsx` — `orgs`, `data` (empty audit log table)
6. `apps/web/app/(admin)/platform/feature-flags/page.tsx` — `flagGroups` (empty flags list)
7. `apps/web/app/(admin)/platform/health/page.tsx` — `data` (services list/stats silently empty on error; the `refetch`/`dataUpdatedAt` fields already on this query object are for other purposes, just wire the isError check)
8. `apps/web/app/(admin)/platform/notifications/page.tsx` — `unreadData` (badge shows 0)
9. `apps/web/app/(admin)/platform/support/platform-owner-section.tsx` — `emailsData` (empty list)
10. `apps/web/app/(admin)/platform/support/quick-actions.tsx` — `orgs` (`orgs?.map(...)` — dropdown silently empty)
11. `apps/web/app/(admin)/platform/support/system-info.tsx` — `health`, `events` (stats/log silently empty, only truthy/isLoading checks today)

- [ ] Task 4 complete

## Task 5: Platform — Invitations, Invoices, Organizations, Subscriptions, Users + Careers portal (17 files)

1. `apps/web/app/(admin)/platform/invitations/invite-user-modal.tsx` — `orgs` (org search dropdown silently empty; note a sibling mutation `create.error` on this same file is already correctly handled — not flagged, leave it)
2. `apps/web/app/(admin)/platform/invitations/page.tsx` — `kpis`, `invitations` (Pattern A/C) **and** `exportCsv` (Pattern D)
3. `apps/web/app/(admin)/platform/invoices/billing-drawer.tsx` — `profile` (form stays blank on error)
4. `apps/web/app/(admin)/platform/invoices/invoice-detail.tsx` — `invoice` — **Pattern E** (currently shows the same "not found" message on any fetch error as on a genuine missing invoice)
5. `apps/web/app/(admin)/platform/invoices/invoice-wizard.tsx` — `orgs` (search dropdown silently empty), `preselectedOrgQuery` (pre-fill silently never happens), `previewQuery` (Pattern D-like — the "load AI charges" button currently does `if (!result.data) return;`, silent no-op on failure; add the toast branch), `nextNum` (invoice number shows literal `"INV-..."` placeholder forever on error)
6. `apps/web/app/(admin)/platform/invoices/page.tsx` — `kpis`, `invoices` (Pattern A/C) **and** `exportCsv` (Pattern D)
7. `apps/web/app/(admin)/platform/organizations/[id]/sections/activity-section.tsx` — `logs` (empty activity log)
8. `apps/web/app/(admin)/platform/organizations/[id]/sections/ai-section.tsx` — `configs` (empty config list)
9. `apps/web/app/(admin)/platform/organizations/[id]/sections/billing-section.tsx` — `profile`, `invoices` (sections silently render blank/empty)
10. `apps/web/app/(admin)/platform/organizations/[id]/sections/features-section.tsx` — `flagGroups` (empty flags list)
11. `apps/web/app/(admin)/platform/organizations/[id]/sections/users-section.tsx` — `data` (empty users table)
12. `apps/web/app/(admin)/platform/organizations/page.tsx` — `kpis`, `orgs` (zeroed KPIs, empty table)
13. `apps/web/app/(admin)/platform/subscriptions/page.tsx` — `kpis`, `mrrTrend`, `subs` (Pattern A/C) **and** `exportCsv` (Pattern D)
14. `apps/web/app/(admin)/platform/users/invite-wizard.tsx` — `orgs` (search dropdown silently empty)
15. `apps/web/app/(admin)/platform/users/page.tsx` — `kpis`, `orgs`, `data` (Pattern A/C) **and** `exportCsv` (Pattern D)
16. `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/job-detail-view.tsx` — `vacancy` **Pattern E** (currently shows "vacancy not found" indistinguishable from a real fetch error), `vacancies` (sidebar silently empty) — **note: this is the public, unauthenticated careers portal; the retry affordance and any copy must still read correctly for an anonymous external candidate, not assume staff context**
17. `apps/web/app/(portal)/careers/[orgSlug]/job-board.tsx` — `stats`, `vacancies` (hero stats/featured list silently empty; false "no vacancies available" shown even on a real fetch error) — **same public-portal note as above**

- [ ] Task 5 complete

---

## Final Steps

- [ ] Dispatch final whole-branch code reviewer (most capable model) — verify: no file outside the 73-file
  list touched, no unflagged variable touched, `ErrorState` import paths correct throughout, no regressions
  in existing tests, all 5 tasks' patterns applied consistently (spot-check 3-4 files per pattern type).
- [ ] Dispatch Codex (`codex:codex-rescue`) adversarial cross-model review per `.claude/rules/verification.md`
  — give it full visibility into the diff (not just a summary) to avoid "NOT FOUND" false positives.
- [ ] Full local gate: `prisma generate` → api tsc → web tsc → `npx vitest run` → `next build`.
- [ ] Ship as ONE PR (`fix/m4pt2-errorstate-wiring` → squash-merge → main) — this is one coherent bug
  (silent query failures across the app) fixed with one consistent pattern; splitting into multiple PRs would
  add process overhead without added review safety, since the diff is a repeated pattern-match.
