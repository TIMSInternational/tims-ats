# Role Rebuild — Slice 4 (Participant Shell: committee + employee) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the **participant shell** — the second app chrome, deferred since Slice 1a — and pull `committee` + `employee` out of the dense admin chrome into purpose-built, task-focused experiences: **committee → "My Tasks"** (My Panels = interviews awaiting your scorecard) and **employee → "My Home"** (My Performance + My Learning + My Onboarding). Frontend-only, reuse-only: every section uses an existing own/assigned-scoped endpoint; spec sections whose backend doesn't exist yet (committee My Calibrations; employee My Surveys / Compensation / 360 / Privacy) are **omitted per D5** until their feature ships.

**Architecture:** Activates the dormant `manifest.shell` field. `AdminShell` already swaps the sidebar by a server-passed flag (`isPlatformOwner ? PlatformSidebar : Sidebar`); we add a third branch — a new lighter `ParticipantSidebar` selected when the user's manifest `shell === 'participant'`, with the `shell` computed server-side in the `(admin)` layout (exactly how `isPlatformOwner` is computed and passed). committee/employee stay in the `(admin)` route group (they are real staff users needing its auth / permission / tRPC context); only the chrome + landing change. Two new bespoke landings route via the pure `pickPrimaryDashboard` behind a `never`-guarded `DashboardKey` union.

**Tech Stack:** Next.js 15 (server layout + client components), React, tRPC, TypeScript (strict, no `any`/casts), Vitest. Tests at repo-root `tests/`.

**Source of truth:** `docs/ROLE-EXPERIENCE-REBUILD-SPEC.md` §1 (two shells), §3 participant shell (committee "My Tasks"; employee "My Home"), D5 (omit unbuilt items). Grants unchanged (committee/employee were already correct in Slice 0). Slices 0/1a/1b/2/3 live in prod.

---

## Scoping decisions (locked with Federico, 2026-06-17)

| Decision | Resolution |
|---|---|
| Slice 4 reach | **Frontend-only (spec D5).** Build the participant shell + both landings using ONLY existing callable endpoints. ⏳ sections omitted. Pure Vercel deploy, no API/db change — same shape as Slices 1a/1b/2/3. |
| committee scope | **team / evaluator-assignment.** `interview.getPendingScorecards` is scope-aware and returns the committee member's assigned pending scorecards → My Panels is buildable. My Calibrations has NO own/team-scoped list endpoint (`ninebox.listCalibrations` is `requireOrgScope` → FORBIDDEN) → **omitted ⏳.** |
| employee scope | **own.** Buildable: My Performance (`performance.listOkrs`/`listCoachingSessions`/`listFeedback`), My Learning (own learning endpoint), My Onboarding (`onboarding.list`). NOT buildable (omitted ⏳): My Surveys (no "my pending" list), My Compensation (no own-scoped read), My 360 Evaluations (Fase 7, no endpoint), My Profile/Privacy consent (no query endpoint). |
| Participant chrome | A new **`ParticipantSidebar`** (lighter, task-focused, distinct theme), selected via `manifest.shell`. Same nav-rendering model as `Sidebar` (manifest + `can()` filter) — the genuine differences are the IA (My Tasks / My Home, no admin sections) and the lighter visual treatment. Mirrors the `PlatformSidebar` precedent. NOT a new route group. |
| `leader` DashboardKey | committee was parked on the thin `LeaderDashboard` (key `'leader'`); after this slice committee → `'committee'`, so the `'leader'` key + `LeaderDashboard` component become **dead and are removed** (leader itself uses `'manager'`). |
| Suppression | **Not needed.** Participant landings surface own/assigned operational data (your OKRs, your pending scorecards, your onboarding) — no k-anon-sensitive org aggregates. NO `suppressedValue`. |

---

## Endpoint availability (verified against the access kernel)

**committee (team/evaluator scope) — buildable:**

| Section | Procedure | Returns |
|---|---|---|
| My Panels | `interview.getPendingScorecards` (scope-aware; evaluator arm matches assigned panels cross-team) | `[{ interviewId, status:'pending', interview: { id, candidate:{firstName,lastName,avatar}, vacancy:{id,title}, status } }]` (verify exact shape via tsc) |

**employee (own scope) — buildable:**

