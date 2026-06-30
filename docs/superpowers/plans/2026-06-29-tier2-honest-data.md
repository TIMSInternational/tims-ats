# Tier-2 "Honest Data" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every fabricated value surfaced as real (Learning random progress, Platform-Health hardcoded metrics, Team-Intelligence demo KPIs/panels) with either the real computed metric (where data exists + is a cheap aggregate) or an honest empty-state / `N/D`.

**Architecture:** Thin per-site changes following existing patterns. Real metrics = small Prisma aggregates added to existing tRPC queries (no new routers). Honest-unavailable = `N/D` string for scalar KPI/metric values + the existing `EmptyState` component for whole panels. Fabricated trend chips are deleted outright. All new strings via `t.*` in both locales.

**Tech Stack:** Next.js 15 App Router, tRPC + react-query, Prisma (`tenantDb`), Tailwind 4, TypeScript strict, Vitest.

## Global Constraints

- **No fabricated/hardcoded data surfaced as real** — every displayed metric is either a real computed value or an explicit honest-unavailable marker. This is the whole point; a tripwire enforces the absence of the specific fabricated literals.
- **Honest-unavailable conventions:** scalar KPI/metric value with no real source → the string `'N/D'` (matches the Wave-2.5 k-anonymity convention) with an honest sub-label key. Whole panel with no real source → the existing `EmptyState` component (`apps/web/components`; confirm its props before use). Fabricated trend chips → deleted (no empty-state needed).
- **Real metric where data exists + cheap aggregate only** — Learning avg-progress, DB-latency (drop `×3`), Team avg-tenure, Team role-diversity. Do NOT build the deferred heavier sources (email-from-auditLog, avg-performance aggregate, storage/uptime/realtime real sources, AI-usage reuse).
- **No `any`; no NEW inline `style={{}}`** (the pre-existing dynamic progress-bar `style={{ width: \`${pct}%\` }}` is the allowed runtime-% exception and stays). Arbitrary hex in className is the sibling convention and is allowed.
- **No hardcoded user-facing strings** — every label/sub/empty-state message via `t.*` keys present in BOTH `apps/web/lib/i18n/es.json` and `en.json` with identical shape (enforced by `tests/security/i18n-no-hardcoded-strings.test.ts`).
- **Prisma:** explicit `select` always; queries filtered by `organizationId`.
- **Per-slice gate (all green before commit):** `pnpm --filter @tims/api exec tsc --noEmit` + (`apps/web`) `npx tsc --noEmit` + (root) `npx vitest run` (full suite incl. the i18n gate + the slice tripwire).
- **Slice order:** A (Learning) → B (Health) → C (Team-Intel). Each independently mergeable.

---

## Slice A — Learning: real course progress

**Files:**
- Modify: `packages/api/src/routers/learning.ts` (`listCourses`, lines 24-54 — add per-course `avgProgress`)
- Modify: `apps/web/app/(admin)/learning/course-catalog.tsx` (line 114 — remove `Math.random`; render real `avgProgress`)
- Modify: `tests/tier1/s5-learning-wiring.test.ts` (invert the `Math.random` guard)
- Test: `tests/tier2/s-a-learning-progress.test.ts`

**Interfaces:**
- Produces: `listCourses` returns `{ courses: (Course & { _count: { enrollments }, avgProgress: number })[], total, page, pageSize }`. `avgProgress` = rounded mean of `Enrollment.progress` (0–100) for that course in the org, `0` when no enrollments.

- [ ] **Step 1 — Write the failing backend behavioral test** `tests/tier2/s-a-learning-progress.test.ts`. Extract the merge logic as a pure helper to test it directly: assert a helper `mergeAvgProgress(courses, progressRows)` maps each course to its `_avg.progress` (rounded) and defaults to `0` when a course has no progress row.
```ts
import { describe, it, expect } from 'vitest';
import { mergeAvgProgress } from '../../packages/api/src/routers/learning-progress';

describe('mergeAvgProgress', () => {
  it('attaches rounded avg progress per course, 0 when absent', () => {
    const courses = [{ id: 'c1' }, { id: 'c2' }] as { id: string }[];
    const rows = [{ courseId: 'c1', _avg: { progress: 47.6 } }];
    const out = mergeAvgProgress(courses, rows);
    expect(out.find((c) => c.id === 'c1')!.avgProgress).toBe(48);
    expect(out.find((c) => c.id === 'c2')!.avgProgress).toBe(0);
  });
});
```

