# Perf Phase 1 — Query-Cost Reduction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Every task also gets an adversarial Codex cross-model verification at its review gate** (the standing process — see Task 1).

**Goal:** Cut per-page latency by reducing the number + cost of DB/auth round-trips per request — without DB migration or region change.

**Architecture:** Five code slices + a process-setup commit. Cache hot dashboard reads; collapse N+1 loops into single aggregates; remove a redundant per-request auth network call; tighten the frontend's query hygiene; harden the tRPC route. Built in risk order (clean wins first; the auth change last, with a security spike).

**Tech Stack:** Next.js 15, tRPC, Prisma/Supabase, Upstash (`lib/cache.ts`), Vitest.

## Global Constraints (verbatim from spec)
- **No fabricated data; security-preserving.** The auth slice keeps full JWT validation in middleware — do NOT switch to `getSession()` or weaken auth.
- **Cache policy:** dashboard KPIs = TTL-only **45s** (no invalidation); feature flags = **5min** TTL **with** `tims:flagcheck:<orgId>:` prefix-invalidation on `featureFlag.update`.
- **No new inline `style`; no `any`; explicit Prisma `select`; raw SQL only via tagged-template `$queryRaw` (NEVER `$queryRawUnsafe`); queries org-scoped.**
- **Codex verification at every task's review gate** (build-gate enforcement, per [[codex-cross-model-verification]]).
- **Gate per task:** `pnpm --filter @tims/api exec tsc --noEmit` + (`apps/web`) `npx tsc --noEmit` + (root) `npx vitest run`.
- **BUILD ORDER:** Task 1 (Codex rule) → 2 (N+1) → 3 (cache) → 4 (frontend) → 5 (route) → 6 (auth, last). Each independently mergeable.

---

## Task 1 — Encode the Codex-verification rule (S0)

**Files:** Create `.claude/rules/verification.md`; reference it from `CLAUDE.md`.

- [ ] **Step 1 — Write `.claude/rules/verification.md`:**
```markdown
---
paths:
  - "**"
---
# Cross-Model Verification (Codex)

Every build phase gets an adversarial **Codex** cross-model verification pass at its review gate,
alongside the per-slice reviewer and the opus whole-branch review (superpowers:subagent-driven-development).
Dispatch the `codex:codex-rescue` agent; instruct it to catch overstated/incorrect claims, cite file:line,
and surface what was missed — honesty over agreement. Enforcement = build-gate + this rule (NOT the hard
per-turn `--enable-review-gate`). Proven (2026-06-30 perf analysis): Codex caught 2 overstated findings +
1 missed issue on its first run.
```
- [ ] **Step 2 — Add a one-line pointer** under `CLAUDE.md` "CI/CD Security Gates" (or a new "## Verification" heading): `- **Codex cross-model verification** runs at every build's review gate — see .claude/rules/verification.md`.
- [ ] **Step 3 — Commit** `git commit -m "chore(process): codex cross-model verification rule"`.

---

## Task 2 — Collapse the N+1 month-loops (S2)

**Files:**
- Modify: `packages/api/src/routers/platform/dashboard.ts` (`getUserGrowth` ~346-363, `getMrrTrend` ~411-430)
- Create: `packages/api/src/routers/platform/time-series.ts` (pure month-bucket helper)
- Test: `tests/perf/time-series.test.ts`

**Interfaces:**
- Produces: `buildMonthSeries(rows: { month: string; count: number }[], months: number, endNow: Date): { month: string; count: number }[]` — returns exactly `months` buckets ending at `endNow`'s month, filling missing months with `count: 0`, oldest-first. `month` format = `YYYY-MM`.