| Section | Procedure | Returns / input |
|---|---|---|
| My Performance — OKRs | `performance.listOkrs` (own via `scopeWhereFor('okr')`) | `{ okrs:[{id,title,status,progress,keyResults,...}], nextCursor? }` — input `{ limit?:1..100, status?, ... }` |
| My Performance — coaching | `performance.listCoachingSessions` (own) | list — read input/return shape |
| My Performance — feedback | `performance.listFeedback` (own) | list — read shape |
| My Learning | own learning endpoint (e.g. `learning.getPrePostTestResults` / a my-enrollments query) + `learning.listCourses` (catalog) | read the learning router for the best own-scoped "my learning" data |
| My Onboarding | `onboarding.list` (own/buddy via `scopeWhereFor('onboardingPlan')`) | own plan if present |

**🔴 FORBIDDEN for committee/employee (org-rollups — must NOT be called):** every `*.getDashboardKpis` (`performance`/`engagement`/`compensation`/`ninebox`/`succession`/`learning`/`onboarding`/`monitoring`), `engagement.getEnps`, `recruitmentAnalytics.*`, `dei.*`, `ninebox.listCalibrations`. (All `requireOrgScope` → FORBIDDEN at team/own scope. Same constraint that shaped Slices 2/3.)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/web/lib/nav/manifest.ts` | nav manifests | Add `participantManifest()`, `COMMITTEE_TASKS` + `EMPLOYEE_HOME` sections; set `MANIFESTS.committee` + `.employee`; export a pure `pickSidebarVariant()` helper |
| `apps/web/app/(admin)/sidebar.tsx` | admin sidebar | Export the `Icon` component (or extract to `nav-icon.tsx`) so the participant sidebar reuses it — no behavior change |
| `apps/web/app/(admin)/participant-sidebar.tsx` | **NEW.** Participant chrome | Lighter task-focused sidebar rendering the participant manifest |
| `apps/web/app/(admin)/admin-shell.tsx` | shell scaffold | Accept a `shell` prop; select `ParticipantSidebar` when `shell==='participant'` (via `pickSidebarVariant`) |
| `apps/web/app/(admin)/layout.tsx` | server layout | Compute `shell = manifestFor(roleSlugs).shell` and pass `shell={shell}` to `AdminShell` |
| `apps/web/app/(admin)/dashboard/committee-tasks-dashboard.tsx` | **NEW.** committee landing | "My Tasks" — pending scorecards |
| `apps/web/app/(admin)/dashboard/employee-home-dashboard.tsx` | **NEW.** employee landing (+ sibling panels if >300 lines) | "My Home" — performance / learning / onboarding |
| `apps/web/app/(admin)/dashboard/pick-dashboard.ts` | routing | Add `'committee'`; committee→`'committee'`, employee→`'employee'`; remove dead `'leader'` |
| `apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx` | switch | Add `case 'committee'`; point `case 'employee'` at new dashboard; remove dead `LeaderDashboard` + `case 'leader'` |
| `apps/web/lib/i18n/es.json` + `en.json` | i18n | New `sidebar.*` participant labels + `committeeTasks` + `employeeHome` blocks |
| `tests/nav/manifest.test.ts` | manifest tests | committee/employee = participant shell + sections; `pickSidebarVariant` unit test |
| `tests/dashboard/pick-dashboard.test.ts` | routing tests | committee→committee, employee→employee, no `'leader'` |

---

## Task 1: Participant manifests + sidebar-variant helper

**Files:** Modify `apps/web/lib/nav/manifest.ts`; Modify `es.json` + `en.json`; Test `tests/nav/manifest.test.ts`.

**Context:** `manifest.ts` defines `type Shell = 'admin'|'participant'|'platform'`, `RoleManifest = { shell, landing, sections }`, the section consts (`COMMAND_CENTER`, etc.), `adminManifest(sections) => ({ shell:'admin', landing:'/dashboard', sections })`, and `MANIFESTS`. `manifest.shell` is currently dormant. committee/employee currently use `adminManifest(BASE_ADMIN)`. The no-drift test (`item.module === moduleForPath(item.href)`) + label-resolution test run over all manifests.

- [ ] **Step 1: Add the i18n keys (both locales, identical sets).** In the `sidebar` block of es.json + en.json add (only the ones that don't already exist — `sidebar.performance`/`sidebar.training`/`sidebar.onboarding` already exist and are reused):
  - es: `"myTasks": "Mis Tareas"`, `"myHome": "Mi Espacio"`, `"myPanels": "Mis Paneles"`, `"myPerformance": "Mi Desempeno"`, `"myLearning": "Mi Aprendizaje"`, `"myOnboarding": "Mi Onboarding"`
  - en: `"myTasks": "My Tasks"`, `"myHome": "My Home"`, `"myPanels": "My Panels"`, `"myPerformance": "My Performance"`, `"myLearning": "My Learning"`, `"myOnboarding": "My Onboarding"`
  Validate both JSON parse.

- [ ] **Step 2: Add failing manifest tests.** Append inside `describe('nav manifest', ...)` in `tests/nav/manifest.test.ts`:
```typescript
  it('committee + employee use the participant shell (not admin)', () => {
    expect(MANIFESTS.committee.shell).toBe('participant');
    expect(MANIFESTS.employee.shell).toBe('participant');
    // all other roles stay on the admin shell
    for (const r of ['super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader'] as const)
      expect(MANIFESTS[r].shell).toBe('admin');
  });

  it('committee = My Tasks (panels); employee = My Home (performance/learning/onboarding); no admin/org modules', () => {
    const committeeMods = MANIFESTS.committee.sections.flatMap((s) => s.items.map((i) => i.module));
    expect(committeeMods).toEqual(expect.arrayContaining(['interview']));
    const employeeMods = MANIFESTS.employee.sections.flatMap((s) => s.items.map((i) => i.module));
    expect(employeeMods).toEqual(expect.arrayContaining(['performance', 'learning', 'onboarding']));
    const all = [...committeeMods, ...employeeMods];
    for (const m of ['user', 'billing', 'integration', 'monitoring', 'dei', 'vacancy', 'offer'])
      expect(all, `participant nav should not include ${m}`).not.toContain(m);
  });

  it('pickSidebarVariant: platform > participant > admin', () => {
    expect(pickSidebarVariant(true, 'participant')).toBe('platform');   // platform owner wins
    expect(pickSidebarVariant(false, 'participant')).toBe('participant');
    expect(pickSidebarVariant(false, 'admin')).toBe('admin');
    expect(pickSidebarVariant(false, 'platform')).toBe('admin');        // shell:'platform' unused; admin sidebar by default
  });
