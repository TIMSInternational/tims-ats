# Perf Phase 1 — Query-Cost Reduction — Design

> Date: 2026-06-30 · Status: approved (design) · Branch: `perf/phase1-query-cost` (off main `7ab8d21`)
> Source: the 2026-06-30 four-front performance analysis, **independently verified by Codex**
> (cross-model). Codex refuted/de-scoped two overstated claims (RLS "3× RTT", Prisma-singleton
> cold-connect) and surfaced one missed high-impact issue (double `getUser()` per tRPC request).

## Overview

Reduce per-page latency by cutting the **number and cost of DB/auth round-trips per request** — the
controllable half of the slowness (the other half, cross-region DB latency, is Phase 0: an owner
dashboard action, done in parallel). Five independently-shippable, Codex-verified code slices. No DB
migration, no region change. One branch → one PR, each slice reviewed (sonnet) + **Codex-verified** +
opus whole-branch.

## Verified diagnosis (what we are NOT doing, and why)
- **NOT** refactoring the RLS `tenantDb` wrapper — Codex confirmed it's one `$transaction` (BEGIN/COMMIT +
  2 setup statements + query), not a 3× round-trip multiplier. Refactor risk > reward.
- **NOT** changing the Prisma singleton — Codex refuted the "cold-connect every request" claim; the
  module-level `const db`/`tenantDb` are reused on warm Lambdas. No change needed.
- Region co-location (Phase 0) is the single biggest lever but is config/dashboard, tracked separately.

## Process setup (the standing Codex gate)
Before S1, add the **Codex cross-model verification** rule to the repo so it's durable: a short section in
`CLAUDE.md` (or `.claude/rules/verification.md`) stating that every build phase gets an adversarial Codex
verification pass at its review gate, alongside the per-slice + opus reviews. Enforcement = build-gate +
repo rule (NOT the hard per-turn `--enable-review-gate`). This commit is S0.

## Slices

### S0 — Encode the Codex-verification rule (docs)
Add the rule to `CLAUDE.md`/`.claude/rules`. No code. One commit.

### S1 — Eliminate the double `supabase.auth.getUser()` per tRPC request
- **Problem (Codex-found):** `apps/web/middleware.ts` → `packages/auth/src/middleware.ts` `updateSession`
  calls `supabase.auth.getUser()` (a network call to Supabase Auth) on every matched request. Then the
  tRPC route `apps/web/app/api/trpc/[trpc]/route.ts` `createContext` calls `getUser()` AGAIN (~lines
  35-38) + a Prisma user lookup (~56-63). Every query/mutation pays **two** Auth round-trips.
