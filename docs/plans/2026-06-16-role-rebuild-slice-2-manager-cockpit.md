# Role Rebuild — Slice 2 (Leader Manager Cockpit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `leader` a purpose-built **two-world experience** — a **My Hiring / My Team** nav manifest + a **Manager Dashboard** landing (recruiting KPIs + the manager's real to-do lists: offers to approve, scorecards to submit, + a lean team snapshot) — replacing the thin generic LeaderDashboard. Reuses only team-scoped endpoints a leader can actually call (no new/relaxed endpoints).

**Architecture:** Extends the Slice 1a manifest engine (add a bespoke `leader` manifest) and the Slice 1b dashboard pattern (a new `ManagerDashboard` mirroring `OrgCommandCenter`, routed via the pure `pickPrimaryDashboard`). A new `'manager'` `DashboardKey` keeps `leader` distinct from `committee` (which stays on the thin LeaderDashboard until Slice 4 — the 1b exhaustiveness guard forces the new case to be handled).

**Tech Stack:** Next.js 15 (client components), React, tRPC, TypeScript (strict), Vitest. Tests at repo-root `tests/`.

**Source of truth:** `ROLE-EXPERIENCE-REBUILD-SPEC.md` §3.5 (leader manager-cockpit, two worlds). Slices 0/1a/1b live in prod.

---

## Scoping decisions (locked with Federico, 2026-06-16)

| Decision | Resolution |
|---|---|
| Manager Dashboard composition | **Reuse-only two-world cockpit** — My Hiring (recruiting KPIs + Offers-to-Approve + Scorecards-to-Submit) + My Team (Active OKRs / Open Action Plans / My Commitments, counts from team-scoped list endpoints). NO new endpoints. |
| Team aggregate rollup (team eNPS / perf %) | **Deferred to Slice 6** — every `*.getDashboardKpis` is `requireOrgScope` and throws for a team-scoped leader. Not buildable today. |
| Slice split | **None** — the 1a manifest engine exists, so the leader manifest is a small change; one cohesive slice. |
| `committee` | **Unchanged** — stays on the thin `LeaderDashboard` (its real "My Tasks" is Slice 4). Only `leader` moves to the Manager Dashboard. |
| Sensitive-data suppression | **Not needed** — Manager Dashboard surfaces operational counts/lists (vacancies, offers, scorecards, OKR/action-plan counts), not k-anonymity-sensitive aggregates. |

---

## Endpoint availability for a team-scoped leader (verified)

**✅ AVAILABLE (scope-aware → returns the leader's team slice; used by this slice):**

| Use | Procedure | Returns (expected — verify via tsc) |
|---|---|---|
| Team recruiting KPIs | `vacancy.getDashboardKpis` | `{ totalOpen, totalPendingApproval, totalApplications, ... }` |
| Team candidate KPIs | `candidate.getDashboardKpis` | `{ total, newThisMonth, activeApplications, byPool }` |
| **Offers to approve** | `offer.getPending` | `[{ approvalId, step, offer: { id, vacancy, candidate, creator } }]` |
| **Scorecards to submit** | `interview.getPendingScorecards` | `[{ ...evaluator assignment, interview, candidate, vacancy, submitted? }]` |
| Team OKRs | `performance.listOkrs` (team-scoped) | paginated OKR list (verify if a `total` is returned) |
| Open action plans | `engagement.listActionPlans` | action-plan list (status/responsible/dueDate) |
| Leader commitments | `engagement.listLeaderCommitments` | commitment list (dueDate/status) |

**🔴 BLOCKED for leader (all `requireOrgScope` → FORBIDDEN at team scope) — do NOT call:** `performance.getDashboardKpis`, `engagement.getDashboardKpis`/`getEnps`, `recruitmentAnalytics.*`, `ninebox/succession/compensation/learning/onboarding/teamIntel.getDashboardKpis`, `monitoring.getExecutiveKpis`. (These power OrgCommandCenter for super_admin; they are NOT reusable here.)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/web/lib/nav/manifest.ts` | nav manifests | Add `LEADER_MY_HIRING` + `LEADER_MY_TEAM` sections; set `MANIFESTS.leader` |
| `apps/web/app/(admin)/dashboard/manager-dashboard.tsx` | **NEW.** Leader Manager Dashboard | Create (decompose into siblings if >300 lines) |
| `apps/web/app/(admin)/dashboard/pick-dashboard.ts` | role→dashboard routing | Add `'manager'` key; `leader → 'manager'`, `committee → 'leader'` |
| `apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx` | dashboard switch | Add `case 'manager': <ManagerDashboard/>` |
| `apps/web/lib/i18n/es.json` + `en.json` | i18n | Add `sidebar.myHiring/myTeam/finalistCandidates/offersToApprove` + a `managerDashboard` block |
| `tests/nav/manifest.test.ts` | manifest tests | Add leader-manifest assertions |
| `tests/dashboard/pick-dashboard.test.ts` | routing tests | Update leader→manager, committee→leader |

---

## Task 1: Leader two-world nav manifest

**Files:** Modify `apps/web/lib/nav/manifest.ts`; Modify `es.json` + `en.json`; Test `tests/nav/manifest.test.ts`.

- [ ] **Step 1: Add the i18n keys (both locales, identical key sets).** In the `sidebar` block of `es.json` and `en.json`, add:
  - es: `"myHiring": "Mi Reclutamiento"`, `"myTeam": "Mi Equipo"`, `"finalistCandidates": "Candidatos Finalistas"`, `"offersToApprove": "Ofertas por Aprobar"`
  - en: `"myHiring": "My Hiring"`, `"myTeam": "My Team"`, `"finalistCandidates": "Finalist Candidates"`, `"offersToApprove": "Offers to Approve"`
  Validate JSON: `node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/es.json','utf8'));JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/en.json','utf8'));console.log('OK')"`.

