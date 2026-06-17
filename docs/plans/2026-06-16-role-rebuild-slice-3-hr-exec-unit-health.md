# Role Rebuild — Slice 3 (HR-Exec: hr_admin + hrbp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two admin-shell HR roles purpose-built landings: **`hr_admin` → HR Executive Dashboard** (org-wide people-first: headcount, open reqs, OKR cycle, engagement pulse, **compensation**, **DEI** — all org-rollup KPIs it is allowed to call) on a **people-first** nav IA; and **`hrbp` → Unit Health Dashboard ("Mis Unidades")** (unit-scoped recruiting + people health counts) on a unit-scoped nav without org-admin chrome. Both replace the placeholder where hr_admin/hrbp currently fall through to the RecruiterDashboard.

**Architecture:** Extends the Slice 1a manifest engine (two new bespoke role manifests) and the Slice 1b/2 dashboard pattern (two new landing components routed via the pure `pickPrimaryDashboard`, behind a `never`-guarded `DashboardKey` union). **hr_admin is organization-scoped** → it may call every `requireOrgScope` aggregate (so the HR-Exec dashboard reuses OrgCommandCenter's three extracted panels + adds comp/DEI KPIs, and **must apply `suppressedValue` for k-anonymity** on eNPS/payroll/responses). **hrbp is unit-scoped** → exactly like leader was team-scoped: every `*.getDashboardKpis` org-rollup throws FORBIDDEN, so its dashboard uses ONLY the scope-aware list endpoints (which `scopeWhereFor` auto-narrows to the hrbp's assigned business units), surfacing operational counts (no sensitive aggregates → no suppression).

**Tech Stack:** Next.js 15 (client components), React, tRPC, TypeScript (strict, no `any`/casts), Vitest. Tests at repo-root `tests/`.

**Source of truth:** `docs/ROLE-EXPERIENCE-REBUILD-SPEC.md` §3 (hr_admin people-first IA + HR-exec dashboard; hrbp "Mis Unidades" unit-health) and §2 (grants — already seeded in Slice 0, **no grant change in this slice**). Slices 0/1a/1b/2 live in prod.

---

## Scoping decisions (derived from the locked spec + verified scope map)