- **Approach (security-preserving):** middleware remains the validation point (keeps `getUser()` — full
  JWT revalidation). On success, middleware forwards the validated `userId` (and any needed claim) to the
  request via a **trusted internal header** (e.g. `x-tims-user-id`), set on the `requestHeaders` it already
  builds. `createContext` reads that header *(present only because OUR middleware set it on the
  same-origin request)* instead of calling `getUser()` again; it still does the Prisma user lookup for
  org/roles. **Do NOT switch to `getSession()`** (which skips revalidation). If the header is absent
  (e.g. a path middleware didn't process), fall back to the existing `getUser()` path — no auth regression.
- **Test:** behavioral — context resolves the user from the trusted header when present, falls back to
  `getUser()` when absent; a forged header on a request that did NOT pass middleware must NOT authenticate
  (verify middleware is the only setter + the matcher covers the tRPC path). Static tripwire: `createContext`
  no longer calls `getUser()` unconditionally.

### S2 — Collapse the N+1 month-loops
- **Problem (confirmed):** `packages/api/src/routers/platform/dashboard.ts` `getUserGrowth` (~346-362)
  runs 6 serial `await db.user.count()` in a for-loop; `getMrrTrend` (~411-430) runs 12 serial
  `await db.subscription.findMany()` in a for-loop. 18 serial queries.
- **Approach:** replace each with a **single** bucketed aggregate — `db.$queryRaw` using
  `date_trunc('month', "createdAt")` + `GROUP BY` (parameterized, tagged-template — never
  `$queryRawUnsafe`), org-scoped, returning month→count rows; map to the existing return shape. Extract a
  pure helper to build the 6/12-month skeleton + merge the rows (fills gaps with 0), unit-tested.
- **Test:** behavioral on the merge helper (rows → fixed N-month series, gaps=0, correct order); static
  tripwire: no `await` inside a `for`/`map` loop in these two procedures; raw query is the tagged-template
  form (no Unsafe).

### S3 — Cache dashboard KPIs (TTL ~45s) + feature-flag checks (5min, invalidate-on-update)
- **Problem (confirmed):** the cache-aside `packages/api/src/lib/cache.ts` is used ONLY by permission
  checks (`access/build.ts`). `getDashboardKpis` in `platform/dashboard.ts`, `performance/dashboard.ts`,
  `vacancy/stats.ts`, `learning.ts` each fire 6-10 uncached counts/aggregates per call;
  `featureFlag.ts` `check` does an uncached `findUnique` on every page.
- **Approach:**
  - **Dashboard KPIs:** wrap each `getDashboardKpis` body in `cacheGet`/`cacheSet`, key
    `tims:kpis:<router>:<orgId>` (+ inputHash where the procedure takes scope-affecting input — e.g.
    vacancy stats may key on the user's scope), TTL **45s**, **no explicit invalidation** (TTL-only —
    matches the repo's documented 30-60s SWR rule). *(Coordinate `teamIntel.getDashboardKpis` with Tier-2
    PR #99 which also edits it — cache it in the rebase, or skip it here to avoid conflict.)*
  - **Feature flags:** cache `check` 5min, key `tims:flagcheck:<orgId>:<key>`, and **invalidate the
    `tims:flagcheck:<orgId>:` prefix on `featureFlag.update`** (flags must flip promptly).
- **Test:** behavioral — cache hit returns the cached value without a second DB call (mock cache + db,
  assert db called once across two invocations); flag `update` calls `cacheInvalidatePrefix`. Static
  tripwire: each target procedure references `cacheGet`/`cacheSet`.

### S4 — Frontend fetch hygiene
- **Dedup:** `apps/web/app/(admin)/dashboard/recruiting-kpi-strip.tsx` refetches the same
  `vacancy.getDashboardKpis` + `candidate.getDashboardKpis` its parent `recruitment-dashboard.tsx`
  already fetches → pass the data as props; remove the child `useQuery`s.
- **Waterfalls:** `alerts-sla-panel.tsx` + `alerts-risk-panel.tsx` each do `vacancy.list` → dependent
  `getSlaStatus`/`getBoard` (and 3 duplicate `vacancy.list`). Fetch the published-vacancy list ONCE at
  the page level, pass `vacancyId`/list down; children use `useQuery(..., { enabled: !!vacancyId })`.
- **staleTime:** `apps/web/lib/trpc-provider.tsx` — raise the default `staleTime` from 30s to **5min**
  (300_000); leave the health page's intentional `refetchInterval: 30s` as-is.
- **Test:** static tripwires — `recruiting-kpi-strip.tsx` has no `getDashboardKpis` `useQuery` (props
  instead); alert panels take a `vacancyId` prop + use `enabled`; `trpc-provider.tsx` `staleTime` is 300_000.

### S5 — tRPC route hardening
- `apps/web/app/api/trpc/[trpc]/route.ts`: add `export const maxDuration = 30` and
  `export const preferredRegion = [...]` (set to the DB's region once Phase-0 verification confirms it;
  if unconfirmed at build time, add `maxDuration` now and leave a TODO-with-issue for `preferredRegion`
  pending the region decision — do NOT guess the region).
- **Test:** static tripwire — the exports are present.

## Out of scope (later phases, honestly deferred)
- Phase 0: region co-location + pooler tuning + `DIRECT_URL`/connection-limit verification (owner dashboard).
- Phase 2: composite indexes (migration), RSC/streaming conversion of the heaviest dashboards, Recharts
  dynamic-import.
- Phase 3: read replicas, broader middleware-auth reduction.

## Testing & gate
Per slice: behavioral units for pure logic (S1 context resolution, S2 month-merge, S3 cache hit/invalidate)
+ static-source tripwires for wiring. Full gate: `@tims/api` tsc + web tsc + full vitest (incl. i18n gate).
**Plus Codex cross-model verification at each slice review + the opus whole-branch review.** Measure a
before/after on a representative dashboard where feasible.

## Deploy
Frontend + API code only, **no migration/env**. feat branch → PR → admin-merge past the CI billing trap
(local gate green) → Vercel auto-deploy. Rebase on main after PR #99 (Tier-2) merges; the only overlap is
`teamIntel.getDashboardKpis` (coordinate its caching in the rebase).