- [ ] **Step 2: Write the failing manifest test.** Append to `tests/nav/manifest.test.ts` (inside the `describe('nav manifest', ...)` block):
```typescript
  it('leader gets a bespoke two-world manifest (My Hiring + My Team), not BASE_ADMIN', () => {
    const labels = MANIFESTS.leader.sections.map((s) => s.labelKey);
    expect(labels).toContain('sidebar.myHiring');
    expect(labels).toContain('sidebar.myTeam');
    // My Hiring = the leader's hiring objects
    const hiring = MANIFESTS.leader.sections.find((s) => s.labelKey === 'sidebar.myHiring');
    const hiringModules = hiring?.items.map((i) => i.module) ?? [];
    expect(hiringModules).toEqual(expect.arrayContaining(['vacancy', 'candidate', 'interview', 'offer']));
    // My Team = team people modules
    const team = MANIFESTS.leader.sections.find((s) => s.labelKey === 'sidebar.myTeam');
    const teamModules = team?.items.map((i) => i.module) ?? [];
    expect(teamModules).toEqual(expect.arrayContaining(['performance', 'learning', 'ninebox', 'engagement', 'compensation']));
    // Curated: leader should NOT see admin/settings or org-only modules in nav
    const all = MANIFESTS.leader.sections.flatMap((s) => s.items.map((i) => i.module));
    for (const m of ['user', 'billing', 'integration', 'monitoring', 'dei', 'succession', 'team_intel'])
      expect(all, `leader nav should not include ${m}`).not.toContain(m);
  });
```
(The existing no-drift + label-resolution tests will also now cover the leader sections — every item.module must match `moduleForPath(href)` and every labelKey must resolve.)

- [ ] **Step 3: Run, verify it FAILS** (leader still uses BASE_ADMIN). Run: `npx vitest run tests/nav/manifest.test.ts`

- [ ] **Step 4: Add the leader sections + wire the manifest.** In `apps/web/lib/nav/manifest.ts`, after the existing section building-blocks (after `SETTINGS`, ~line 66), add:
```typescript
// Leader = a two-world cockpit: hiring objects + team people. All @team via can()/API scope.
const LEADER_MY_HIRING: NavSection = {
  labelKey: 'sidebar.myHiring',
  items: [
    { href: '/recruitment/vacancies', labelKey: 'sidebar.vacancies', icon: 'briefcase', module: 'vacancy' },
    { href: '/recruitment/candidates', labelKey: 'sidebar.finalistCandidates', icon: 'user', module: 'candidate' },
    { href: '/recruitment/interviews', labelKey: 'sidebar.interviews', icon: 'video', module: 'interview' },
    { href: '/recruitment/offers', labelKey: 'sidebar.offersToApprove', icon: 'clipboard', module: 'offer' },
  ],
};
const LEADER_MY_TEAM: NavSection = {
  labelKey: 'sidebar.myTeam',
  items: [
    { href: '/people/performance', labelKey: 'sidebar.performance', icon: 'target', module: 'performance' },
    { href: '/learning', labelKey: 'sidebar.training', icon: 'book', module: 'learning' },
    { href: '/talent/nine-box', labelKey: 'sidebar.nineBox', icon: 'ninebox', module: 'ninebox' },
    { href: '/engagement/climate', labelKey: 'sidebar.climate', icon: 'heart', module: 'engagement' },
    { href: '/compensation', labelKey: 'sidebar.compensation', icon: 'dollar', module: 'compensation' },
  ],
};
const LEADER_COCKPIT: NavSection[] = [COMMAND_CENTER, LEADER_MY_HIRING, LEADER_MY_TEAM];
```
Then change the `leader` entry in `MANIFESTS` from `adminManifest(BASE_ADMIN)` to `adminManifest(LEADER_COCKPIT)`. Leave all other roles unchanged.