- [ ] **Step 1 — Failing test** `tests/perf/time-series.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildMonthSeries } from '../../packages/api/src/routers/platform/time-series';
describe('buildMonthSeries', () => {
  it('fills 6 oldest-first buckets, gaps=0', () => {
    const end = new Date('2026-06-15T00:00:00Z');
    const rows = [{ month: '2026-06', count: 5 }, { month: '2026-04', count: 2 }];
    const out = buildMonthSeries(rows, 6, end);
    expect(out.length).toBe(6);
    expect(out[5]).toEqual({ month: '2026-06', count: 5 });
    expect(out[4]).toEqual({ month: '2026-05', count: 0 });
    expect(out[3]).toEqual({ month: '2026-04', count: 2 });
    expect(out[0].month).toBe('2026-01');
  });
});
```
- [ ] **Step 2 — Run → fail.**
- [ ] **Step 3 — Implement `time-series.ts`:** pure function building the N-month skeleton from `endNow` backwards (`YYYY-MM`), indexing `rows` into a Map, filling gaps with 0. No DB, no `any`.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Replace `getUserGrowth`** body: one `db.$queryRaw` (tagged template) —
```ts
const rows = await db.$queryRaw<{ month: string; count: bigint }[]>`
  SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, COUNT(*)::int AS count
  FROM "users"
  WHERE "createdAt" >= ${sixMonthsAgo}
  GROUP BY 1`;
return buildMonthSeries(rows.map(r => ({ month: r.month, count: Number(r.count) })), 6, new Date());
```
(Confirm the actual table name + any org/global scope from the current procedure — `getUserGrowth` is platform-scoped/global; keep its existing scope. Use the real column names.)
- [ ] **Step 6 — Replace `getMrrTrend`** similarly: a single monthly aggregate over subscriptions (group active subs by month, map plan→price as the current code does, or aggregate in SQL). Preserve the exact return shape the frontend consumes. If MRR needs per-plan price math the loop did, do the grouping in SQL and the price map in JS over the grouped rows — still one query.
- [ ] **Step 7 — Tripwire test** `tests/perf/s2-no-loop.test.ts`: assert `platform/dashboard.ts` source has no `await db.` inside a `for (`/`.map(` within these two procedures, and uses `$queryRaw` (not `$queryRawUnsafe`).
- [ ] **Step 8 — Gate green; commit** `perf(platform): single group-by for user-growth + MRR trend (was 18 serial queries)`.

---

## Task 3 — Cache dashboard KPIs + feature-flag checks (S3)

**Files:**
- Modify: `packages/api/src/routers/platform/dashboard.ts` (`getDashboardKpis`), `packages/api/src/routers/performance/dashboard.ts` (`getDashboardKpis`), `packages/api/src/routers/vacancy/stats.ts` (`getDashboardKpis`), `packages/api/src/routers/learning.ts` (`getDashboardKpis`)
- Modify: `packages/api/src/routers/featureFlag.ts` (`check` + `update`)
- Test: `tests/perf/kpi-cache.test.ts`

**Interfaces:**
- Consumes: `cacheGet<T>(key)`, `cacheSet<T>(key, value, ttlSeconds)`, `cacheInvalidatePrefix(prefix)` from `packages/api/src/lib/cache.ts` (already exist).

- [ ] **Step 1 — Failing behavioral test** `tests/perf/kpi-cache.test.ts`: with `cacheGet`/`cacheSet` mocked, calling a cached procedure twice runs the DB body once (second call served from cache). And `featureFlag.update` calls `cacheInvalidatePrefix` with the org's flag prefix. (Mirror the engagement-router test harness — `vi.mock('@tims/db')` + a `permissionProcedure` shim + `createCallerFactory`, as used in `tests/access/ai-interview-router.test.ts` / `tests/dei/survey-contributor-skip-suppression.test.ts`.)
- [ ] **Step 2 — Run → fail.**
- [ ] **Step 3 — Wrap each `getDashboardKpis`** body:
```ts
const cacheKey = `tims:kpis:<router>:${orgId}`; // e.g. tims:kpis:performance:${orgId}
const cached = await cacheGet<KpiResult>(cacheKey);
if (cached) return cached;
const result = /* existing Promise.all aggregation */;
await cacheSet(cacheKey, result, 45);
return result;
```
For `vacancy/stats.ts` and any procedure whose result depends on the caller's SCOPE (team/unit/own users see different numbers), append a scope discriminator to the key (e.g. the sorted role list or the resolved scope) so two different scopes don't share a cache entry. For platform `getDashboardKpis` (platform-owner, no org) key on `tims:kpis:platform:global`.
- [ ] **Step 4 — Feature flags** (`featureFlag.ts`): cache `check` —
```ts
const cacheKey = `tims:flagcheck:${ctx.user.organizationId}:${input.key}`;
const cached = await cacheGet<{ enabled: boolean; payload: unknown }>(cacheKey);
if (cached) return cached;
const flag = await db.featureFlag.findUnique({ /* existing */ });
const result = { enabled: flag?.enabled ?? false, payload: flag?.payload ?? null };
await cacheSet(cacheKey, result, 300);
return result;
```
and in `update`, after the write: `await cacheInvalidatePrefix(\`tims:flagcheck:${ctx.user.organizationId}:\`);`.
- [ ] **Step 5 — Run behavioral test → pass.**
- [ ] **Step 6 — Tripwire** `tests/perf/s3-cache-wired.test.ts`: each target procedure's source references `cacheGet` + `cacheSet`; `featureFlag.ts` references `cacheInvalidatePrefix`.
- [ ] **Step 7 — Gate green; commit** `perf(api): cache dashboard KPIs (45s TTL) + feature-flag checks (5min, invalidate on update)`.