```
Add `pickSidebarVariant` to the imports from `'../../apps/web/lib/nav/manifest'` (match the file's existing import path style in this test).

- [ ] **Step 3: Run, verify FAIL.** Run: `npx vitest run tests/nav/manifest.test.ts`

- [ ] **Step 4: Implement.** In `apps/web/lib/nav/manifest.ts`, after `adminManifest` add:
```typescript
const participantManifest = (sections: NavSection[]): RoleManifest => ({ shell: 'participant', landing: '/dashboard', sections });

// committee = interview panels they're assigned to (their real task). Calibrations omitted until a
// scope-aware "my sessions" endpoint ships (D5).
const COMMITTEE_TASKS: NavSection[] = [
  {
    labelKey: 'sidebar.myTasks',
    items: [
      { href: '/recruitment/interviews', labelKey: 'sidebar.myPanels', icon: 'video', module: 'interview' },
    ],
  },
];

// employee = self-service "My Home". Only sections with a real own-scoped endpoint (D5):
// performance, learning, onboarding. Surveys/comp/360/privacy omitted until their backend ships.
const EMPLOYEE_HOME: NavSection[] = [
  {
    labelKey: 'sidebar.myHome',
    items: [
      { href: '/people/performance', labelKey: 'sidebar.myPerformance', icon: 'target', module: 'performance' },
      { href: '/learning', labelKey: 'sidebar.myLearning', icon: 'book', module: 'learning' },
      { href: '/people/onboarding', labelKey: 'sidebar.myOnboarding', icon: 'rocket', module: 'onboarding' },
    ],
  },
];
```
Set the `MANIFESTS` entries (leave all other roles unchanged):
```typescript
  committee: participantManifest(COMMITTEE_TASKS),
  employee: participantManifest(EMPLOYEE_HOME),
```
Add the pure helper (exported), near the bottom with the other exported pure functions:
```typescript
/** Which sidebar chrome to render. Platform owner always wins; participant manifests get the
 *  lighter ParticipantSidebar; everything else gets the admin Sidebar. */