- [ ] **Step 5: Run, verify it PASSES** (incl. the existing no-drift + label-resolution invariants). Run: `npx vitest run tests/nav/manifest.test.ts`

- [ ] **Step 6: Type-check + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors.
Run: `npx vitest run` → full suite green (paste tally).
```bash
git add apps/web/lib/nav/manifest.ts apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json tests/nav/manifest.test.ts
git commit -m "feat(web): give leader a bespoke My Hiring / My Team nav manifest"
```

---

## Task 2: The Manager Dashboard component

**Files:** Create `apps/web/app/(admin)/dashboard/manager-dashboard.tsx` (+ siblings if >300 lines); Modify `es.json` + `en.json` (add `managerDashboard` block).

Mirror the `OrgCommandCenter` pattern (`org-command-center.tsx`): container `<div className="h-full flex flex-col overflow-hidden p-6"><div className="flex-1 min-h-0 overflow-y-auto">…`, reuse `KpiCard`/`KpiCardSkeleton`/`EmptyState`/`Skeleton` from `'../../../components'` and `LoadError` from `'./load-error'`, `const { t } = useI18n();`, `import { trpc } from '../../../lib/trpc';`. NO `suppressedValue` (no sensitive aggregates here).

- [ ] **Step 1: Add the `managerDashboard` i18n block (both locales, identical keys).** Add to es.json + en.json:
```json
"managerDashboard": {
  "title": "Mi Gestion",
  "subtitle": "Tu equipo y tu reclutamiento",
  "myHiring": "Mi Reclutamiento",
  "myTeam": "Mi Equipo",
  "openVacancies": "Vacantes Abiertas",
  "activeCandidates": "Candidatos Activos",
  "offersToApprove": "Ofertas por Aprobar",
  "scorecardsToSubmit": "Scorecards Pendientes",
  "activeOkrs": "OKRs Activos",
  "openActionPlans": "Planes de Accion Abiertos",
  "myCommitments": "Mis Compromisos",
  "approveOffersTitle": "Ofertas Pendientes de tu Aprobacion",
  "scorecardsTitle": "Entrevistas que Requieren tu Scorecard",
  "noOffers": "No tienes ofertas pendientes de aprobar",
  "noScorecards": "No tienes scorecards pendientes",
  "loadError": "No se pudieron cargar los datos"
}
```
(en values: "My Management" / "Your team and your hiring" / "My Hiring" / "My Team" / "Open Vacancies" / "Active Candidates" / "Offers to Approve" / "Pending Scorecards" / "Active OKRs" / "Open Action Plans" / "My Commitments" / "Offers Pending Your Approval" / "Interviews Needing Your Scorecard" / "No offers pending your approval" / "No pending scorecards" / "Couldn't load data".)

- [ ] **Step 2: Build `manager-dashboard.tsx`.** Export `function ManagerDashboard()`. Queries (verify each name + field via tsc — adapt to the REAL return shape if any differ, as the funnel shape did in Slice 1b; do NOT cast):
```typescript
const vac = trpc.vacancy.getDashboardKpis.useQuery();
const cand = trpc.candidate.getDashboardKpis.useQuery();
const offers = trpc.offer.getPending.useQuery();
const scorecards = trpc.interview.getPendingScorecards.useQuery();
const okrs = trpc.performance.listOkrs.useQuery(/* team-scoped; pass the input the router requires — read its .input schema */);
const actionPlans = trpc.engagement.listActionPlans.useQuery(/* read its input schema */);
const commitments = trpc.engagement.listLeaderCommitments.useQuery(/* read its input schema */);
```
IMPORTANT: read each router's `.input(...)` to pass required/zod-valid inputs (e.g. pagination limit). For the list endpoints, derive counts: if the response exposes a `total`, use it; otherwise count the returned items and request a generous limit (e.g. 100) — team lists are small; note the cap in a comment.

