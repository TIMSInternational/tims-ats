# Tier-2 "Honest Data" — Design

> Date: 2026-06-29 · Status: approved (design) · Branch: `feat/tier2-honest-data`
> Source: `docs/REMAINING-WORK.md` Tier 2 ("fabricated/mock data surfaced as real" — violates the
> no-fake-data rule). Grounded by a 4-site exploration audit (2026-06-29).

## Overview

Remove every fabricated value surfaced as real across the platform. For each fabricated site, either
**compute the real metric** (where the underlying data genuinely exists and it's a cheap aggregate) or
show an **honest empty-state / `N/D`** (where no real source exists yet). Drop fabricated trend chips
entirely. No new routers; small Prisma aggregates added to existing queries. **3 independently-shippable
slices**, same SDD rhythm as the Tier-1 build.

## Locked decisions (brainstorm 2026-06-29)
1. **Disposition = "honest hybrid":** compute the real metric where data exists + the aggregate is cheap
   (Learning avg-progress, DB-latency scale fix, Team avg-tenure, Team diversity/Shannon); honest
   empty-state for genuinely-missing data; remove fabricated trend strings.
2. **No-data surfaces = honest empty-state** (NOT removal): reuse the existing `EmptyState` component +
   the Wave-2.5 `N/D` KPI convention, preserving IA and signaling roadmap; reversible when the backing
   feature ships.
3. **Site 3 (Performance OKR split) is OUT** — the backlog's claimed invented `activeOkrs*0.53/0.32` split
   does not exist in code; `performance.getDashboardKpis` already returns a real active-OKR count + real
   average progress. Nothing to fix; correct the backlog.

## Established primitives reused (no new abstractions)
- `EmptyState` component (`apps/web/components`) for honest-unavailable panels.
- `N/D` KPI display convention (Wave-2.5 k-anonymity small-team pattern) for unavailable scalar KPIs.
- Prisma aggregate/groupBy on existing models (`Enrollment`, `User`) — added to existing queries.
- i18n: every new label/empty-state string via `t.*` in BOTH `apps/web/lib/i18n/es.json` + `en.json`
  (the i18n gate enforces this).

---

## Slice A — Learning: real course progress (Site 2)

**Fabrication:** `apps/web/app/(admin)/learning/course-catalog.tsx:114` —
`Math.random()`-driven 50–100% progress bar per course card.

**Real source:** `Enrollment.progress` (Float 0–100) exists; `learning.getTeamProgress` already aggregates
avg progress. The catalog card has `_count.enrollments` but no progress.

**Backend** (`packages/api/src/routers/learning.ts`, `listCourses`): add a real per-course average
progress. Compute via `db.enrollment.groupBy({ by: ['courseId'], where: { organizationId, courseId: { in
[...] } }, _avg: { progress: true } })` and merge an `avgProgress` (rounded, default 0) onto each returned
course alongside the existing `_count.enrollments`. Keep explicit select discipline.

**Frontend** (`course-catalog.tsx`): render the real `course.avgProgress` in the progress bar + label;
**delete the `Math.random()` line (114)** and its `pct` computation.

**Test impact:** `tests/tier1/s5-learning-wiring.test.ts` currently asserts the file STILL contains
`Math.random` (the Tier-2 guard). **Invert it:** assert `Math.random` is GONE from `course-catalog.tsx`
and that `avgProgress` is wired. Add a small behavioral test for the avg-progress aggregate shape if it's
extractable as a pure helper; otherwise a tripwire asserting the groupBy + `avgProgress` field is present.

---

## Slice B — Platform Health: honest metrics (Site 1)

Files: `packages/api/src/routers/platform/system.ts`, `system.helpers.ts`,
`apps/web/app/(admin)/platform/health/page.tsx`.

**Real:** `dbLatency` is already measured live (`SELECT 1` timing). Drop the `×3` display scale fudge in
`system.helpers.ts` → show the actual measured ms.

**Honest empty-state** (no real source today): replace the hardcoded values with honest-unavailable
markers (an `EmptyState`-style "sin seguimiento aún" / "no disponible" treatment in the service grid +
the `health/page.tsx:86` banner):
- Uptime `99.97%` → honest empty-state (no SLA/uptime tracking model).
- Storage `12.4 GB / 50 GB` (24.8% bar) → honest empty-state (Supabase storage API not integrated).
- Email metrics (Enviados/Bounce/Reputation, hardcoded `0`/`N/A`) → honest empty-state.
- Realtime metrics (Conexiones/Mensajes-seg/Canales, hardcoded `0`) → honest empty-state.

The `getSystemHealth` return shape (services array) is preserved; only the values become honest. Real
rows that already work (DB health/latency, user/org counts, logins today) stay.

**Test:** tripwire — no hardcoded `99.97`/`12.4 GB`/fabricated metric literals remain in `system.helpers.ts`
or `health/page.tsx`; `dbLatency` rendered without `* 3`; honest empty-state strings exist in both locales.

---

## Slice C — Team-Intelligence: honest KPIs + panels (Site 4, largest)

Files: `packages/api/src/routers/teamIntel.ts` (`getDashboardKpis`),
`apps/web/app/(admin)/talent/team-intelligence/{team-intel-kpis,balance-alerts,recommended-hires}.tsx`.

**Real (add to `teamIntel.getDashboardKpis`):**
- `avgTenureYears` — from `User.createdAt` across active org members (mean of `(now - createdAt)` in
  years, rounded to 1 decimal). The tenure calc pattern already exists in `getBalanceScore`.
- `diversityIndex` — Shannon entropy over job-title distribution; reuse the `roleDiversity` logic already
  in `getBalanceScore` (extract a shared pure helper rather than duplicating).
- Team Size already real (`totalMembers`) — drop the `?? 12` fallback in the UI (use real or 0).

**Honest `N/D`** (no real source):
- PCA Balance (`68`) → `N/D` (no DISC competency model).
- Avg Performance (`8.2`) → `N/D` (Feedback/Recognition/OKR aggregate deferred — heavier, out of scope).
- **Remove ALL fabricated trend chips** (`+2 vs Q1`, `+0.3 vs anterior`, etc.) from every KPI — no
  historical snapshot data exists to compute a trend.

**Honest empty-state panels:**
- `BalanceAlerts` — delete the `DEMO_ALERTS` array; render `EmptyState` "disponible con el agente de IA
  (próximamente)". Its query `teamIntel.getBalanceAlerts` already throws `NOT_IMPLEMENTED` — left as-is.
- `RecommendedHires` — delete `DEMO_HIRES`; render the same honest empty-state. `getRecommendedHires`
  left as-is.

**Test:** tripwire — no `DEMO_` arrays, no hardcoded `2.8`/`68`/`0.72`/`8.2`/`12` fabricated KPI literals,
no trend-chip literals remain; `EmptyState` rendered in both panels; `avgTenureYears` + `diversityIndex`
wired from the query; both-locale i18n keys. Behavioral unit for the extracted Shannon-diversity + tenure
helpers (pure functions).

---

## Cross-cutting (in the final slice)
- **Truth-up `docs/REMAINING-WORK.md`** (rule #1, docs are code): mark Tier-1 last-mile wiring DONE (PR #98)
  + the Tier-3 "Commitments create UI" item DONE (shipped in #98 S4); mark Tier-2 sites closed; correct
  the Site-3 entry (no fabrication existed); note the explicitly-deferred items below.

## Out of scope (deferred — honestly labeled, NOT faked)
- Email-from-`auditLog` aggregate, avg-performance aggregate (Feedback/Recognition/OKR), Supabase
  storage/uptime real sources, realtime connection metrics — all remain honest empty-state until a real
  source is wired.
- The Wave-3 AI competency/DISC model behind `getBalanceAlerts`/`getRecommendedHires`.

## Testing & gate
- Static-source tripwires per slice (no fabricated literals / no `Math.random` / no `DEMO_`; honest
  `EmptyState` or `N/D` present; real query field wired; both-locale i18n keys) + behavioral units for the
  new pure aggregates/helpers (course avgProgress shape, tenure, Shannon diversity).
- Gate per slice: `@tims/api` tsc + web tsc + full vitest (incl. the i18n gate) green.

## Deploy
Frontend + thin read-only query changes, **no migration/env**. Per repo norm: feat branch → PR →
admin-merge past the CI billing trap (local gate green) → Vercel auto-deploy. Each slice independently
mergeable.