export function pickSidebarVariant(isPlatformOwner: boolean, shell: Shell): 'platform' | 'participant' | 'admin' {
  if (isPlatformOwner) return 'platform';
  if (shell === 'participant') return 'participant';
  return 'admin';
}
```
Confirm each new item's href↔module satisfies `moduleForPath` (all four hrefs are existing BASE_ADMIN paths). No new label key beyond Step 1.

- [ ] **Step 5: Run, verify PASS** (incl. no-drift + label-resolution). Run: `npx vitest run tests/nav/manifest.test.ts`

- [ ] **Step 6: Type-check + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0. Run: `npx vitest run` → green (paste tally).
```bash
git add apps/web/lib/nav/manifest.ts apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json tests/nav/manifest.test.ts
git commit -m "feat(web): participant manifests for committee/employee + pickSidebarVariant helper"
```

---

## Task 2: ParticipantSidebar + shell wiring (activate the participant shell)

**Files:** Modify `apps/web/app/(admin)/sidebar.tsx` (export `Icon`); Create `apps/web/app/(admin)/participant-sidebar.tsx`; Modify `apps/web/app/(admin)/admin-shell.tsx`; Modify `apps/web/app/(admin)/layout.tsx`.

**Context:** `AdminShell` (`admin-shell.tsx:52`) currently does `const SidebarComponent = isPlatformOwner ? PlatformSidebar : Sidebar;` and receives `isPlatformOwner` as a prop from the server `layout.tsx`. We add a `shell` prop the same way and use `pickSidebarVariant`. The regular `Sidebar` renders `computeVisibleSections(manifestFor(roles).sections, can, isLoading)` with the dark `#1F114C` theme; `ParticipantSidebar` mirrors that rendering (so committee/employee see their participant sections) with a lighter theme. `Icon` is a large SVG switch inside `sidebar.tsx` — export it for reuse instead of duplicating.

- [ ] **Step 1: Export `Icon` from `sidebar.tsx`.** Change `function Icon(...)` to `export function Icon(...)`. No other change. Run `cd apps/web && npx tsc --noEmit` → 0 (nothing else breaks).

- [ ] **Step 2: Create `participant-sidebar.tsx`.** A client component with the SAME prop signature as `Sidebar` (`{ userInitials, displayName, expanded, onToggle, ready?, avatar }`). Reuse the nav-rendering model: `const { can, roles, roleLabel, isLoading } = usePermissions(); const VISIBLE = computeVisibleSections(manifestFor(roles).sections, can, isLoading);` and render sections/items with `resolveLabel(t, ...)` + the imported `Icon`, plus the logo + collapse toggle + user/logout footer (copy the structure from `Sidebar`). Use a **lighter, distinct theme** to make the participant shell visually a different surface (e.g. a light/white sidebar — `bg-white border-r border-[#ECECEC]`, dark text `text-[#1F114C]`, active item `bg-[#F2F0F9] text-[#1F114C]`) instead of the dark purple admin chrome. Keep it accessible + responsive (same width classes `w-[240px]`/`w-[72px]`). It's fine that the rendering loop resembles `Sidebar` — the theme + participant manifest are the distinction (this mirrors how `PlatformSidebar` is its own component). Import `Icon` from `'./sidebar'`.

- [ ] **Step 3: Wire `admin-shell.tsx`.** Add a `shell: Shell` prop (import `type { Shell } from '../../lib/nav/manifest'` and `pickSidebarVariant`). Replace line 52:
```typescript
  const variant = pickSidebarVariant(isPlatformOwner, shell);
  const SidebarComponent =
    variant === 'platform' ? PlatformSidebar : variant === 'participant' ? ParticipantSidebar : Sidebar;
```
Import `ParticipantSidebar` from `'./participant-sidebar'`. Add `shell` to the `AdminShell` props type. Everything else in AdminShell stays (navbar, RouteAccessGuard, providers) — participant users keep the same auth/permission/tRPC context; only the sidebar chrome differs.