Two sections:

**SECTION 1 — My Hiring** (header `t.managerDashboard.myHiring`):
- KPI strip (4 `KpiCard`s; `KpiCardSkeleton`s while the relevant queries load; `LoadError` if they error):
  - Open Vacancies = `vac.data?.totalOpen ?? 0`
  - Active Candidates = `cand.data?.total ?? 0` (or `activeApplications` — pick the field that means "active candidates"; verify shape)
  - Offers to Approve = count of `offers.data` (highlight if > 0)
  - Scorecards to Submit = count of pending in `scorecards.data` (highlight if > 0)
- Two **to-do panels** (the manager's daily driver), side-by-side `flex flex-col md:flex-row gap-4`:
  - **Offers to Approve** (white card): header `t.managerDashboard.approveOffersTitle`; list `offers.data` rows (candidate name + vacancy title, link the row to the offer, e.g. `/recruitment/offers` or the offer detail if a route exists — otherwise `/recruitment/offers`); `Skeleton` rows while loading; `LoadError` on error; `EmptyState` with `t.managerDashboard.noOffers` when loaded-empty.
  - **Scorecards to Submit** (white card): header `t.managerDashboard.scorecardsTitle`; list `scorecards.data` rows (candidate + vacancy, link to `/recruitment/interviews` or the interview detail); same loading/error/empty handling with `t.managerDashboard.noScorecards`.

**SECTION 2 — My Team** (header `t.managerDashboard.myTeam`):
- KPI strip (3 `KpiCard`s; skeleton/LoadError as above):
  - Active OKRs = count from `okrs.data` (active)
  - Open Action Plans = count from `actionPlans.data` (open/in-progress)
  - My Commitments = count from `commitments.data` (open)

Each section/panel handles loading/error/empty independently (per `frontend.md`). Use only `t.managerDashboard.*` strings (no hardcoded text). Keep the file < 300 lines; if it exceeds, extract the two to-do panels into a sibling `manager-todos.tsx` (and/or a `todo-list.tsx`) and report the split.

- [ ] **Step 3: Type-check.** Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors. This proves every query name + `.input` + `.data?.field` access resolves against the real routers. Fix any field/shape mismatch to the real type (no casts). If a list endpoint requires an input you can't satisfy from a leader context, report BLOCKED with details.

- [ ] **Step 4: Commit.**
```bash
git add apps/web/app/(admin)/dashboard/manager-dashboard.tsx apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json
# + sibling files if you split
git commit -m "feat(web): build leader Manager Dashboard — My Hiring to-dos + My Team snapshot (team-scoped)"
```

---

## Task 3: Route `leader` → Manager Dashboard

**Files:** Modify `apps/web/app/(admin)/dashboard/pick-dashboard.ts`; Modify `recruitment-dashboard.tsx`; Test `tests/dashboard/pick-dashboard.test.ts`.

- [ ] **Step 1: Update the routing test.** In `tests/dashboard/pick-dashboard.test.ts`, change the leader/committee expectations:
```typescript
  it('leader → manager dashboard (NEW); committee stays on leader dashboard (Slice 4 gives it My Tasks)', () => {
    expect(pickPrimaryDashboard(['leader'])).toBe('manager');
    expect(pickPrimaryDashboard(['leader', 'committee'])).toBe('manager'); // leader wins
    expect(pickPrimaryDashboard(['committee'])).toBe('leader');
  });
  it('recruiter-tier still outranks leader', () => {
    expect(pickPrimaryDashboard(['leader', 'recruiter'])).toBe('recruiter');
  });
```
(Update/replace the existing `leader → 'leader'` and `committee → 'leader'` cases accordingly; keep super_admin/recruiter/employee cases.)

- [ ] **Step 2: Run, verify it FAILS** (leader currently → 'leader'). Run: `npx vitest run tests/dashboard/pick-dashboard.test.ts`

- [ ] **Step 3: Update `pick-dashboard.ts`.** Add `'manager'` to the union and split the leader/committee checks:
```typescript
export type DashboardKey = 'org' | 'recruiter' | 'manager' | 'leader' | 'employee';

const RECRUITER_ROLES = ['hr_admin', 'recruiter', 'hrbp'] as const;

export function pickPrimaryDashboard(roleSlugs: readonly string[]): DashboardKey {
  if (roleSlugs.includes('super_admin')) return 'org';
  if (roleSlugs.some((r) => isOneOf(RECRUITER_ROLES, r))) return 'recruiter';
  if (roleSlugs.includes('leader')) return 'manager';
  if (roleSlugs.includes('committee')) return 'leader';
  return 'employee';
}
```
(Remove the now-unused `LEADER_ROLES` const if nothing else references it; keep `isOneOf`.)

- [ ] **Step 4: Wire the switch.** In `recruitment-dashboard.tsx`, import `ManagerDashboard` from `'./manager-dashboard'` and add the case:
```typescript
  switch (pickPrimaryDashboard(roleSlugs)) {
    case 'org': return <OrgCommandCenter />;
    case 'recruiter': return <RecruiterDashboard />;
    case 'manager': return <ManagerDashboard />;
    case 'leader': return <LeaderDashboard />;
    default: return <EmployeeDashboard />;
  }
```
The 1b `const _exhaustive: never = key` guard (if present in the default) confirms the union is fully handled — keep it.

- [ ] **Step 5: Verify + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors.
Run: `npx vitest run` → full suite green (paste tally).
Run: `cd apps/web && pnpm build && cd ../..` → compiles.
```bash
git add apps/web/app/(admin)/dashboard/pick-dashboard.ts apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx tests/dashboard/pick-dashboard.test.ts
git commit -m "feat(web): route leader to the Manager Dashboard (committee stays on LeaderDashboard until Slice 4)"
```

---

## Task 4: Verification

**Files:** none.

- [ ] **Step 1: Gate.** Run: `cd apps/web && npx tsc --noEmit && cd ../.. && pnpm --filter @tims/api exec tsc --noEmit && npx vitest run` → tsc 0 (web+api); full suite green.
- [ ] **Step 2: Build.** Run: `cd apps/web && pnpm build && cd ../..` → `✓ Compiled successfully`.
- [ ] **Step 3: Parity (static).** Confirm: `leader` → Manager Dashboard + My Hiring/My Team nav (NEW); `committee` → LeaderDashboard + (still BASE_ADMIN nav until Slice 4); super_admin/hr_admin/hrbp/recruiter/employee unchanged. Only `leader` changed.
- [ ] **Step 4: No blocked-endpoint calls.** Grep `manager-dashboard.tsx` (+ siblings) for any of the org-only procedures (`getExecutiveKpis`, `recruitmentAnalytics`, `performance.getDashboardKpis`, `engagement.getDashboardKpis`, `engagement.getEnps`, `*.getDashboardKpis` for ninebox/succession/compensation/learning/onboarding/teamIntel) → must be NONE (a leader would get FORBIDDEN). Only the team-scoped procedures from the availability table may appear.
- [ ] **Step 5: `/gate`.** Run: `/gate` → green.
- [ ] **Step 6 (optional, dev server):** Log in as a leader → land on Manager Dashboard; My Hiring shows recruiting KPIs + the two to-do lists; My Team shows the 3 counts; nav shows My Hiring / My Team. Confirm no console FORBIDDEN errors (would indicate a blocked-endpoint call slipped in).

---

## Self-Review

**Spec coverage (§3.5 leader two-worlds):** My Hiring (team vacancies, finalist candidates, interviews, offers to approve) + My Team nav → Task 1. Manager dashboard (open reqs + pending approvals [offers/scorecards] + team snapshot) → Task 2. Routing leader→manager, committee unchanged → Task 3. The org-style team perf/engagement *aggregate* snapshot is deferred (blocked at team scope; noted as Slice 6). Recognition tile = [UNBUILT] (omitted per D5).

**Placeholder scan:** the Manager Dashboard sub-sections are specified by data-source + reused primitive + the to-do-list rendering rather than line-by-line JSX (mirrors the fully-quoted OrgCommandCenter pattern); the manifest sections, routing, and tests are fully specified. The list-endpoint input schemas are read-at-implementation (Task 2 Step 2) because they vary — tsc is the gate.

**Type consistency:** `DashboardKey` gains `'manager'`, handled in the switch + tested. The manifest `NavSection`/`NavItem` shapes are reused. Every leader manifest item's module is in PATH_MODULE (no-drift test) and every labelKey resolves (label test).

**Risk:** no server/db changes; rendered only for leader; only team-scoped (leader-callable) endpoints used (Task 4 Step 4 enforces this); worst case is a wrong field name caught by tsc. No regression to other roles.

---

*Next after Slice 2 ships: Slice 3 (hr_admin HR-exec dashboard + hrbp "Mis Unidades").*
