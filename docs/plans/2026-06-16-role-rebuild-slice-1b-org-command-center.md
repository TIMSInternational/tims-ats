# Role Rebuild — Slice 1b (Org Command Center) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `super_admin` a purpose-built **Org Command Center** landing — a lean, cross-domain org-health exec view (recruiting + people + performance + culture) — instead of the recruiter funnel they wrongly land on today, reusing existing org-scoped endpoints (no new aggregates) and rendering `N/D` for min-5-suppressed sensitive metrics.

**Architecture:** A pure dashboard-router function (`pickPrimaryDashboard(roleSlugs)`) replaces the inline role-bucketing in `recruitment-dashboard.tsx` and routes `super_admin → 'org'`. A new `OrgCommandCenter` client component composes 4 existing tRPC queries into an org-health KPI strip + org recruiting funnel + performance panel + culture pulse, reusing `KpiCard`/`Skeleton`/`EmptyState`. A pure `suppressedValue()` helper renders `N/D` for suppressed (min-5) values.

**Tech Stack:** Next.js 15 (client components), React, tRPC, TypeScript (strict), Vitest. i18n via `apps/web/lib/i18n` (Spanish default). Tests at repo-root `tests/`.

**Source of truth:** `ROLE-EXPERIENCE-REBUILD-SPEC.md` §3.1 (super_admin Org Command Center) + the Slice 1a plan's §1b outline. Slices 0 + 1a are live in prod.

---

## Scoping decisions (locked with Federico, 2026-06-16)

| Decision | Resolution |
|---|---|
| Lean v1 tile composition | **Full cross-domain rollup** — org-health strip + recruiting funnel + performance panel + culture pulse |
| New endpoints | **None.** All tiles reuse existing org-scoped procedures. |
| `committee` mis-bucket | **Left as-is** (still → LeaderDashboard) until Slice 4 builds its real "My Tasks" participant landing. Re-routing it now would be *worse* (EmployeeDashboard is wrong for a panelist). Only `super_admin` re-routes in 1b. |
| Sensitive tiles for a small org | Render `N/D` when min-5-suppressed (correct per Slice 6). The real TIMS org is small → eNPS/response-rate/comp tiles will often show `N/D`; other prod orgs may be larger. |
| Manifest change | **None** — `MANIFESTS.super_admin.landing` is already `/dashboard`; the dashboard page renders `OrgCommandCenter` for super_admin via the bucketing fix. |

---

## Endpoints reused (all exist; super_admin has org scope → all `requireOrgScope` pass)

| Tile data | Procedure | Returns (relevant fields) | Min-5 |
|---|---|---|---|
| Headcount, open vacancies, active surveys, open alerts | `monitoring.getExecutiveKpis` | `{ totalEmployees, activeVacancies, activeSurveys, openAlerts, pendingAdjustments\|null, pendingAdjustmentsSuppressed }` | partial |
| Active OKRs, OKR progress, coaching, commitments | `performance.getDashboardKpis` | `{ activeOkrs, averageOkrProgress, scheduledSessions, completedSessions, pendingCommitments, completedCommitments, commitmentCompletionRate }` | no |
| Org recruiting funnel | `recruitmentAnalytics.getFunnel` | `{ funnel: [{ name, order, count, percentage }], totalApplications, totalHired, conversionRate }` | no |
| eNPS, culture pulse | `engagement.getEnps` + `engagement.getDashboardKpis` | enps: `{ enps\|null, suppressed, period }`; dash: `{ activeSurveys, totalResponses\|null, totalResponsesSuppressed, actionPlansOpen, highRiskCount }` | yes |

`OrgCommandCenter` is rendered ONLY for super_admin (privileged bypass → all `can()`/scope checks pass), so all four queries succeed.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/web/lib/dashboard/suppress.ts` | **NEW.** Pure `suppressedValue(value, suppressed, ndLabel)` → `N/D` or the number | Create |
| `apps/web/app/(admin)/dashboard/pick-dashboard.ts` | **NEW.** Pure `pickPrimaryDashboard(roleSlugs) → DashboardKey` | Create |
| `apps/web/app/(admin)/dashboard/org-command-center.tsx` | **NEW.** The Org Command Center client component | Create |
| `apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx` | Role→dashboard switch | Use `pickPrimaryDashboard`; route `'org' → OrgCommandCenter` |
| `apps/web/lib/i18n/es.json` + `en.json` | i18n | Add `orgCommandCenter` block + `common.notDisclosed` if missing |
| `tests/dashboard/suppress.test.ts` | **NEW.** Pins `suppressedValue` | Create |
| `tests/dashboard/pick-dashboard.test.ts` | **NEW.** Pins the role routing (super_admin→org; committee unchanged) | Create |

---

## Task 1: Pure `suppressedValue` helper + `N/D` i18n key

**Files:** Create `apps/web/lib/dashboard/suppress.ts`; Modify `apps/web/lib/i18n/es.json` + `en.json`; Test `tests/dashboard/suppress.test.ts`.

- [ ] **Step 1: Write the failing test.** Create `tests/dashboard/suppress.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { suppressedValue } from '../../apps/web/lib/dashboard/suppress';