| Decision | Resolution |
|---|---|
| hr_admin scope | **organization** (seed-access-matrix.ts: every hr_admin grant `scope:'organization'`). All `requireOrgScope` aggregates SUCCEED → HR-Exec dashboard is rich (org rollups + comp + DEI). |
| hrbp scope | **unit** (every hrbp grant `scope:'unit'`). `requireOrgScope` **rejects** unit scope (org-gate.ts) → every aggregate `*.getDashboardKpis` is FORBIDDEN. Only scope-aware list endpoints (auto-narrowed by `scopeWhereFor` to the hrbp's `UserBusinessUnit` rows) may be called. |
| hrbp to-do panels (offers/scorecards) | **Omitted.** `offer.getPending`/`interview.getPendingScorecards` filter to rows where the caller is the approver/evaluator; an hrbp is neither (D1: hrbp offer is **read-only**), so they'd render empty and falsely imply approval authority. The hrbp dashboard is unit **oversight/health**, not a personal action queue. |
| k-anonymity suppression | **hr_admin dashboard REQUIRES it** (surfaces eNPS, payroll, survey responses — all min-5-suppressed at the API). **hrbp dashboard does NOT** (operational counts only: vacancies, candidates, OKR/action-plan counts). |
| Grants | **No change.** Slice 0 already seeded hr_admin (aligned) + hrbp (manage@unit + monitoring:read@unit). Frontend-only slice → pure Vercel code deploy, NO migration/re-seed. |
| committee/employee | **Unchanged** (Slice 4 territory). Only hr_admin + hrbp change. |

---

## Endpoint availability (verified against the access kernel)

**hr_admin (organization scope) — ALL of these SUCCEED (used by the HR-Exec dashboard):**

| Use | Procedure | Return fields that matter |
|---|---|---|
| Headcount / open reqs / surveys / alerts | `monitoring.getExecutiveKpis` | `{ totalEmployees, activeVacancies, activeSurveys, openAlerts, pendingAdjustments, pendingAdjustmentsSuppressed }` |
| OKR cycle / coaching | `performance.getDashboardKpis` | `{ activeOkrs, averageOkrProgress, scheduledSessions, completedSessions, commitmentCompletionRate }` |
| Engagement pulse (eNPS) | `engagement.getEnps` | `{ enps, suppressed, ... }` (null-when-suppressed) |
| Culture pulse | `engagement.getDashboardKpis` | `{ activeSurveys, totalResponses, totalResponsesSuppressed, actionPlansOpen, highRiskCount }` |
| Recruiting funnel | `recruitmentAnalytics.getFunnel` | `{ stages:[{name,count,pctOfMax}], totalApplications, totalHired, conversionPct }` |
| Compensation | `compensation.getDashboardKpis` | `{ totalMonthlyPayroll, avgSalary, compensatedEmployees, compensatedSuppressed, activeEmployees, pendingAdjustments, pendingAdjustmentsSuppressed, benefitsUtilizationPct, avgCompaRatio }` |
| DEI | `dei.getDashboardKpis` | **shape read-at-implementation** (see Task 2 Step 2) — demographic aggregates; surface ONE safe headline + suppress any min-5-flagged field |

**hrbp (unit scope) — the ONLY procedures it may call (auto-narrowed to its units; used by the Unit Health dashboard):**

| Use | Procedure | Return |
|---|---|---|
| Unit recruiting KPIs | `vacancy.getDashboardKpis` | `{ totalOpen, totalPendingApproval, totalApplications, totalPublished, recentVacancies:[{id,title,status,createdAt,_count:{applications}}] }` |
| Unit candidate KPIs | `candidate.getDashboardKpis` | `{ total, newThisMonth, activeApplications, byPool }` |
| Unit OKRs | `performance.listOkrs` | `{ okrs:[{id,title,status,progress,user,...}], nextCursor? }` — input `{ limit?:1..100, status?, ... }` |
| Unit action plans | `engagement.listActionPlans` | `[{ id, title, status, responsible, dueDate, ... }]` — input `{ status? }` optional |
| Unit leader commitments | `engagement.listLeaderCommitments` | `[{ id, leader, status, dueDate, ... }]` — input `{ status?, leaderId? }` optional |

**🔴 FORBIDDEN for hrbp (every `requireOrgScope` aggregate — do NOT call from the hrbp dashboard):** `performance.getDashboardKpis`, `engagement.getDashboardKpis`/`getEnps`/`getRotationRisk`, `compensation.getDashboardKpis`, `ninebox/succession.getDashboardKpis`, `dei.*`, `recruitmentAnalytics.*`, `monitoring.getExecutiveKpis`, `learning/onboarding.getDashboardKpis`. (These all power the hr_admin dashboard, which IS org-scoped — they are NOT reusable for hrbp.)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/web/lib/nav/manifest.ts` | nav manifests | Add `HR_ADMIN_SETTINGS` (reduced) + `HR_ADMIN_PEOPLE_FIRST` ordering + `HRBP_UNITS` sections; set `MANIFESTS.hr_admin` + `MANIFESTS.hrbp` |
| `apps/web/app/(admin)/dashboard/hr-exec-dashboard.tsx` | **NEW.** HR Executive Dashboard | Create (decompose a comp/DEI strip into a sibling if >300 lines) |
| `apps/web/app/(admin)/dashboard/unit-health-dashboard.tsx` | **NEW.** hrbp Unit Health Dashboard | Create |
| `apps/web/app/(admin)/dashboard/pick-dashboard.ts` | role→dashboard routing | Add `'hrExec'` + `'unit'`; route `hr_admin→'hrExec'`, `hrbp→'unit'`, recruiter unchanged |
| `apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx` | dashboard switch | Add `case 'hrExec'` + `case 'unit'` |
| `apps/web/lib/i18n/es.json` + `en.json` | i18n | Add `hrExecDashboard` + `unitHealthDashboard` blocks (+ any new `sidebar.*` keys if a section needs one) |
| `tests/nav/manifest.test.ts` | manifest tests | Add hr_admin (people-first) + hrbp (unit, no settings) assertions |
| `tests/dashboard/pick-dashboard.test.ts` | routing tests | hr_admin→hrExec, hrbp→unit, recruiter→recruiter, collisions |

---

## Task 1: hr_admin (people-first) + hrbp (unit) nav manifests

**Files:** Modify `apps/web/lib/nav/manifest.ts`; Modify `es.json` + `en.json` (only if a new label key is introduced); Test `tests/nav/manifest.test.ts`.

**Context:** `manifest.ts` already defines section building-blocks `COMMAND_CENTER`, `RECRUITMENT`, `PEOPLE`, `TALENT`, `CULTURE`, `SETTINGS`, plus `BASE_ADMIN = [COMMAND_CENTER, RECRUITMENT, PEOPLE, TALENT, CULTURE, SETTINGS]`, `RECRUITER_ATS`, `LEADER_COCKPIT`, and `MANIFESTS`. `SETTINGS = { labelKey: null, items: [business-units(module 'user'), billing, integrations] }`. The no-drift test (every `item.module === moduleForPath(item.href)`) and label-resolution test already run over all manifests — new sections must satisfy both. `can()` is the safety filter (prunes DEI for hrbp etc.), so manifests DECLARE intent; we never hand-prune.

- [ ] **Step 1: Add the failing manifest tests.** Append inside the `describe('nav manifest', ...)` block of `tests/nav/manifest.test.ts`:
```typescript
  it('hr_admin gets a people-first IA (People/Talent/Culture before Recruitment) with a reduced admin section', () => {
    const labels = MANIFESTS.hr_admin.sections.map((s) => s.labelKey);
    // People-first: people/talent/culture sections precede recruitment
    const peopleIdx = labels.indexOf('sidebar.people');
    const recruitmentIdx = labels.indexOf('sidebar.recruitment');
    expect(peopleIdx).toBeGreaterThanOrEqual(0);
    expect(recruitmentIdx).toBeGreaterThan(peopleIdx);
    // Reduced administration: business units present, but NO billing/integrations
    const allModules = MANIFESTS.hr_admin.sections.flatMap((s) => s.items.map((i) => i.module));
    expect(allModules).toContain('user');        // business units
    expect(allModules).not.toContain('billing');
    expect(allModules).not.toContain('integration');
  });

  it('hrbp gets a unit-scoped IA (recruitment + people + talent + culture, NO org-admin settings)', () => {
    const labels = MANIFESTS.hrbp.sections.map((s) => s.labelKey);
    expect(labels).toContain('sidebar.recruitment');
    expect(labels).toContain('sidebar.people');
    expect(labels).toContain('sidebar.organization'); // culture & strategy (incl. monitoring)
    // hrbp has no user/billing/integration grants → no org-admin section in the manifest
    const allModules = MANIFESTS.hrbp.sections.flatMap((s) => s.items.map((i) => i.module));
    for (const m of ['user', 'billing', 'integration'])
      expect(allModules, `hrbp nav should not include ${m}`).not.toContain(m);
  });
```

- [ ] **Step 2: Run, verify FAIL** (both still on BASE_ADMIN). Run: `npx vitest run tests/nav/manifest.test.ts`

- [ ] **Step 3: Add the sections + wire the manifests.** In `apps/web/lib/nav/manifest.ts`, after the `SETTINGS` const (and after `LEADER_COCKPIT`), add:
```typescript
// hr_admin = org-wide HR steward, people-first IA + a reduced admin section (business units only;
// no billing/integrations/flags/audit — org is read-only per the access spec). can() still prunes.
const HR_ADMIN_SETTINGS: NavSection = {
  labelKey: null,
  items: [
    { href: '/settings/business-units', labelKey: 'sidebar.businessUnits', icon: 'team', module: 'user' },
  ],
};
const HR_ADMIN_PEOPLE_FIRST: NavSection[] = [
  COMMAND_CENTER, PEOPLE, TALENT, CULTURE, RECRUITMENT, HR_ADMIN_SETTINGS,
];

// hrbp = HR business partner scoped to assigned units ("Mis Unidades"). Unit-native IA, no org-admin
// chrome. CULTURE keeps monitoring (hrbp has monitoring:read@unit); can() prunes DEI (no dei grant).
const HRBP_UNITS: NavSection[] = [COMMAND_CENTER, RECRUITMENT, PEOPLE, TALENT, CULTURE];
```
Then change the `MANIFESTS` entries:
```typescript
  hr_admin: adminManifest(HR_ADMIN_PEOPLE_FIRST),
  ...
  hrbp: adminManifest(HRBP_UNITS),
```
Leave all other roles unchanged. (No new i18n key is needed — every label key reused (`sidebar.businessUnits`, `sidebar.people`, etc.) already exists. If the label-resolution test flags a missing key, add it to BOTH locales and re-run; do not weaken the test.)

- [ ] **Step 4: Run, verify PASS** (incl. existing no-drift + label-resolution invariants now covering the new sections). Run: `npx vitest run tests/nav/manifest.test.ts`

- [ ] **Step 5: Type-check + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors.
Run: `npx vitest run` → full suite green (paste tally).
```bash
git add apps/web/lib/nav/manifest.ts tests/nav/manifest.test.ts
# + es.json/en.json only if a new label key was added
git commit -m "feat(web): give hr_admin a people-first IA and hrbp a unit-scoped Mis Unidades nav"
```

---

## Task 2: HR Executive Dashboard (hr_admin)

**Files:** Create `apps/web/app/(admin)/dashboard/hr-exec-dashboard.tsx` (+ a sibling `hr-exec-comp-dei.tsx` if >300 lines); Modify `es.json` + `en.json` (add `hrExecDashboard` block).

**Context — mirror the OrgCommandCenter pattern (`org-command-center.tsx`):** `'use client'`; container `<div className="h-full flex flex-col overflow-hidden p-6"><div className="flex-1 min-h-0 overflow-y-auto">…`; header `<h1 className="text-lg font-bold text-[#1F114C]">{t.hrExecDashboard.title}</h1>` + `<span className="text-[13px] text-[#585858]">{subtitle}</span>`; reuse `KpiCard`/`KpiCardSkeleton` from `'../../../components'`, `LoadError` from `'./load-error'`, the extracted panels `OrgFunnel`/`PerformancePanel`/`CulturePulse` from their files, `suppressedValue` from `'../../../lib/dashboard/suppress'`, `useI18n`, `trpc`. Use a local `Dot`/color-array helper exactly as OrgCommandCenter does (consistency with precedent — do NOT refactor OrgCommandCenter). **hr_admin is org-scoped → all these queries SUCCEED.**

- [ ] **Step 1: Add the `hrExecDashboard` i18n block (both locales, identical keys).** Add to es.json + en.json alongside `orgCommandCenter`/`managerDashboard`:
```json
"hrExecDashboard": {
  "title": "Panel Ejecutivo de RRHH",
  "subtitle": "Tu organizacion: gente, cultura y compensacion",
  "headcount": "Plantilla",
  "activeEmployees": "empleados activos",
  "openReqs": "Vacantes Abiertas",
  "activeOkrs": "OKRs Activos",
  "avgProgress": "progreso promedio",
  "enps": "eNPS",
  "monthlyPayroll": "Nomina Mensual",
  "diversity": "Diversidad",
  "recruitingFunnel": "Embudo de Reclutamiento",
  "performance": "Desempeno",
  "culturePulse": "Pulso de Cultura",
  "compTitle": "Compensacion",
  "benefitsUtilization": "Uso de Beneficios",
  "avgCompaRatio": "Compa-Ratio Promedio",
  "loadError": "No se pudieron cargar los datos"
}
```
en values (same keys): "HR Executive Dashboard" / "Your organization: people, culture & compensation" / "Headcount" / "active employees" / "Open Reqs" / "Active OKRs" / "avg progress" / "eNPS" / "Monthly Payroll" / "Diversity" / "Recruiting Funnel" / "Performance" / "Culture Pulse" / "Compensation" / "Benefits Utilization" / "Avg Compa-Ratio" / "Couldn't load data". Validate both JSON files parse.

- [ ] **Step 2: Build `hr-exec-dashboard.tsx`.** Export `function HrExecDashboard()`. Queries (verify each name/field/input via tsc against the REAL routers — adapt to the real shape; no casts):
```typescript
const exec = trpc.monitoring.getExecutiveKpis.useQuery();
const perf = trpc.performance.getDashboardKpis.useQuery();
const enps = trpc.engagement.getEnps.useQuery();
const culture = trpc.engagement.getDashboardKpis.useQuery();
const funnel = trpc.recruitmentAnalytics.getFunnel.useQuery();
const comp = trpc.compensation.getDashboardKpis.useQuery();
const dei = trpc.dei.getDashboardKpis.useQuery();
```
**READ `dei.getDashboardKpis`'s real return type** (`packages/api/src/routers/dei.ts` → `dei.service`) before writing the DEI card. Pick ONE safe scalar headline (e.g. a leadership-diversity % or a representation count). **If the chosen field carries a min-5 `*Suppressed` boolean (or is `null` when suppressed), render it through `suppressedValue(value, suppressedFlag, t.common.notDisclosed)`.** If no single safe scalar exists, render a representation **count** that the service already min-5-guards; never render a raw 1..4 demographic count.

Layout (mirror OrgCommandCenter, people-first):
- **KPI strip** — `<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">`. While the relevant queries load → `KpiCardSkeleton` ×6; on error → `<div className="col-span-full"><LoadError message={t.hrExecDashboard.loadError} /></div>`. Cards:
  1. Headcount = `exec.data?.totalEmployees ?? 0` (subtitle `activeEmployees`)
  2. Open Reqs = `exec.data?.activeVacancies ?? 0`
  3. Active OKRs = `perf.data?.activeOkrs ?? 0` (subtitle `` `${perf.data?.averageOkrProgress ?? 0}% ${t.hrExecDashboard.avgProgress}` ``)
  4. eNPS = `suppressedValue(enps.data?.enps, enps.data?.suppressed ?? false, t.common.notDisclosed)`
  5. Monthly Payroll = `suppressedValue(comp.data?.totalMonthlyPayroll, comp.data?.compensatedSuppressed ?? false, t.common.notDisclosed)`
  6. Diversity = the DEI headline from Step-2 reading (suppressed as required)
- **Reuse panels row** — `<div className="flex flex-col md:flex-row gap-4 mb-6">` with `<OrgFunnel stages={funnel.data?.stages} conversionPct={funnel.data?.conversionPct ?? null} totalHired={funnel.data?.totalHired ?? 0} isLoading={funnel.isLoading} error={funnel.isError} />` and `<PerformancePanel scheduledSessions={perf.data?.scheduledSessions ?? 0} completedSessions={perf.data?.completedSessions ?? 0} commitmentCompletionRate={perf.data?.commitmentCompletionRate ?? 0} activeOkrs={perf.data?.activeOkrs ?? 0} isLoading={perf.isLoading} error={perf.isError} />` (match the EXACT prop names by reading `performance-panel.tsx`/`org-funnel.tsx`).
- **Culture pulse** — `<CulturePulse totalResponses={suppressedValue(culture.data?.totalResponses, culture.data?.totalResponsesSuppressed ?? false, t.common.notDisclosed)} highRiskCount={culture.data?.highRiskCount ?? 0} actionPlansOpen={culture.data?.actionPlansOpen ?? 0} isLoading={culture.isLoading} error={culture.isError} />` (match `culture-pulse.tsx` prop names).

Keep the file < 300 lines. If it exceeds, extract the comp/DEI portion of the KPI strip into a sibling `hr-exec-comp-dei.tsx` and report the split. Use ONLY `t.hrExecDashboard.*` / `t.common.*` strings.

- [ ] **Step 3: Type-check.** Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors (proves every query name/field + the panel prop shapes resolve against the real routers/components). Fix mismatches to the real type (no casts). Run `npx vitest run` → suite stays green.

- [ ] **Step 4: Commit.**
```bash
git add "apps/web/app/(admin)/dashboard/hr-exec-dashboard.tsx" apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json
# + sibling if split
git commit -m "feat(web): build hr_admin HR Executive Dashboard (org rollups + comp + DEI, k-anon suppressed)"
```

---

## Task 3: Unit Health Dashboard (hrbp — "Mis Unidades")

**Files:** Create `apps/web/app/(admin)/dashboard/unit-health-dashboard.tsx`; Modify `es.json` + `en.json` (add `unitHealthDashboard` block).

**Context — mirror the ManagerDashboard pattern (`manager-dashboard.tsx`):** same container/header/KPI-strip/`LoadError`/`useI18n`/`trpc` structure. **NO `suppressedValue`** (operational counts only). **hrbp is unit-scoped → ONLY the 5 scope-aware list endpoints below may be called; `scopeWhereFor` auto-narrows them to the hrbp's units. Calling any `requireOrgScope` aggregate would throw FORBIDDEN at runtime.** Do NOT reuse the offers/scorecards to-do panels (hrbp is not an approver/evaluator → empty + misleading).

- [ ] **Step 1: Add the `unitHealthDashboard` i18n block (both locales, identical keys).** Add to es.json + en.json:
```json
"unitHealthDashboard": {
  "title": "Mis Unidades",
  "subtitle": "Salud de tus unidades asignadas",
  "recruiting": "Reclutamiento de la Unidad",
  "people": "Gente de la Unidad",
  "openVacancies": "Vacantes Abiertas",
  "pendingApproval": "Pendientes de Aprobacion",
  "activeCandidates": "Candidatos Activos",
  "totalApplications": "Postulaciones",
  "activeOkrs": "OKRs Activos",
  "openActionPlans": "Planes de Accion Abiertos",
  "leaderCommitments": "Compromisos de Lideres",
  "recentVacanciesTitle": "Vacantes Recientes de tus Unidades",
  "noVacancies": "No hay vacantes en tus unidades",
  "loadError": "No se pudieron cargar los datos"
}
```
en values (same keys): "My Units" / "Health of your assigned units" / "Unit Recruiting" / "Unit People" / "Open Vacancies" / "Pending Approval" / "Active Candidates" / "Applications" / "Active OKRs" / "Open Action Plans" / "Leader Commitments" / "Recent Vacancies in Your Units" / "No vacancies in your units" / "Couldn't load data". Validate both JSON files parse.

- [ ] **Step 2: Build `unit-health-dashboard.tsx`.** Export `function UnitHealthDashboard()`. Queries (verify name/field/input via tsc; read each list endpoint's `.input` for required/valid args — e.g. `listOkrs` takes `{ limit?:1..100, status? }`):
```typescript
const vac = trpc.vacancy.getDashboardKpis.useQuery();
const cand = trpc.candidate.getDashboardKpis.useQuery();
const okrs = trpc.performance.listOkrs.useQuery({ limit: 100, status: 'active' });
const actionPlans = trpc.engagement.listActionPlans.useQuery(/* read input schema; pass valid/empty */);
const commitments = trpc.engagement.listLeaderCommitments.useQuery(/* read input schema */);
```
For list counts: use `total`/`nextCursor`-aware counting where available, else count returned items with a generous `limit` (team/unit lists are small; note the cap in a comment) — same approach the ManagerDashboard used.

Two sections (each handles loading/error/empty independently per `frontend.md`):

**SECTION 1 — Unit Recruiting** (header `t.unitHealthDashboard.recruiting`):
- KPI strip (4 `KpiCard`s; `KpiCardSkeleton` while `vac`/`cand` load; `LoadError` on error):
  - Open Vacancies = `vac.data?.totalOpen ?? 0`
  - Pending Approval = `vac.data?.totalPendingApproval ?? 0` (highlight if > 0)
  - Active Candidates = `cand.data?.activeApplications ?? 0`
  - Applications = `vac.data?.totalApplications ?? 0`
- **Recent Vacancies** panel (white card `bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5`): header `t.unitHealthDashboard.recentVacanciesTitle`; list `vac.data?.recentVacancies` rows (title + status + `_count.applications`), each row a `<Link href="/recruitment/vacancies">` (or the vacancy detail route if one exists); `Skeleton` rows while loading; `LoadError` on error; `EmptyState` with `t.unitHealthDashboard.noVacancies` when loaded-empty.

**SECTION 2 — Unit People** (header `t.unitHealthDashboard.people`):
- KPI strip (3 `KpiCard`s; skeleton/LoadError as above):
  - Active OKRs = count from `okrs.data?.okrs` (already `status:'active'`-filtered by the query)
  - Open Action Plans = count of `actionPlans.data` filtered to not-completed (match the real status enum — read it; the ManagerDashboard used `!== 'completed'`)
  - Leader Commitments = count of `commitments.data` filtered to open (the ManagerDashboard used `!== 'fulfilled'`)

Keep < 300 lines; if it exceeds, extract the recent-vacancies panel into a sibling and report. Use ONLY `t.unitHealthDashboard.*` strings.

- [ ] **Step 3: Type-check.** Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors. Run `npx vitest run` → suite green. If a list endpoint needs an input you can't satisfy, report BLOCKED with the schema.

- [ ] **Step 4: Commit.**
```bash
git add "apps/web/app/(admin)/dashboard/unit-health-dashboard.tsx" apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json
git commit -m "feat(web): build hrbp Unit Health Dashboard (Mis Unidades, unit-scoped counts)"
```

---

## Task 4: Route hr_admin → HR-Exec, hrbp → Unit Health

**Files:** Modify `apps/web/app/(admin)/dashboard/pick-dashboard.ts`; Modify `recruitment-dashboard.tsx`; Test `tests/dashboard/pick-dashboard.test.ts`.

**Current state:** `pick-dashboard.ts` has `RECRUITER_ROLES = ['hr_admin', 'recruiter', 'hrbp']` and `pickPrimaryDashboard` returns `'recruiter'` for any of them. This task splits hr_admin + hrbp out into their own keys. Precedence must stay: super_admin > hr_admin > hrbp > recruiter > leader > committee > employee (mirrors `PRECEDENCE` in manifest.ts).

- [ ] **Step 1: Update the routing test.** In `tests/dashboard/pick-dashboard.test.ts`, replace the hr_admin/hrbp/recruiter expectations with:
```typescript
  it('hr_admin → hrExec; hrbp → unit; recruiter → recruiter (each its own landing)', () => {
    expect(pickPrimaryDashboard(['hr_admin'])).toBe('hrExec');
    expect(pickPrimaryDashboard(['hrbp'])).toBe('unit');
    expect(pickPrimaryDashboard(['recruiter'])).toBe('recruiter');
  });
  it('admin-tier precedence: hr_admin > hrbp > recruiter on collisions', () => {
    expect(pickPrimaryDashboard(['hrbp', 'recruiter'])).toBe('unit');
    expect(pickPrimaryDashboard(['hr_admin', 'recruiter'])).toBe('hrExec');
    expect(pickPrimaryDashboard(['hr_admin', 'hrbp'])).toBe('hrExec');
  });
```
Find and update any EXISTING assertion that asserted `hr_admin`/`hrbp` → `'recruiter'` (and any `['committee','hr_admin'] → 'recruiter'`-type collision case → now `'hrExec'`). Keep super_admin/leader/committee/employee cases intact. (Read the whole test file first.)

- [ ] **Step 2: Run, verify FAIL** (hr_admin/hrbp currently → 'recruiter'). Run: `npx vitest run tests/dashboard/pick-dashboard.test.ts`

- [ ] **Step 3: Update `pick-dashboard.ts`.** Add the two keys and split the checks:
```typescript
export type DashboardKey = 'org' | 'hrExec' | 'unit' | 'recruiter' | 'manager' | 'leader' | 'employee';

export function pickPrimaryDashboard(roleSlugs: readonly string[]): DashboardKey {
  if (roleSlugs.includes('super_admin')) return 'org';
  if (roleSlugs.includes('hr_admin')) return 'hrExec';
  if (roleSlugs.includes('hrbp')) return 'unit';
  if (roleSlugs.includes('recruiter')) return 'recruiter';
  if (roleSlugs.includes('leader')) return 'manager';
  if (roleSlugs.includes('committee')) return 'leader';
  return 'employee';
}
```
Remove the now-unused `RECRUITER_ROLES` const and `isOneOf` helper **only if grep confirms nothing else references them** (`grep -rn "RECRUITER_ROLES\|isOneOf" apps/web`); otherwise leave them. Update the explanatory comment to reflect the new per-role mapping and precedence.

- [ ] **Step 4: Wire the switch.** In `recruitment-dashboard.tsx`, import `HrExecDashboard` from `'./hr-exec-dashboard'` and `UnitHealthDashboard` from `'./unit-health-dashboard'`, and add the cases:
```typescript
  switch (pickPrimaryDashboard(roleSlugs)) {
    case 'org': return <OrgCommandCenter />;
    case 'hrExec': return <HrExecDashboard />;
    case 'unit': return <UnitHealthDashboard />;
    case 'recruiter': return <RecruiterDashboard />;
    case 'manager': return <ManagerDashboard />;
    case 'leader': return <LeaderDashboard />;
    default: return <EmployeeDashboard />;
  }
```
Preserve the `const key = pickPrimaryDashboard(roleSlugs)` binding + the `const _exhaustive: never = key` guard in `default` (it now confirms all 7 keys are handled).

- [ ] **Step 5: Verify + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors.
Run: `npx vitest run` → full suite green (paste tally).
Run: `cd apps/web && pnpm build && cd ../..` → `✓ Compiled successfully`.
```bash
git add "apps/web/app/(admin)/dashboard/pick-dashboard.ts" "apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx" tests/dashboard/pick-dashboard.test.ts
git commit -m "feat(web): route hr_admin to HR-Exec and hrbp to Unit Health dashboards"
```

---

## Task 5: Verification

**Files:** none.

- [ ] **Step 1: Gate.** Run: `cd apps/web && npx tsc --noEmit && cd ../.. && pnpm --filter @tims/api exec tsc --noEmit && npx vitest run` → tsc 0 (web+api); full suite green.
- [ ] **Step 2: Build.** Run: `cd apps/web && pnpm build && cd ../..` → `✓ Compiled successfully`.
- [ ] **Step 3: hrbp blocked-endpoint grep (must be NONE).** Grep `unit-health-dashboard.tsx` (+ any sibling) for org-only procedures: `getExecutiveKpis`, `recruitmentAnalytics`, `getEnps`, `performance.getDashboardKpis`, `engagement.getDashboardKpis`, `compensation.getDashboardKpis`, `dei.`, and `*.getDashboardKpis` for ninebox/succession/learning/onboarding/monitoring → must be EMPTY. Only the 5 scope-aware list endpoints may appear (an hrbp would get FORBIDDEN otherwise).
- [ ] **Step 4: hr_admin k-anonymity check.** Confirm every sensitive aggregate the HR-Exec dashboard renders is wrapped in `suppressedValue` with the correct `*Suppressed` flag: eNPS (`enps.suppressed`), Monthly Payroll (`compensatedSuppressed`), Culture responses (`totalResponsesSuppressed`), and the DEI headline (its own flag / null-guard). No raw 1..4 sensitive value may reach the DOM.
- [ ] **Step 5: Parity (static).** Confirm: `hr_admin` → HR-Exec dashboard + people-first nav; `hrbp` → Unit Health dashboard + unit nav (no org-admin settings); `recruiter` unchanged (still 'recruiter' + RECRUITER_ATS); super_admin/leader/committee/employee unchanged. Only hr_admin + hrbp changed.
- [ ] **Step 6: `/gate`.** Run: `/gate` → green.
- [ ] **Step 7 (optional, dev server):** Log in as hr_admin → lands on HR-Exec dashboard (KPI strip + funnel/performance/culture panels render, comp + DEI present, eNPS/payroll show N/D if small org), people-first nav; log in as hrbp → lands on Unit Health ("Mis Unidades"), unit counts render, NO console FORBIDDEN (would mean a blocked endpoint slipped in), no org-admin settings in nav.

---

## Self-Review

**Spec coverage (§3 hr_admin + hrbp):** hr_admin HR-Exec dashboard (headcount/open-reqs/cycle/engagement/DEI/comp) → Task 2; people-first IA + reduced admin → Task 1. hrbp Unit Health "Mis Unidades" (unit recruiting + people health) → Task 3; unit nav (no org-admin) → Task 1. Routing both → Task 4. Verification incl. the two role-specific invariants (hrbp no-FORBIDDEN, hr_admin k-anon) → Task 5. Grants unchanged (Slice 0). committee/employee untouched (Slice 4).

**Placeholder scan:** The two dashboard sub-layouts are specified by data-source + reused primitive/panel + suppression rule rather than line-by-line JSX (mirrors the fully-quoted OrgCommandCenter/ManagerDashboard patterns they clone). The DEI field is explicitly read-at-implementation (Task 2 Step 2) because its shape is the one unverified return type — tsc + the k-anon check (Task 5 Step 4) gate it. Manifests, routing, and tests are fully specified.

**Type consistency:** `DashboardKey` gains `'hrExec'` + `'unit'`, both handled in the switch + the `never` guard + tested. Manifest `NavSection[]` building blocks are reused. Panel prop names (`OrgFunnel`/`PerformancePanel`/`CulturePulse`) are taken from the real component interfaces (Task 2 instructs reading them). Every new manifest item's module satisfies the no-drift test; every labelKey resolves.

**Risk:** no server/db/grant changes; rendered only for hr_admin/hrbp; hr_admin uses org-scoped endpoints it is verified to be allowed to call; hrbp uses only unit-scoped list endpoints (Task 5 Step 3 enforces). The two genuine risks — the DEI shape and the k-anon suppression — are both gated (tsc + explicit Task 5 checks + the code-quality review). No regression to other roles.

---

*Next after Slice 3 ships: Slice 4 (participant shell — committee "My Tasks" + employee "My Home" self-service).*