- [ ] **Step 4: Wire `layout.tsx` (server).** Read the file: it already resolves the user's roles + `isPlatformOwner`. Compute the shell from the role slugs and pass it down:
```typescript
import { manifestFor } from '../../lib/nav/manifest';
// ...where roleSlugs are available (the same place isPlatformOwner is computed):
const shell = manifestFor(roleSlugs).shell;
// ...in the JSX:
<AdminShell ... isPlatformOwner={isPlatformOwner} shell={shell}>
```
If `roleSlugs` isn't already in scope at that point, derive it from the same query that produced `isPlatformOwner` (read the file to see how roles are loaded). Do NOT add a new DB query if the roles are already loaded.

- [ ] **Step 5: Verify + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0.
Run: `npx vitest run` → green.
Run: `cd apps/web && pnpm build && cd ../..` → `✓ Compiled successfully`.
```bash
git add "apps/web/app/(admin)/sidebar.tsx" "apps/web/app/(admin)/participant-sidebar.tsx" "apps/web/app/(admin)/admin-shell.tsx" "apps/web/app/(admin)/layout.tsx"
git commit -m "feat(web): activate the participant shell — ParticipantSidebar selected via manifest.shell"
```

---

## Task 3: CommitteeTasksDashboard ("My Tasks")

**Files:** Create `apps/web/app/(admin)/dashboard/committee-tasks-dashboard.tsx`; Modify `es.json` + `en.json` (add `committeeTasks` block).