describe('suppressedValue', () => {
  it('renders the N/D label when suppressed', () => {
    expect(suppressedValue(null, true, 'N/D')).toBe('N/D');
    expect(suppressedValue(3, true, 'N/D')).toBe('N/D'); // suppressed wins even if a value leaked
  });
  it('renders the number when not suppressed', () => {
    expect(suppressedValue(42, false, 'N/D')).toBe('42');
    expect(suppressedValue(0, false, 'N/D')).toBe('0'); // 0 is a real, non-sensitive value
    expect(suppressedValue(-30, false, 'N/D')).toBe('-30'); // eNPS can be negative
  });
  it('renders an em-dash placeholder when value is missing and not suppressed (loading/empty)', () => {
    expect(suppressedValue(null, false, 'N/D')).toBe('—');
    expect(suppressedValue(undefined, false, 'N/D')).toBe('—');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (module not found). Run: `npx vitest run tests/dashboard/suppress.test.ts`

- [ ] **Step 3: Create the pure helper** `apps/web/lib/dashboard/suppress.ts`:
```typescript
// Render a min-5-suppressible aggregate value. Suppressed (1..4 population) → the
// N/D label (k-anonymity, Wave 2.5 slice 6). 0 is a real value (empty, not sensitive).
// null/undefined with no suppression = not-yet-loaded → an em-dash placeholder.
export function suppressedValue(
  value: number | null | undefined,
  suppressed: boolean,
  ndLabel: string,
): string {
  if (suppressed) return ndLabel;
  return value == null ? '—' : String(value);
}
```

- [ ] **Step 4: Run, verify it PASSES.** Run: `npx vitest run tests/dashboard/suppress.test.ts`

- [ ] **Step 5: Add i18n keys.** In `apps/web/lib/i18n/es.json` and `en.json`, confirm/add under the `common` block a `notDisclosed` key (used as the `N/D` label):
  - es: `"notDisclosed": "N/D"`
  - en: `"notDisclosed": "N/D"`
  Grep first: `grep -n "notDisclosed" apps/web/lib/i18n/es.json` — if it already exists, skip. (It is referenced from the component in Task 2 as `t.common.notDisclosed`.) Also add the `orgCommandCenter` block now (used in Task 2) to BOTH files, mirroring keys; values:
```json
"orgCommandCenter": {
  "title": "Centro de Mando",
  "subtitle": "Salud de la organizacion",
  "headcount": "Headcount",
  "activeEmployees": "colaboradores activos",
  "openVacancies": "Vacantes Abiertas",
  "activeOkrs": "OKRs Activos",
  "avgProgress": "progreso promedio",
  "enps": "eNPS",
  "activeSurveys": "Encuestas Activas",
  "openAlerts": "Alertas Abiertas",
  "recruitingFunnel": "Embudo de Reclutamiento",
  "performance": "Desempeno",
  "coachingSessions": "Sesiones de Coaching",
  "commitmentRate": "Cumplimiento de Compromisos",
  "culturePulse": "Pulso de Cultura",
  "responseRate": "Respuestas",
  "highRisk": "Areas en Riesgo",
  "actionPlans": "Planes de Accion",
  "noData": "Sin datos suficientes"
}
```
(en values: "Command Center" / "Organization health" / "Headcount" / "active employees" / "Open Vacancies" / "Active OKRs" / "avg progress" / "eNPS" / "Active Surveys" / "Open Alerts" / "Recruiting Funnel" / "Performance" / "Coaching Sessions" / "Commitment Completion" / "Culture Pulse" / "Responses" / "At-Risk Areas" / "Action Plans" / "Not enough data".)

- [ ] **Step 6: Type-check + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors (confirms the new i18n keys are valid in the typed message object).
```bash
git add apps/web/lib/dashboard/suppress.ts apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json tests/dashboard/suppress.test.ts
git commit -m "feat(web): add suppressedValue (N/D) helper + org-command-center i18n keys"
```

---

## Task 2: The `OrgCommandCenter` component

**Files:** Create `apps/web/app/(admin)/dashboard/org-command-center.tsx`.

This is a client dashboard component. Mirror the established `RecruiterDashboard` patterns (same file, `recruitment-dashboard.tsx`): the container `<div className="h-full flex flex-col overflow-hidden p-6"><div className="flex-1 min-h-0 overflow-y-auto">…`, the header (`text-lg font-bold text-[#1F114C]`), reused `KpiCard`/`KpiCardSkeleton` from `'../../../components'`, the responsive section layout `flex flex-col md:flex-row gap-4 mb-6`, and `const { t } = useI18n();`.

- [ ] **Step 1: Create the component.** Create `apps/web/app/(admin)/dashboard/org-command-center.tsx`:

Structure (compose exactly these three sections; use the listed queries and reused primitives):

```typescript
'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../components';
import { suppressedValue } from '../../../lib/dashboard/suppress';

export function OrgCommandCenter() {
  const { t } = useI18n();
  const occ = t.orgCommandCenter;
  const nd = t.common.notDisclosed;

  const exec = trpc.monitoring.getExecutiveKpis.useQuery();
  const perf = trpc.performance.getDashboardKpis.useQuery();
  const funnel = trpc.recruitmentAnalytics.getFunnel.useQuery();
  const enps = trpc.engagement.getEnps.useQuery();
  const culture = trpc.engagement.getDashboardKpis.useQuery();

  const kpisLoading = exec.isLoading || perf.isLoading || enps.isLoading;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{occ.title}</h1>
          <span className="text-[13px] text-[#585858]">{occ.subtitle}</span>
        </div>

        {/* SECTION 1 — Org-health KPI strip (6 cards) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {kpisLoading ? (
            Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard label={occ.headcount} value={exec.data?.totalEmployees ?? 0} subtitle={occ.activeEmployees} icon={<span />} iconBg="bg-blue-50" />
              <KpiCard label={occ.openVacancies} value={exec.data?.activeVacancies ?? 0} icon={<span />} iconBg="bg-green-50" />
              <KpiCard label={occ.activeOkrs} value={perf.data?.activeOkrs ?? 0} subtitle={`${perf.data?.averageOkrProgress ?? 0}% ${occ.avgProgress}`} icon={<span />} iconBg="bg-violet-50" />
              <KpiCard label={occ.enps} value={suppressedValue(enps.data?.enps, enps.data?.suppressed ?? false, nd)} icon={<span />} iconBg="bg-amber-50" />
              <KpiCard label={occ.activeSurveys} value={exec.data?.activeSurveys ?? 0} icon={<span />} iconBg="bg-cyan-50" />
              <KpiCard label={occ.openAlerts} value={exec.data?.openAlerts ?? 0} icon={<span />} iconBg="bg-red-50" highlight={(exec.data?.openAlerts ?? 0) > 0} />
            </>
          )}
        </div>

        {/* SECTION 2 — Recruiting funnel (left) + Performance panel (right) */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <OrgFunnel data={funnel.data} loading={funnel.isLoading} title={occ.recruitingFunnel} />
          <PerformancePanel data={perf.data} loading={perf.isLoading} title={occ.performance} labels={occ} />
        </div>

        {/* SECTION 3 — Culture pulse */}
        <CulturePulse dash={culture.data} loading={culture.isLoading} nd={nd} title={occ.culturePulse} labels={occ} />
      </div>
    </div>
  );
}
```

Then implement the three local sub-components in the SAME file (keep the file under the 300-line component limit — if it would exceed, extract to sibling files `org-funnel.tsx`, etc., and report):

- **`OrgFunnel({ data, loading, title })`** — a white card `w-full md:flex-[65] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]`. Renders horizontal funnel bars from `data.funnel` (each `{ name, count, percentage }`), mirroring `pipeline-funnel.tsx`'s bar visual (a labeled row + a proportional colored bar width `${percentage}%`). While `loading`, render 5 skeleton bars (`<Skeleton className="h-8 w-full" />` rows). If `!data || data.funnel.length === 0`, render `<EmptyState icon={<span />} message={title} description={occ.noData} />`. Show `data.conversionRate` and `data.totalHired` in the header.

- **`PerformancePanel({ data, loading, title, labels })`** — a white card `w-full md:flex-[35] bg-white rounded-xl p-5 …`. Renders a small list of stat rows from `performance.getDashboardKpis`: Coaching sessions (`scheduledSessions`/`completedSessions`), Commitment completion (`commitmentCompletionRate`%), Active OKRs (`activeOkrs`). While `loading`, 3 skeleton rows. No min-5 (these aren't sensitive).

- **`CulturePulse({ dash, loading, nd, title, labels })`** — a full-width white card. Three stat tiles: Response rate (`suppressedValue(dash?.totalResponses, dash?.totalResponsesSuppressed ?? false, nd)`), At-risk areas (`dash?.highRiskCount ?? 0`), Action plans open (`dash?.actionPlansOpen ?? 0`). While `loading`, skeletons. This is the tile most likely to show `N/D` for the small TIMS org — that is correct.

Use `t.orgCommandCenter.*` for every label (no hardcoded strings — frontend rule). For icons, a simple colored dot/placeholder `<span />` inside the `KpiCard` icon slot is acceptable for lean v1 (KpiCard requires an `icon` prop); do NOT block on bespoke icons.

- [ ] **Step 2: Type-check.** Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors. This confirms every tRPC query name + return-field access is valid against the real routers (`monitoring.getExecutiveKpis`, `performance.getDashboardKpis`, `recruitmentAnalytics.getFunnel`, `engagement.getEnps`, `engagement.getDashboardKpis`). If a field name is wrong, tsc names it — fix to match the actual router output type (use `inferRouterOutputs` shapes; do NOT cast).

- [ ] **Step 3: Commit.**
```bash
git add apps/web/app/(admin)/dashboard/org-command-center.tsx
git commit -m "feat(web): build Org Command Center — cross-domain org-health exec landing (super_admin)"
```

---

## Task 3: Route super_admin → Org Command Center (pure bucketing fn)

**Files:** Create `apps/web/app/(admin)/dashboard/pick-dashboard.ts`; Modify `apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx`; Test `tests/dashboard/pick-dashboard.test.ts`.

- [ ] **Step 1: Write the failing test.** Create `tests/dashboard/pick-dashboard.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { pickPrimaryDashboard } from '../../apps/web/app/(admin)/dashboard/pick-dashboard';

describe('pickPrimaryDashboard', () => {
  it('super_admin → org command center', () => {
    expect(pickPrimaryDashboard(['super_admin'])).toBe('org');
    expect(pickPrimaryDashboard(['super_admin', 'recruiter'])).toBe('org'); // super_admin wins
  });
  it('hr_admin / recruiter / hrbp → recruiter dashboard', () => {
    expect(pickPrimaryDashboard(['hr_admin'])).toBe('recruiter');
    expect(pickPrimaryDashboard(['recruiter'])).toBe('recruiter');
    expect(pickPrimaryDashboard(['hrbp'])).toBe('recruiter');
  });
  it('leader → leader dashboard', () => {
    expect(pickPrimaryDashboard(['leader'])).toBe('leader');
  });
  it('committee stays on leader dashboard for now (Slice 4 gives it My Tasks)', () => {
    expect(pickPrimaryDashboard(['committee'])).toBe('leader');
  });
  it('employee (or unknown) → employee dashboard', () => {
    expect(pickPrimaryDashboard(['employee'])).toBe('employee');
    expect(pickPrimaryDashboard([])).toBe('employee');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (module not found). Run: `npx vitest run tests/dashboard/pick-dashboard.test.ts`

- [ ] **Step 3: Create the pure module** `apps/web/app/(admin)/dashboard/pick-dashboard.ts` (no React — importable in node):
```typescript
export type DashboardKey = 'org' | 'recruiter' | 'leader' | 'employee';

// super_admin removed from RECRUITER_ROLES → gets its own Org Command Center.
// committee stays under LEADER_ROLES until Slice 4 builds its participant "My Tasks".
const RECRUITER_ROLES = ['hr_admin', 'recruiter', 'hrbp'];
const LEADER_ROLES = ['leader', 'committee'];

export function pickPrimaryDashboard(roleSlugs: readonly string[]): DashboardKey {
  if (roleSlugs.includes('super_admin')) return 'org';
  if (roleSlugs.some((r) => RECRUITER_ROLES.includes(r))) return 'recruiter';
  if (roleSlugs.some((r) => LEADER_ROLES.includes(r))) return 'leader';
  return 'employee';
}
```

- [ ] **Step 4: Run, verify it PASSES.** Run: `npx vitest run tests/dashboard/pick-dashboard.test.ts`

- [ ] **Step 5: Wire `recruitment-dashboard.tsx`.** Read it first. Replace the current `RECRUITER_ROLES`/`LEADER_ROLES` consts (lines ~14-15) and the `RecruitmentDashboard` branching (lines ~17-28) with a call to the pure fn:
```typescript
import { pickPrimaryDashboard } from './pick-dashboard';
import { OrgCommandCenter } from './org-command-center';
// ... (delete the two local role-arrays)

export function RecruitmentDashboard({ roleSlugs }: RecruitmentDashboardProps) {
  switch (pickPrimaryDashboard(roleSlugs)) {
    case 'org': return <OrgCommandCenter />;
    case 'recruiter': return <RecruiterDashboard />;
    case 'leader': return <LeaderDashboard />;
    default: return <EmployeeDashboard />;
  }
}
```
Leave `RecruiterDashboard`, `LeaderDashboard`, `EmployeeDashboard`, `QuickActions`, and all other code in the file unchanged.

- [ ] **Step 6: Verify + commit.**
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors.
Run: `npx vitest run` → full suite green (paste tally).
```bash
git add apps/web/app/(admin)/dashboard/pick-dashboard.ts apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx tests/dashboard/pick-dashboard.test.ts
git commit -m "feat(web): route super_admin to the Org Command Center (committee unchanged until Slice 4)"
```

---

## Task 4: Verification

**Files:** none (verification only).

- [ ] **Step 1: Gate.** Run: `cd apps/web && npx tsc --noEmit && cd ../.. && pnpm --filter @tims/api exec tsc --noEmit && npx vitest run` → tsc 0 (web+api); full suite green.

- [ ] **Step 2: Production build.** Run: `cd apps/web && pnpm build && cd ../..` → `✓ Compiled successfully`. Proves the new component + its tRPC calls type-resolve and bundle.

- [ ] **Step 3: Routing parity (static).** Confirm via `pick-dashboard.ts` + the dashboard page: super_admin → OrgCommandCenter; hr_admin/recruiter/hrbp → RecruiterDashboard (unchanged); leader + committee → LeaderDashboard (unchanged); employee → EmployeeDashboard (unchanged). Only super_admin's landing changed.

- [ ] **Step 4: `/gate`.** Run: `/gate` → green.

- [ ] **Step 5 (optional, if a dev server is available): live spot-check.** Log in as super_admin → land on Org Command Center; confirm the 6-card strip, funnel, performance panel, and culture pulse render; confirm sensitive tiles show `N/D` (not 0 or a number) when the org is below the min-5 floor.

---

## Self-Review

**Spec coverage:** super_admin Org Command Center (cross-domain rollup) → Tasks 2+3. min-5 `N/D` → Task 1 + the suppressed tiles. Reuse existing endpoints (no new aggregates) → all 4 queries are existing procedures. committee unchanged (decision) → `pick-dashboard` test pins it. Manifest unchanged (landing already `/dashboard`) → confirmed.

**Placeholder scan:** the component's sub-component bodies (OrgFunnel/PerformancePanel/CulturePulse) are specified by data-source + reused primitive + layout class rather than line-by-line JSX — this is a UI build that mirrors the fully-quoted `RecruiterDashboard`/`pipeline-funnel` patterns; the pure logic (suppressedValue, pickPrimaryDashboard, the KPI-strip mapping) is fully specified and tested. No `TODO`/`TBD`.

**Type consistency:** `DashboardKey` ('org'|'recruiter'|'leader'|'employee') defined in Task 3, switched on identically in `recruitment-dashboard.tsx`. `suppressedValue(value, suppressed, ndLabel)` signature consistent across Task 1 + Task 2 call sites. tRPC procedure names verified against the exploration (`monitoring.getExecutiveKpis`, `performance.getDashboardKpis`, `recruitmentAnalytics.getFunnel`, `engagement.getEnps`, `engagement.getDashboardKpis`) — Task 2 Step 2's tsc is the gate that they resolve.

**Risk:** the component touches no server code and is rendered only for super_admin; worst case is a wrong field-name access caught by tsc. No regression to other roles (routing for non-super_admin is unchanged).

---

*Next after 1b ships: Slice 2 (leader manager-cockpit — My Hiring / My Team two-worlds).*