> NOTE: do NOT cache `teamIntel.getDashboardKpis` here — it's edited by the open Tier-2 PR #99; add its caching during the post-#99 rebase to avoid a conflict.

---

## Task 4 — Frontend fetch hygiene (S4)

**Files:**
- Modify: `apps/web/app/(admin)/dashboard/recruitment-dashboard.tsx`, `recruiting-kpi-strip.tsx`
- Modify: `apps/web/app/(admin)/dashboard/alerts-sla-panel.tsx`, `alerts-risk-panel.tsx` (+ the page that mounts them)
- Modify: `apps/web/lib/trpc-provider.tsx`
- Test: `tests/perf/s4-frontend-hygiene.test.ts`

- [ ] **Step 1 — Failing tripwire** `tests/perf/s4-frontend-hygiene.test.ts`: `recruiting-kpi-strip.tsx` has NO `getDashboardKpis` `useQuery` (receives props instead); `alerts-sla-panel.tsx` + `alerts-risk-panel.tsx` accept a `vacancyId`/list prop and gate dependent queries with `enabled`; `trpc-provider.tsx` sets `staleTime: 300_000`.
- [ ] **Step 2 — Run → fail.**
- [ ] **Step 3 — Dedup `RecruitingKpiStrip`:** change its props to accept the already-fetched `vacancyKpis` + `candidateKpis` (use the inferred query-result types from `lib/trpc-types.ts`, no `any`); remove its two `useQuery` calls; update `recruitment-dashboard.tsx` to pass the data it already has.
- [ ] **Step 4 — Fix alert-panel waterfalls:** fetch `vacancy.list({ limit: 5, status: 'published' })` ONCE at the parent (RecruiterDashboard); pass the needed `vacancyId`/list down; in each panel use `trpc.*.useQuery(input, { enabled: !!vacancyId })`. Remove the duplicate `vacancy.list` calls.
- [ ] **Step 5 — Raise staleTime:** in `trpc-provider.tsx` QueryClient defaultOptions, set `staleTime: 300_000` (5min). Leave any page-level `refetchInterval` (health page) untouched.
- [ ] **Step 6 — Run tripwire → pass; web tsc + full vitest green.**
- [ ] **Step 7 — Commit** `perf(web): dedup dashboard KPI queries, fix alert-panel waterfalls, staleTime 5min`.

---

## Task 5 — tRPC route hardening (S5)

**Files:** Modify `apps/web/app/api/trpc/[trpc]/route.ts`; Test `tests/perf/s5-route-config.test.ts`.

- [ ] **Step 1 — Failing tripwire:** assert the route file exports `maxDuration` (a number) — and `preferredRegion` ONLY if the region is decided (see step 3).
- [ ] **Step 2 — Add `export const maxDuration = 30;`** to `route.ts`.
- [ ] **Step 3 — `preferredRegion`:** if Phase-0 has confirmed the Supabase DB region, add `export const preferredRegion = ['<vercel-region-matching-db>'];` (e.g. `'pdx1'` for us-west-2). If NOT yet confirmed, DO NOT guess — leave `maxDuration` only and a code comment: `// preferredRegion: pending Phase-0 region confirmation (co-locate with Supabase DB)`. The tripwire only requires `preferredRegion` when present, not its value.
- [ ] **Step 4 — Gate green; commit** `perf(web): cap tRPC route maxDuration (+ preferredRegion pending region check)`.

---

## Task 6 — Eliminate the double `getUser()` (S1) — SECURITY-SENSITIVE, BUILT LAST

> This changes an auth path. It MUST get the most rigorous Codex SECURITY verification of the branch. Approach = fast-path-with-full-fallback: middleware (the validation point) forwards the validated identity; `createContext` uses it for the common authed-staff path and **falls through to today's exact logic unchanged** for every other case.