**Context:** committee is team/evaluator-scoped. The ONE buildable task source is `interview.getPendingScorecards` (scope-aware → the committee member's assigned pending scorecards). Mirror the `manager-todos.tsx` `ScorecardsToSubmitPanel` pattern (header + list rows with candidate + vacancy, `Skeleton` while loading, `LoadError` on error, `EmptyState` when loaded-empty). NO `suppressedValue`. Do NOT call any `ninebox.*` endpoint (My Calibrations is ⏳ — omitted).

- [ ] **Step 1: Add the `committeeTasks` i18n block (both locales, identical keys).**
```json
"committeeTasks": {
  "title": "Mis Tareas",
  "subtitle": "Lo que requiere tu atencion",
  "pendingScorecards": "Scorecards Pendientes",
  "panelsTitle": "Entrevistas que Requieren tu Scorecard",
  "noScorecards": "No tienes scorecards pendientes",
  "loadError": "No se pudieron cargar los datos"
}
```
en (same keys): "My Tasks" / "What needs your attention" / "Pending Scorecards" / "Interviews Needing Your Scorecard" / "No pending scorecards" / "Couldn't load data". Validate JSON.

- [ ] **Step 2: Build `committee-tasks-dashboard.tsx`.** Export `function CommitteeTasksDashboard()`. `'use client'`; imports `trpc`, `useI18n`, `{ KpiCard, KpiCardSkeleton, EmptyState, Skeleton }`, `LoadError`, `Link`. Query:
```typescript
const scorecards = trpc.interview.getPendingScorecards.useQuery();
```
(Verify the real return shape via tsc — fields like `interview.candidate.{firstName,lastName}` + `interview.vacancy.title`, keyed by the assignment id; reuse exactly what `manager-todos.tsx` does for this same endpoint.) Layout: container + header (`t.committeeTasks.title`/`.subtitle`); a single KPI (`Pending Scorecards` = count of `scorecards.data`, `KpiCardSkeleton` while loading, `LoadError` on error, highlight if > 0); then the **Panels** white card (`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5`) listing the pending scorecards (candidate + vacancy, each row a `<Link href="/recruitment/interviews">` — or the interview detail route if it exists), with `Skeleton` rows while loading, `LoadError` on error, `EmptyState` (`t.committeeTasks.noScorecards`) when loaded-empty. Use ONLY `t.committeeTasks.*`. Keep < 300 lines.

- [ ] **Step 3: Type-check.** `cd apps/web && npx tsc --noEmit && cd ../..` → 0. `npx vitest run` → green.

- [ ] **Step 4: Commit.**
```bash
git add "apps/web/app/(admin)/dashboard/committee-tasks-dashboard.tsx" apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json
git commit -m "feat(web): build committee My Tasks dashboard (assigned panels / pending scorecards)"
```

---

## Task 4: EmployeeHomeDashboard ("My Home")

**Files:** Create `apps/web/app/(admin)/dashboard/employee-home-dashboard.tsx` (+ sibling panels if >300 lines); Modify `es.json` + `en.json` (add `employeeHome` block).

**Context:** employee is `own`-scoped. Buildable sections: My Performance (`performance.listOkrs`, `listCoachingSessions`, `listFeedback` — all auto-filtered to the caller via `scopeWhereFor`), My Learning (own learning endpoint), My Onboarding (`onboarding.list` → own plan if present). NO org-rollup `*.getDashboardKpis` (FORBIDDEN). NO `suppressedValue`. Mirror the ManagerDashboard/section structure. READ the real routers for exact names/inputs/shapes (tsc is the gate); adapt to real types, no casts.

- [ ] **Step 1: Add the `employeeHome` i18n block (both locales, identical keys).**
```json
"employeeHome": {
  "title": "Mi Espacio",
  "subtitle": "Tu desarrollo y tus pendientes",
  "performance": "Mi Desempeno",
  "learning": "Mi Aprendizaje",
  "onboarding": "Mi Onboarding",
  "activeOkrs": "OKRs Activos",
  "avgProgress": "progreso promedio",
  "coachingSessions": "Sesiones de Coaching",
  "feedback": "Feedback",
  "myOkrsTitle": "Mis OKRs",
  "noOkrs": "Aun no tienes OKRs asignados",
  "enrolledCourses": "Cursos Inscritos",
  "onboardingProgress": "Progreso de Onboarding",
  "noOnboarding": "No tienes un plan de onboarding activo",
  "loadError": "No se pudieron cargar los datos"
}
```
en (same keys): "My Home" / "Your growth and your to-dos" / "My Performance" / "My Learning" / "My Onboarding" / "Active OKRs" / "avg progress" / "Coaching Sessions" / "Feedback" / "My OKRs" / "No OKRs assigned yet" / "Enrolled Courses" / "Onboarding Progress" / "No active onboarding plan" / "Couldn't load data". Validate JSON.

- [ ] **Step 2: Read the real own-scoped endpoints.** Before coding, read `packages/api/src/routers/performance/okrs.ts`, `.../performance/coaching.ts`, `.../performance/feedback.ts` (or wherever `listFeedback` lives), the `learning` router (find the own-scoped "my learning/enrollments/results" query), and the `onboarding` router (`list`). Note the exact procedure names, required `.input` (zod), and return shapes. These auto-filter to the caller — do NOT pass a `userId` to widen.

- [ ] **Step 3: Build `employee-home-dashboard.tsx`.** Export `function EmployeeHomeDashboard()`. Three sections, each handling loading/error/empty independently:
  - **My Performance** (header `t.employeeHome.performance`): KPI strip — Active OKRs (count of active in `listOkrs` + avg progress subtitle), Coaching Sessions (count), Feedback (count). Plus a **My OKRs** list (title + a progress indicator per OKR; `EmptyState` `noOkrs` when none).
  - **My Learning** (header `t.employeeHome.learning`): a count/summary from the own learning endpoint (e.g. enrolled courses / results); `EmptyState` if none.
  - **My Onboarding** (header `t.employeeHome.onboarding`): if `onboarding.list` returns a plan for the caller, show its progress; else `EmptyState` `noOnboarding` (it's conditional on being a new-hire).
  Reuse `KpiCard`/`KpiCardSkeleton`/`EmptyState`/`Skeleton`/`LoadError`. Use ONLY `t.employeeHome.*`. **Keep each file < 300 lines** — if the orchestrator exceeds it, extract `my-performance-panel.tsx` / `my-learning-panel.tsx` / `my-onboarding-panel.tsx` siblings and report the split.

- [ ] **Step 4: Type-check.** `cd apps/web && npx tsc --noEmit && cd ../..` → 0 (proves every query name/input/field resolves). Fix mismatches to real types (no casts). `npx vitest run` → green. If an endpoint genuinely can't be called from an employee `own` context, report BLOCKED with details.

- [ ] **Step 5: Commit.**
```bash
git add "apps/web/app/(admin)/dashboard/employee-home-dashboard.tsx" apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json
# + sibling panels if split
git commit -m "feat(web): build employee My Home dashboard (performance/learning/onboarding, own-scoped)"
```

---

## Task 5: Route committee → My Tasks, employee → My Home (remove dead leader key)

**Files:** Modify `apps/web/app/(admin)/dashboard/pick-dashboard.ts`; Modify `recruitment-dashboard.tsx`; Test `tests/dashboard/pick-dashboard.test.ts`.

**Current state (post-Slice-3):** `DashboardKey = 'org' | 'hrExec' | 'unit' | 'recruiter' | 'manager' | 'leader' | 'employee'`. `pickPrimaryDashboard`: super_admin→org, hr_admin→hrExec, hrbp→unit, recruiter→recruiter, leader→manager, committee→`'leader'`, else `'employee'`. The switch in `recruitment-dashboard.tsx` has a local `LeaderDashboard` component (the thin one committee was parked on) at `case 'leader'`, and `EmployeeDashboard` (thin QuickActions) at the `'employee'` default-ish case, plus the `const _exhaustive: never = key` guard.

- [ ] **Step 1: Update the routing test.** In `tests/dashboard/pick-dashboard.test.ts`:
```typescript
  it('committee → committee (My Tasks); employee → employee (My Home)', () => {
    expect(pickPrimaryDashboard(['committee'])).toBe('committee');
    expect(pickPrimaryDashboard(['employee'])).toBe('employee');
  });
  it('admin-tier still outranks participants', () => {
    expect(pickPrimaryDashboard(['committee', 'recruiter'])).toBe('recruiter');
    expect(pickPrimaryDashboard(['leader', 'committee'])).toBe('manager');
  });
```
Replace any existing assertion that asserted `committee → 'leader'`. KEEP super_admin/hr_admin/hrbp/recruiter/leader cases. Confirm no remaining assertion references the `'leader'` *dashboard key* for committee.

- [ ] **Step 2: Run, verify FAIL** (committee currently → 'leader'). Run: `npx vitest run tests/dashboard/pick-dashboard.test.ts`

- [ ] **Step 3: Update `pick-dashboard.ts`.** Add `'committee'`, drop `'leader'`:
```typescript
export type DashboardKey = 'org' | 'hrExec' | 'unit' | 'recruiter' | 'manager' | 'committee' | 'employee';

export function pickPrimaryDashboard(roleSlugs: readonly string[]): DashboardKey {
  if (roleSlugs.includes('super_admin')) return 'org';
  if (roleSlugs.includes('hr_admin')) return 'hrExec';
  if (roleSlugs.includes('hrbp')) return 'unit';
  if (roleSlugs.includes('recruiter')) return 'recruiter';
  if (roleSlugs.includes('leader')) return 'manager';
  if (roleSlugs.includes('committee')) return 'committee';
  return 'employee';
}
```
Update the comment (committee now has its own participant landing; `'leader'` key retired).

- [ ] **Step 4: Wire the switch + remove dead code.** In `recruitment-dashboard.tsx`: import `CommitteeTasksDashboard` from `'./committee-tasks-dashboard'` and `EmployeeHomeDashboard` from `'./employee-home-dashboard'`. Update the switch:
```typescript
  switch (pickPrimaryDashboard(roleSlugs)) {
    case 'org': return <OrgCommandCenter />;
    case 'hrExec': return <HrExecDashboard />;
    case 'unit': return <UnitHealthDashboard />;
    case 'recruiter': return <RecruiterDashboard />;
    case 'manager': return <ManagerDashboard />;
    case 'committee': return <CommitteeTasksDashboard />;
    default: return <EmployeeHomeDashboard />;
  }
```
Keep the `const key = pickPrimaryDashboard(roleSlugs)` binding + the `const _exhaustive: never = key` guard in `default`. **Remove the now-dead `LeaderDashboard` local component and the old thin `EmployeeDashboard`** (both replaced) — but FIRST `grep -rn "LeaderDashboard\|EmployeeDashboard" apps/web --include=*.tsx` to confirm they aren't imported elsewhere; if either is referenced outside this file, leave it and report. Remove any now-unused icon/QuickActions helpers that only those two components used (grep to confirm unused before deleting).

- [ ] **Step 5: Verify + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 (the `never` guard confirms all 7 keys handled).
Run: `npx vitest run` → green (paste tally).
Run: `cd apps/web && pnpm build && cd ../..` → `✓ Compiled successfully`.
```bash
git add "apps/web/app/(admin)/dashboard/pick-dashboard.ts" "apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx" tests/dashboard/pick-dashboard.test.ts
git commit -m "feat(web): route committee to My Tasks and employee to My Home (retire dead leader dashboard)"
```

---

## Task 6: Verification

**Files:** none.

- [ ] **Step 1: Gate.** Run: `cd apps/web && npx tsc --noEmit && cd ../.. && pnpm --filter @tims/api exec tsc --noEmit && npx vitest run` → tsc 0 (web+api); full suite green.
- [ ] **Step 2: Build.** Run: `cd apps/web && pnpm build && cd ../..` → `✓ Compiled successfully`.
- [ ] **Step 3: Participant blocked-endpoint grep (must be NONE).** Grep `committee-tasks-dashboard.tsx` + `employee-home-dashboard.tsx` (+ siblings) for org-only procedures: `getDashboardKpis`, `getExecutiveKpis`, `getEnps`, `recruitmentAnalytics`, `dei.`, `listCalibrations`, `suppress` → must be EMPTY. Committee uses only `interview.getPendingScorecards`; employee only the own-scoped performance/learning/onboarding endpoints.
- [ ] **Step 4: Shell-selection check.** Confirm `pickSidebarVariant` returns `'participant'` for committee/employee and `'admin'` for the rest (unit test green), and that `admin-shell.tsx` selects `ParticipantSidebar` accordingly. Confirm `layout.tsx` passes a real `shell` (not hardcoded).
- [ ] **Step 5: Parity (static).** Confirm: committee → My Tasks + participant chrome; employee → My Home + participant chrome; super_admin/hr_admin/hrbp/recruiter/leader unchanged (admin shell, same landings). The `'leader'` DashboardKey + thin LeaderDashboard are gone with no dangling references. Only committee + employee changed.
- [ ] **Step 6: `/gate`.** Run: `/gate` → green.
- [ ] **Step 7 (optional, dev server):** Log in as committee → lands on My Tasks (pending scorecards), participant (light) sidebar showing My Tasks only, no admin sections, no console FORBIDDEN. Log in as employee → lands on My Home (OKRs/learning/onboarding), participant sidebar showing My Home only, no FORBIDDEN.

---

## Self-Review

**Spec coverage (§1 two shells + §3 participant):** participant shell activated (manifest.shell + ParticipantSidebar + layout wiring) → Tasks 1–2. committee "My Tasks" (My Panels) → Task 3. employee "My Home" (My Performance/Learning/Onboarding) → Task 4. Routing both + retire dead leader dash → Task 5. Verification incl. the participant blocked-endpoint invariant → Task 6. Omitted per D5 (no callable endpoint): committee My Calibrations; employee My Surveys/Compensation/360/Privacy — these light up in the unbuilt track when their backends ship. Grants unchanged (Slice 0).

**Placeholder scan:** ParticipantSidebar's exact JSX mirrors the quoted `Sidebar` structure with a stated lighter theme; the two landings are specified by data-source + reused primitive + read-shape-at-impl (tsc gate), mirroring the Slice 2/3 dashboards. The employee own-scoped endpoint names/shapes are read-at-implementation (Task 4 Step 2) because several live in sub-routers — tsc is the gate. Manifests, helper, routing, and tests are fully specified.

**Type consistency:** `DashboardKey` gains `'committee'`, drops `'leader'`; the `never` guard + switch + tests enforce exhaustiveness. `pickSidebarVariant(isPlatformOwner, shell)` is pure + unit-tested and consumed by `admin-shell.tsx`. `manifest.shell` (dormant) is now read in `layout.tsx` + the helper. Every participant manifest item's module satisfies no-drift; every labelKey resolves.

**Risk:** no server/db/grant changes; participant roles keep the admin route group's auth/permission/tRPC context (only chrome + landing change); committee/employee call only own/assigned-scoped endpoints (Task 6 Step 3 enforces). The one structural change is the sidebar swap, gated by a pure tested helper + tsc + build. Dead-code removal (`'leader'` key + thin LeaderDashboard) is grep-guarded. No regression to the five admin-shell roles.

---

*Next after Slice 4 ships: the role-experience rebuild's built-feature scope is COMPLETE (all 7 roles have purpose-built shells + landings). Slice 5+ = the unbuilt feature track (360 evals, commitments, recognition) + lighting up the omitted participant sections (My Calibrations, My Surveys, My Compensation, Privacy) as those backends ship.*