- [ ] **Step 2 — Run it, verify it fails** `npx vitest run tests/tier2/s-a-learning-progress.test.ts` → FAIL (module missing).

- [ ] **Step 3 — Create the pure helper** `packages/api/src/routers/learning-progress.ts`:
```ts
export interface ProgressRow { courseId: string; _avg: { progress: number | null } }
export function mergeAvgProgress<T extends { id: string }>(courses: T[], rows: ProgressRow[]): (T & { avgProgress: number })[] {
  const byCourse = new Map(rows.map((r) => [r.courseId, Math.round(r._avg.progress ?? 0)]));
  return courses.map((c) => ({ ...c, avgProgress: byCourse.get(c.id) ?? 0 }));
}
```

- [ ] **Step 4 — Run it, verify it passes.**

- [ ] **Step 5 — Wire the aggregate into `listCourses`** (`learning.ts`). After the existing `Promise.all([courses, total])`, add the groupBy and merge; return `courses: withProgress`:
```ts
const progressRows = await db.enrollment.groupBy({
  by: ['courseId'],
  where: { organizationId: ctx.user.organizationId, courseId: { in: courses.map((c) => c.id) } },
  _avg: { progress: true },
});
const withProgress = mergeAvgProgress(courses, progressRows);
return { courses: withProgress, total, page, pageSize };
```
Add `import { mergeAvgProgress } from './learning-progress';` at the top. (Skip the groupBy when `courses.length === 0` — guard `courseId: { in: [] }` by returning early or passing the empty list; `groupBy` with an empty `in` returns `[]`, which `mergeAvgProgress` handles, so no guard is strictly required — keep it simple.)