**Files:**
- Modify: `packages/auth/src/middleware.ts` (`updateSession` — set the trusted header)
- Modify: `apps/web/app/api/trpc/[trpc]/route.ts` (`createContext` — fast path)
- Test: `tests/perf/s1-auth-fastpath.test.ts`

**Interfaces:**
- Produces: middleware sets `x-tims-auth-uid` (validated Supabase user id) + `x-tims-auth-email` on the forwarded request headers, AFTER stripping any inbound values.

- [ ] **Step 1 — SECURITY SPIKE (no code):** confirm and write findings into the task report —
  (a) the middleware `config.matcher` covers `/api/trpc` (it does — `apps/web/middleware.ts:108` only excludes static/images), so middleware ALWAYS runs before `createContext`;
  (b) `updateSession` forwards request headers via `NextResponse.next({ request: { headers } })` (`packages/auth/src/middleware.ts:14,30`) — verify the header set AFTER `getUser` actually reaches the route handler (the `setAll` cookie callback recreates the response from the same `headers` ref — set the header on `headers` and re-create `supabaseResponse` once more after `getUser` if needed);
  (c) the strip-then-set ordering guarantees an inbound forged `x-tims-auth-*` cannot survive.
  If any of (a)-(c) does NOT hold, STOP and report — the fast path is unsafe; we keep `getUser` in `createContext` and close this slice as not-viable.
- [ ] **Step 2 — Failing behavioral test** `tests/perf/s1-auth-fastpath.test.ts`: a context-resolver helper returns the staff user via the trusted header when present (no `getUser` network call); returns the FULL-fallback path (calls `getUser`) when the header is absent; and a forged header on a request that did not pass middleware does not authenticate (middleware strips inbound). Extract a small `resolveAuthUid(headers, getUserFn)` pure-ish seam so this is unit-testable without a live Supabase.
- [ ] **Step 3 — Middleware:** in `updateSession`, after `getUser()` resolves `user`: `headers.delete('x-tims-auth-uid'); headers.delete('x-tims-auth-email');` then, if `user`, `headers.set('x-tims-auth-uid', user.id); headers.set('x-tims-auth-email', user.email ?? '')`; re-create `supabaseResponse` so the forwarded request carries them. (Always delete, even when no user, so inbound forgeries are stripped on every request.)
- [ ] **Step 4 — `createContext` fast path:** read `req.headers.get('x-tims-auth-uid')`. If present, do the existing `db.user.findUnique({ where: { supabaseUserId: uid }, include: {...} })` + all the existing active/owner/impersonation logic — but SKIP the `supabase.auth.getUser()` network call (the uid is trusted because middleware set it post-validation). If the header is ABSENT, fall through to the EXACT current logic (call `getUser()` etc.) unchanged. The candidate-portal path (`supabaseAuth` from email) and platform-owner auto-create (needs `user_metadata`) keep using `getUser()` via the fallback when there's no staff header — do not break them.
- [ ] **Step 5 — Run tests → pass.**
- [ ] **Step 6 — Gate green; commit** `perf(auth): skip redundant getUser() on the authed-staff fast path (validated in middleware)`.

---

## Self-Review (against spec)
- **S0 Codex rule** → Task 1. **S1 auth** → Task 6 (last, security-spiked). **S2 N+1** → Task 2. **S3 cache** → Task 3 (TTL-45s KPIs + flag-invalidate, teamIntel deferred to rebase). **S4 frontend** → Task 4. **S5 route** → Task 5. All spec slices covered.
- **Decisions honored:** TTL-only 45s KPIs + flags invalidate-on-update (Task 3); auth keeps validation in middleware, no `getSession()` (Task 6); raw SQL tagged-template only (Task 2).
- **Risk-ordered build:** clean wins (2-5) first; the auth change last with a mandatory security spike + Codex security review — if the spike fails, S1 is dropped and S2-S5 still ship.
- **Placeholder note:** S2's exact table/column names + S3/S4's exact current procedure bodies are read by the implementer from the live files; the transformations + new code are fully specified. S5's `preferredRegion` value is intentionally deferred to the Phase-0 region confirmation (don't guess).
- **Type consistency:** `buildMonthSeries` (Task 2), cache keys `tims:kpis:<router>:<orgId>` / `tims:flagcheck:<orgId>:<key>` (Task 3), `x-tims-auth-uid`/`-email` headers (Task 6) consistent across tasks.