- [ ] **Step 6 — Write the failing frontend tripwire** `tests/tier2/s-a-learning-progress.test.ts` (add to the same file): assert `course-catalog.tsx` no longer contains `Math.random`, contains `course.avgProgress`, and does not contain the old self-cancelling `_count.enrollments / Math.max(1, course._count.enrollments)` expression.
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const cat = readFileSync(resolve(__dirname, '../../apps/web/app/(admin)/learning/course-catalog.tsx'), 'utf8');
it('renders real avgProgress, not Math.random', () => {
  expect(cat).not.toMatch(/Math\.random/);
  expect(cat).toMatch(/course\.avgProgress/);
});
```

- [ ] **Step 7 — Run it, verify it fails** (file still has `Math.random`).

- [ ] **Step 8 — Replace the fabricated progress in `course-catalog.tsx`** (line 114): delete the `Math.random` `pct` line; replace with `const pct = course.avgProgress;`. The rest (`getProgressColor(pct)`, the `style={{ width: \`${pct}%\` }}` bar, the `{pct}%` label) stays unchanged — `pct` is now the real org avg. (The dynamic-width inline style is the allowed runtime-% exception.)

- [ ] **Step 9 — Invert the old guard** in `tests/tier1/s5-learning-wiring.test.ts`: the assertion that the file STILL contains `Math.random` (the Tier-2 guard) must be removed/replaced with `expect(catalog).not.toMatch(/Math\.random/)`. Update the comment to note Tier-2 fixed it.

- [ ] **Step 10 — Run the slice gate** (`@tims/api` tsc + web tsc + full `npx vitest run`) → all green.

- [ ] **Step 11 — Commit**
```bash
git add packages/api/src/routers/learning.ts packages/api/src/routers/learning-progress.ts "apps/web/app/(admin)/learning/course-catalog.tsx" tests/tier2/s-a-learning-progress.test.ts tests/tier1/s5-learning-wiring.test.ts
git commit -m "fix(learning): real per-course avg progress; remove Math.random fabrication"
```

---

## Slice B — Platform Health: honest metrics (full honesty pass)

> The health helper is pervasively fabricated, not just the 4 backlog examples. Apply the disposition rule to EVERY metric in `system.helpers.ts`.

**Files:**
- Modify: `packages/api/src/routers/platform/system.helpers.ts` (`buildSystemHealthServices`, lines 44-84)
- Modify: `apps/web/app/(admin)/platform/health/page.tsx` (the `99.97%` uptime banner, ~line 86)
- Modify: `apps/web/lib/i18n/{es,en}.json` (add an honest-unavailable key if a localized string is needed in the helper — but the helper currently emits Spanish literals directly; keep the `'N/D'` marker locale-neutral, see below)
- Test: `tests/tier2/s-b-health-honest.test.ts`

**Disposition table (apply exactly):**
| Service · metric | Current (fabricated) | Action |
|---|---|---|
| API Gateway · Latencia p95 | `${Math.max(dbLatency*3,12)}ms` | **Real:** `${dbLatency}ms`, relabel `'Latencia p95'`→`'Latencia'` (drop the false p95 claim + `×3`) |
| API Gateway · Uptime | `'99.99%'` | **`'N/D'`** (no uptime source) |
| API Gateway · Requests/min | `auditLogsToday/min` | keep (real-derived) |
| Base de Datos · Conexiones | `${min(orgCount+2,100)}/100` | **`'N/D'`** (no pool-metric source) |
| Base de Datos · Query time | `${dbLatency}ms` | keep (real) |
| Base de Datos · Registros | real counts | keep (real) |
| Autenticación · all 3 | real | keep |
| Almacenamiento · Usado / Uploads / progressBar | `'12.4 GB / 50 GB'` / `'0'` / `24.8` | **`'N/D'`** value, Uploads → `'N/D'`, **remove the `progressBar`** (no real %) |
| Background Jobs · Cola / Fallidos | `'0 pendientes'` / `'0'` | **`'N/D'`** both (no job system — `workers/` is an empty stub) |
| Background Jobs · Procesados hoy | `auditLogsToday` | keep (real-derived) |
| AI (Bedrock) · Llamadas / Costo / Presupuesto / progressBar | `'0'` / `'$0.00'` / `'0% usado'` / `0` | **`'N/D'`** all three, **remove the `progressBar`** (real source deferred) |
| Email (SES) · all 3 | `'0'` / `'0%'` / `'N/A'` | **`'N/D'`** all three |
| Realtime · all 3 | `'0'` × 3 | **`'N/D'`** all three |

Note: `'N/D'` is a locale-neutral marker already used across the app (k-anonymity); it is allowlisted-safe for the i18n gate (single token, no space/accent) and needs no new i18n key. The page banner `'99.97%'` is a JSX literal that must become `'N/D'` too.

- [ ] **Step 1 — Write the failing tripwire** `tests/tier2/s-b-health-honest.test.ts`: read `system.helpers.ts` + `health/page.tsx` as text and assert NONE of the fabricated literals remain: `99.99%`, `99.97%`, `12.4 GB`, `dbLatency * 3`, `Math.max(dbLatency`, `'24.8'`/`percent: 24.8`, `orgCount + 2`, `0% usado`, `$0.00`, `'N/A'`. Assert `dbLatency}ms` appears without `* 3`, and that `'N/D'` appears in the helper.
```ts
const h = readFileSync(resolve(__dirname, '../../packages/api/src/routers/platform/system.helpers.ts'), 'utf8');
const page = readFileSync(resolve(__dirname, '../../apps/web/app/(admin)/platform/health/page.tsx'), 'utf8');
it('no fabricated health literals remain', () => {
  for (const lit of ['99.99%', '12.4 GB', 'dbLatency * 3', 'orgCount + 2', '0% usado', '$0.00', '24.8']) {
    expect(h).not.toContain(lit);
  }
  expect(page).not.toContain('99.97%');
  expect(h).toMatch(/'N\/D'/);
});
```

- [ ] **Step 2 — Run it, verify it fails.**

- [ ] **Step 3 — Rewrite `buildSystemHealthServices`** per the disposition table. Keep the function signature + the services-array shape (each service `{ name, status, metrics: {label,value,color?}[], progressBar? }`); set fabricated values to `'N/D'`, drop the two `progressBar`s on Almacenamiento + AI, relabel API latency to real `${dbLatency}ms` with label `'Latencia'`. Leave the genuinely-real rows untouched.

- [ ] **Step 4 — Fix the page banner** in `health/page.tsx` (~line 86): replace the hardcoded `99.97%` uptime display with `'N/D'` (keep the surrounding label, which is already a `t.*` key or a static label — if it's a bare literal, route it through an existing `t.*` key or leave the numeric as `N/D`).

- [ ] **Step 5 — Run the tripwire → PASS.**

- [ ] **Step 6 — Run the slice gate** (api tsc + web tsc + full vitest) → green. (No behavioral test needed — this slice only removes fabrication; the tripwire + tsc cover it.)

- [ ] **Step 7 — Commit**
```bash
git add packages/api/src/routers/platform/system.helpers.ts "apps/web/app/(admin)/platform/health/page.tsx" tests/tier2/s-b-health-honest.test.ts
git commit -m "fix(platform): honest health metrics — N/D for unsourced, real DB latency"
```

---

## Slice C — Team-Intelligence: honest KPIs + panels

**Files:**
- Modify: `packages/api/src/routers/teamIntel.ts` (`getDashboardKpis`, lines 224-250 — add `avgTenureYears` + `diversityIndex`)
- Create: `packages/api/src/routers/team-intel-metrics.ts` (pure helpers)
- Modify: `apps/web/app/(admin)/talent/team-intelligence/team-intel-kpis.tsx` (real tenure/diversity, `N/D` for PCA/performance, drop trends + `?? 12`)
- Modify: `apps/web/app/(admin)/talent/team-intelligence/balance-alerts.tsx` (remove `DEMO_ALERTS` → `EmptyState`)
- Modify: `apps/web/app/(admin)/talent/team-intelligence/recommended-hires.tsx` (remove `DEMO_HIRES` → `EmptyState`)
- Modify: `apps/web/lib/i18n/{es,en}.json` (new keys; relabel diversity sub)
- Test: `tests/tier2/s-c-team-intel.test.ts`

**Interfaces:**
- Produces: `teamIntel.getDashboardKpis` returns the existing fields plus `avgTenureYears: number` (mean tenure of active org users in years, 1 decimal, 0 when none) and `diversityIndex: number` (unique non-empty `jobTitle` ÷ active member count, 0–1, 2 decimals, 0 when none).
- Pure helpers: `computeAvgTenureYears(members: { createdAt: Date }[], nowMs: number): number`; `computeRoleDiversity(members: { jobTitle: string | null }[]): number`.

- [ ] **Step 1 — Write the failing behavioral test** `tests/tier2/s-c-team-intel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeAvgTenureYears, computeRoleDiversity } from '../../packages/api/src/routers/team-intel-metrics';

describe('team-intel metrics', () => {
  const NOW = new Date('2026-06-29T00:00:00Z').getTime();
  it('avg tenure in years (1 decimal), 0 when empty', () => {
    const twoYrs = new Date('2024-06-29T00:00:00Z');
    expect(computeAvgTenureYears([{ createdAt: twoYrs }], NOW)).toBe(2);
    expect(computeAvgTenureYears([], NOW)).toBe(0);
  });
  it('role diversity = unique non-empty titles / members (0-1)', () => {
    expect(computeRoleDiversity([{ jobTitle: 'Dev' }, { jobTitle: 'Dev' }, { jobTitle: 'PM' }])).toBe(0.67);
    expect(computeRoleDiversity([{ jobTitle: null }])).toBe(0);
    expect(computeRoleDiversity([])).toBe(0);
  });
});
```

- [ ] **Step 2 — Run it, verify it fails** (module missing).

- [ ] **Step 3 — Create the pure helpers** `packages/api/src/routers/team-intel-metrics.ts`:
```ts
export function computeAvgTenureYears(members: { createdAt: Date }[], nowMs: number): number {
  if (members.length === 0) return 0;
  const years = members.reduce((s, m) => s + (nowMs - m.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 365), 0) / members.length;
  return Math.round(years * 10) / 10;
}
export function computeRoleDiversity(members: { jobTitle: string | null }[]): number {
  if (members.length === 0) return 0;
  const unique = new Set(members.map((m) => m.jobTitle).filter(Boolean)).size;
  return Math.round((unique / members.length) * 100) / 100;
}
```

- [ ] **Step 4 — Run it, verify it passes.**

- [ ] **Step 5 — Wire helpers into `getDashboardKpis`** (`teamIntel.ts`). Add an org-members fetch + the two computed fields:
```ts
const members = await db.user.findMany({
  where: { organizationId: orgId, isActive: true },
  select: { createdAt: true, jobTitle: true },
});
// ...in the return object, add:
avgTenureYears: computeAvgTenureYears(members, Date.now()),
diversityIndex: computeRoleDiversity(members),
```
Add `import { computeAvgTenureYears, computeRoleDiversity } from './team-intel-metrics';`.

- [ ] **Step 6 — Write the failing UI tripwire** (add to `tests/tier2/s-c-team-intel.test.ts`): assert the three component files have no fabricated literals.
```ts
const kpis = readFileSync(resolve(__dirname, '../../apps/web/app/(admin)/talent/team-intelligence/team-intel-kpis.tsx'), 'utf8');
const alerts = readFileSync(resolve(__dirname, '../../apps/web/app/(admin)/talent/team-intelligence/balance-alerts.tsx'), 'utf8');
const hires = readFileSync(resolve(__dirname, '../../apps/web/app/(admin)/talent/team-intelligence/recommended-hires.tsx'), 'utf8');
it('team-intel UI has no fabricated data', () => {
  for (const lit of ["'2.8'", "value: 68", "'0.72'", "'8.2'", '?? 12', 'vs Q1', 'vs anterior']) {
    expect(kpis).not.toContain(lit);
  }
  expect(alerts).not.toContain('DEMO_ALERTS');
  expect(hires).not.toContain('DEMO_HIRES');
  expect(alerts).toMatch(/EmptyState/);
  expect(hires).toMatch(/EmptyState/);
  expect(kpis).toMatch(/data\?\.avgTenureYears/);
  expect(kpis).toMatch(/data\?\.diversityIndex/);
});
```

- [ ] **Step 7 — Run it, verify it fails.**

- [ ] **Step 8 — Add i18n keys** (`team-intelligence` namespace in BOTH locales): `kpiUnavailable` is unneeded (`N/D` is the literal); add `diversityRoles` (es `"Diversidad de roles"`, en `"Role diversity"`) to REPLACE the misleading `shannonIndex` sub-label; add `aiPanelEmptyTitle`/`aiPanelEmptyBody` for the two panels (es `"Disponible con el agente de IA"` / `"Esta vista se activa cuando el agente de análisis de equipos esté disponible."`, en equivalents). Keep `shannonIndex` key only if still referenced elsewhere; otherwise remove from both locales.

- [ ] **Step 9 — Fix `team-intel-kpis.tsx`** (lines 39-83): widen the `data` prop type + `t` prop to include the new fields/keys. Rebuild the `kpis` array:
  - Team Size → `value: data?.totalMembers ?? 0` (drop `?? 12`).
  - Avg Tenure → `value: data?.avgTenureYears ?? 0` (sub `t.years`).
  - PCA Balance → `value: 'N/D'` (drop `valueColor`; sub `t.score100`).
  - Diversity → `value: data?.diversityIndex ?? 0` (sub `t.diversityRoles`, NOT `shannonIndex`).
  - Avg Performance → `value: 'N/D'` (sub `t.outOf10`).
  - **Delete the `trend`/`trendColor`/`trendUp`/`trendIcon` fields from every kpi object AND the trend-rendering `<div className="flex ... mt-1">…</div>` block (lines 92-103)** — no historical data exists. Remove now-unused `needsBalance` from the `t` prop type.

- [ ] **Step 10 — Replace `balance-alerts.tsx`** — delete the `DEMO_ALERTS` array; render the existing `EmptyState` component (confirm its props from `apps/web/components`) with `t.aiPanelEmptyTitle`/`t.aiPanelEmptyBody`. Keep the panel's outer card/title.

- [ ] **Step 11 — Replace `recommended-hires.tsx`** — same: delete `DEMO_HIRES`, render `EmptyState` with the same keys.

- [ ] **Step 12 — Run all S-C tests + slice gate** → green.

- [ ] **Step 13 — Commit**
```bash
git add packages/api/src/routers/teamIntel.ts packages/api/src/routers/team-intel-metrics.ts "apps/web/app/(admin)/talent/team-intelligence/" apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json tests/tier2/s-c-team-intel.test.ts
git commit -m "fix(team-intel): real tenure/diversity KPIs; N/D + EmptyState for unsourced; drop demo data"
```

---

## Slice D — Backlog truth-up (docs)

**Files:** Modify `docs/REMAINING-WORK.md`.

- [ ] **Step 1 — Update the backlog** (rule #1, docs are code): under Tier 1, mark the last-mile UI wiring **DONE (PR #98)**; under Tier 3, mark "Commitments — backend real, UI read-only" **DONE (PR #98 S4)**; under Tier 2, mark Learning/Health/Team-Intel **DONE (this branch)** and **correct the Site-3 OKR-split entry** (no fabricated split existed — `getDashboardKpis` returns real count + real avg). Record the explicitly-deferred Tier-2 items (email-from-auditLog, avg-performance aggregate, storage/uptime/realtime real sources, AI-usage reuse, Wave-3 DISC model).

- [ ] **Step 2 — Commit**
```bash
git add docs/REMAINING-WORK.md
git commit -m "docs(remaining-work): truth-up Tier-1/2/3 status after honest-data + last-mile wiring"
```

---

## Self-Review (against spec)

- **Spec §Slice A (Learning):** Steps 1-11 — real `avgProgress` via groupBy + `mergeAvgProgress`, `Math.random` removed, s5 guard inverted. ✅
- **Spec §Slice B (Health):** Steps 1-7 — full honesty pass on `system.helpers.ts` (broader than the 4 named, per spec's "remove every fabricated value"); DB latency real (drop `×3`); uptime/storage/email/realtime/DB-conns/jobs/AI → `N/D`; banner fixed. ✅
- **Spec §Slice C (Team-Intel):** Steps 1-13 — real `avgTenureYears` + `diversityIndex` (reusing the real `uniqueRoles/count` pattern, NOT inventing Shannon — sub-label honestly relabeled); PCA/performance → `N/D`; trends deleted; DEMO panels → `EmptyState`. ✅
- **Spec §cross-cutting:** Slice D truth-ups `REMAINING-WORK.md` incl. the Site-3 correction. ✅
- **Disposition rule honored:** real only where data exists + cheap (Learning avg, DB latency, tenure, diversity); `N/D`/EmptyState everywhere else; deferred items NOT built. ✅
- **Honest-empty over removal:** panels use `EmptyState`, KPIs use `N/D` — nothing deleted from IA. ✅
- **Type consistency:** `avgProgress` (A), `avgTenureYears`/`diversityIndex` (C), helper signatures match between test + impl + call site.
- **Placeholder scan:** all steps have concrete code/commands. The one judgment item (EmptyState props) is explicitly "confirm from `apps/web/components`" since it's an existing component.
- **Deviation noted:** Slice B is broader than the spec's 4 named health metrics — surfaced to the user; within the spec's "remove every fabricated value" intent.
