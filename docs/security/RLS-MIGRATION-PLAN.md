# Database-Level Tenant Isolation (Postgres RLS) — Migration Plan

> Status: **FOUNDATION BUILT + EMPIRICALLY VERIFIED — not yet enforced in prod.**
> Owner: NexaDev. Created after the 2026-06-04 security audit; highest-priority
> remaining security item.

## ⚠️ Activation must use the POOLER (6543), not the direct endpoint (5432)

Enabling enforcement makes the app open **two** connection pools (the privileged
`postgres` pool for the context builder / platform routers, **and** the `app_tenant`
pool for tenant routers). On the **direct** connection (port 5432) this doubles
connection usage and exhausts Supabase's direct-connection limit — observed
firsthand: setting `TENANT_DATABASE_URL` to the direct endpoint under load made the
endpoint refuse new connections. **`TENANT_DATABASE_URL` MUST point at the Supavisor
pooler (port 6543, transaction mode)**, which is also why the per-query
`set_config`-in-transaction design was chosen (it survives transaction-mode pooling).

## Applied state (2026-06-04)

- ✅ **RLS migration APPLIED to the database**: 81 tables RLS-enabled with the
  `tenant_isolation` policy; `app_tenant` role created (`rolbypassrls = false`).
  Verified counts (81/81). Because `postgres` bypasses RLS, the running app
  (which connects as `postgres`) is **unaffected** — RLS is currently dormant.
- ✅ **DB-layer isolation PROVEN as `app_tenant`** across direct tables (candidates,
  vacancies, interviews, offers, onboarding_plans, salary_bands, webhooks), the
  `organizations` special-case (`id` policy), and the `user_roles` child table
  (parent-join policy): scoped org sees its rows, no-context sees 0 (fail-closed).
- ⏸️ **Not yet activated against the app**: `TENANT_DATABASE_URL` is intentionally
  left **unset** (the direct endpoint can't sustain the doubled pool — see warning
  above). Activation is one env var away once the pooler URL is used.

### Cutover attempt findings (2026-06-04) — BLOCKED on Supavisor + custom role
Tried to activate locally and hit two Supabase-platform constraints:
- **Direct endpoint is IPv6-only.** `db.lzhfnjfsdwdywwnlqgqq.supabase.co` has only an
  AAAA record (`2600:1f14::/34` → **us-west-2**); from an IPv4/flaky-IPv6 network it's
  intermittently unreachable. So the app should use the **pooler** for all connections.
- **Pooler found:** `aws-1-us-west-2.pooler.supabase.com:6543` (usernames
  `postgres.lzhfnjfsdwdywwnlqgqq` / `app_tenant.lzhfnjfsdwdywwnlqgqq`, add `?pgbouncer=true`).
  The `postgres` user authenticates and queries fine through it (base connection works).
- **BLOCKER:** Supavisor **rejects the custom `app_tenant` role** ("authentication failed …
  credentials for app_tenant are not valid"), even though that exact password works on the
  direct connection (proven by the isolation tests). Repeated attempts trip Supavisor's
  **auth circuit breaker** (`ECIRCUITBREAKER`), temporarily blocking all pooler connections.
  This is a known friction with custom DB roles + Supavisor; the built-in roles work but
  bypass-less custom roles may need Supabase-side enablement.

**Resolution options for the user (pick one):**
1. Make `app_tenant` authenticate via Supavisor — verify in the Supabase dashboard /
   support that custom roles are permitted on the pooler; may need recreating the role or a
   pooler cache refresh.
2. Use **session-mode pooler** (`aws-1-us-west-2.pooler.supabase.com:5432`) for
   `TENANT_DATABASE_URL` — session mode handles role auth differently and may accept app_tenant.
3. Enable the Supabase **IPv4 add-on** and connect `app_tenant` to the direct endpoint
   (where it's already proven to work) with a small `connection_limit`.

Until one is in place, `TENANT_DATABASE_URL` is left unset (RLS applied but dormant; app
runs on the `postgres` connection unchanged).

### To activate (ops)
1. In Supabase, get the **pooler** connection string (port 6543). Build the
   `app_tenant` variant (username `app_tenant.<project-ref>`).
2. Rotate the role password: `ALTER ROLE app_tenant PASSWORD '<secret>';` and store it.
3. Set `TENANT_DATABASE_URL` to that pooler connection string (app + Vercel).
4. Restart, run `scripts/rls-isolation-check.ts` against it, smoke-test the app,
   benchmark p95, then ship. Rollback = unset `TENANT_DATABASE_URL` (instant) and/or
   `ALTER TABLE … DISABLE ROW LEVEL SECURITY` per table.

## Implementation status (what is done vs remaining)

**Done & verified**
- ✅ Confirmed the blocker: the app connects as `postgres`, which has
  `rolbypassrls = true` — RLS is a no-op for it. The app must connect as a
  dedicated non-bypass role (`app_tenant`).
- ✅ Migration written: `packages/db/prisma/migrations/20260604100000_enable_rls_tenant_isolation/migration.sql`
  — creates `app_tenant`, grants, and `ENABLE/FORCE RLS` + `tenant_isolation`
  policies on **81 tables** (71 by `organization_id`, `organizations` by `id`,
  9 child/join tables by parent join; 3 global catalogs intentionally skipped).
- ✅ **Empirically proven on the live Supabase instance** (scoped, reversible):
  `app_tenant` scoped to org A sees only A's rows; org B sees **0** of A's rows;
  unset GUC returns 0 with **no error** (fail closed); `WITH CHECK` blocks
  cross-org writes; `postgres` keeps bypassing so the app is unaffected.
- ✅ Found & fixed a policy bug during the proof: use
  `NULLIF(current_setting('app.current_org_id', true), '')::uuid` — an unset GUC
  returns `''`, and `''::uuid` raises instead of hiding rows.
- ✅ App-layer foundation shipped **inert**: `tenant-context.ts` (AsyncLocalStorage)
  and `tenant-client.ts` (`tenantDb` — sets the GUC in the same transaction as each
  query). Gated on `TENANT_DATABASE_URL`; until that points at `app_tenant`, `tenantDb`
  is a transparent passthrough over the base `db` (zero behavior/perf change).

**Cutover progress**
- ✅ Wiring done: the tenant-procedure middleware (`withTenantContext` in `trpc.ts`)
  wraps every authenticated request in `runWithTenant(orgId, …)`. Verified the full
  mechanism on the live DB: the extension's batch `$transaction([set_config, query])`
  scopes correctly (org A → its rows, org B → 0), and no-regression smoke (portal 200,
  a tenant endpoint returns 401 not 500).
- **Router opt-in pattern** (chosen over `ctx.db` to avoid extended-client typing
  friction): a tenant router changes one line — `import { db }` → `import { tenantDb as db }`
  — and every `db.*` call is then org-scoped via RLS. `onboarding.ts` is migrated as the
  reference. Inert until `TENANT_DATABASE_URL` is set, so each router migration is a
  zero-behavior-change diff.

**Remaining (do on staging first)**
1. Establish a Prisma migration **baseline** (repo uses `db push`), then apply this
   migration (or run the SQL via `psql` as the privileged role).
2. Rotate the `app_tenant` password (`ALTER ROLE app_tenant PASSWORD '<secret>'`),
   store it, set `TENANT_DATABASE_URL` to its connection string (pooler, 6543).
3. ✅ **Router migration DONE.** All 37 tenant router/repository files now
   `import { tenantDb as db }` (offer/*, vacancy/*, interview/*, performance/*,
   assessment, learning, engagement, compensation, succession, ninebox, dei, team-intel,
   monitoring, notification, billing, integration, user, organization, audit, featureFlag,
   onboarding + `candidate.repository.ts`/`pipeline.repository.ts`). KEPT on privileged
   `db`: all `routers/platform/**`, `portal.ts`, `auth.ts`, the tRPC context builder, the
   `trpc.ts` audit/permission middleware, and workers.
   - **Clean for enforcement:** verified there are **no `$transaction` and no
     `$queryRaw`/`$executeRaw` calls in any migrated tenant file**, so the extension's
     per-operation `$transaction([set_config, query])` has no nested-transaction or
     raw-bypass hazards. (If interactive transactions are added to tenant code later, the
     extension must set the GUC once at the transaction start instead of per-op.)
4. Add `tests/security/tenant-isolation.test.ts` (or run `scripts/rls-isolation-check.ts`
   in CI against a seeded staging DB) asserting cross-tenant reads/writes are blocked
   **on the pooled connection**.
5. Benchmark dashboard + pipeline p95 (target < 10% regression), then roll out.

> Note on platform owners: `withTenantContext` lets platform owners through without an
> org context. They must only use platform routers (privileged `db`); a platform owner
> hitting a migrated tenant router post-cutover would be scoped to "no org" (sees
> nothing) — acceptable, but keep platform UIs on platform routers.

## 1. Why this exists

The 2026-06-04 audit verified against the live database that the "defense in depth"
described in CLAUDE.md §3 does **not** exist:

- **RLS is disabled on every tenant table**; `pg_policies` is empty.
- The Prisma tenant middleware (`withTenantIsolation`) is **never wired into any client**.
- The `set_config('app.current_org_id', …)` call in `trpc.ts` is read by nothing,
  and with `is_local = true` it would not even survive past its own statement on a
  pooled connection.

**Consequence:** application-level `WHERE organizationId = …` is the *only* tenant
boundary. Every missing check is a cross-tenant breach (this is exactly how the IDOR
bugs fixed in PR #2 were introduced). RLS is the automatic safety net that makes a
forgotten `WHERE` fail closed instead of leaking another tenant's data.

## 2. Goals / non-goals

**Goals**
- Every tenant-scoped table rejects rows outside the caller's org at the database
  layer, regardless of application bugs.
- Platform owners (no org) and trusted server jobs continue to work.
- No measurable correctness regressions; bounded, measured latency cost.

**Non-goals (this migration)**
- Replacing the application-level `WHERE` checks (keep them — belt and suspenders).
- Re-architecting routers onto a service layer (separate effort).

## 3. The core problem: the GUC must be set on the *same* connection as the query

RLS policies read a per-session/per-transaction GUC:
`current_setting('app.current_org_id', true)`. With Supabase **transaction-mode
pooling (Supavisor / pgbouncer, port 6543)** a connection is handed back to the pool
after each transaction, so:

- `SET` at session scope does **not** persist across queries.
- `set_config(..., is_local => true)` only lives for the **current transaction**.

Today the app issues many independent `db.x.findMany()` calls per request, each its
own implicit transaction on a (possibly different) pooled connection. So a GUC set in
middleware never applies to the actual query. **This is the central thing to fix.**

### Two viable strategies

**Strategy A — Prisma client extension that wraps every op in a transaction (RECOMMENDED).**
A `$extends({ query: { $allOperations } })` that, per operation, runs:
```
BEGIN;
SELECT set_config('app.current_org_id', $1, true);  -- transaction-local
<the actual query>;
COMMIT;
```
The org id comes from request context (see §5). This guarantees the GUC and the query
share a transaction/connection. Cost: one extra round-trip per query (mitigate in §8).

**Strategy B — interactive transaction per request.** Wrap each request's work in
`db.$transaction(async (tx) => { await tx.$executeRaw set_config; …all queries via tx… })`
and thread `tx` everywhere. Rejected: requires touching all 46 routers and breaks the
fire-and-forget email/await patterns. Strategy A is transparent to routers.

**Decision: Strategy A**, exposed as a per-request client on `ctx.db` (see §5), with the
existing global `db` reserved for un-scoped/platform/system use.

## 4. Connection role & BYPASSRLS — verify FIRST (blocking prerequisite)

RLS is ignored for the table owner and for roles with `BYPASSRLS`. Supabase's default
`postgres` superuser (commonly used in `DATABASE_URL`) **bypasses RLS**, which would make
every policy a no-op. Before writing any policy:

1. Identify the role Prisma connects as:
   `SELECT current_user, current_setting('is_superuser');`
2. Check bypass: `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;`
3. If it is superuser / owner / `BYPASSRLS`, either:
   - Add `FORCE ROW LEVEL SECURITY` to every table (forces RLS even for the owner), **and/or**
   - Create a dedicated **non-superuser** application role (e.g. `app_tenant`) that owns
     nothing, has `NOBYPASSRLS`, and is granted CRUD on the tenant tables; point the
     application `DATABASE_URL` at it. Keep `DIRECT_URL`/migrations on the privileged role.

`FORCE ROW LEVEL SECURITY` is the simplest reliable guarantee and is recommended in
addition to a dedicated role.

## 5. Where org context comes from

`ctx.user.organizationId` is already derived server-side from the verified Supabase
session (not client input) — trustworthy. Plumb it to the extension via **AsyncLocalStorage**
so routers don't change:

- In the tRPC context builder, run the request inside `tenantContext.run({ orgId }, …)`.
- The Prisma extension reads `tenantContext.getStore()?.orgId` to choose the GUC value.
- If no org in scope (platform owner, cron, system): **do not** set the GUC; route those
  through a separate client/role that is allowed to bypass (platform queries already use
  `platformProcedure` and operate cross-org by design).

Validate `orgId` as a UUID before use (already done in `trpc.ts`).

## 6. The migration (per tenant table)

Tenant tables = every model with an `organization_id` column (candidates, vacancies,
applications, pipeline_stages, interviews, offers, assessments…, onboarding_*, okrs,
key_results, invoices, subscriptions, webhooks, connectors, api_keys, users, companies,
business_units, etc.). Generate the list from Prisma:
`models where fields include organizationId`.

For each table `t`:
```sql
ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "t" FORCE ROW LEVEL SECURITY;

-- Reads/writes restricted to the caller's org.
CREATE POLICY tenant_isolation ON "t"
  USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Notes:
- `current_setting(…, true)` returns NULL when unset; `NULL = uuid` is NULL → row hidden
  (fails closed). Good: an un-scoped query sees nothing rather than everything.
- `WITH CHECK` blocks INSERT/UPDATE that would write a row into another org.
- Join/child tables without `organization_id` (e.g. `user_roles`, `role_permissions`,
  `interview_evaluators`) need either an added `organization_id` (preferred, with backfill)
  or a policy that joins to the parent. Decide per table; prefer denormalizing
  `organization_id` onto child tables for simple, fast policies.
- Platform/global tables (`platform_owner_emails`, `permissions`, system config) get **no**
  RLS (accessed by platform role only).

Ship as a real Prisma migration (`prisma migrate`), not `db push`. NOTE: the repo currently
has no migration baseline — establish one first (`prisma migrate diff` from empty →
current schema as the initial migration, mark applied with `migrate resolve`), then add the
RLS migration on top. See `packages/db/prisma/migrations/`.

## 7. Platform owner & background jobs

- Platform-owner requests carry no org → the extension does not set the GUC → policies hide
  all tenant rows. Platform owners must use a **privileged path** (a separate client/role
  with `BYPASSRLS`, or `SET app.bypass = on` + a permissive policy branch). Simplest:
  platform routers use the existing global `db` connected via a privileged role; tenant
  routers use the RLS-scoped `ctx.db`.
- Trigger.dev workers / SES jobs that act for a tenant must set the GUC themselves (reuse the
  same extension with an explicitly passed orgId).

## 8. Performance

- Strategy A adds one `set_config` round-trip per query. Mitigations: enable statement
  pipelining; batch a request's reads with `Promise.all`; cache hot reads (Upstash, already
  planned); keep the `set_config` as the first statement in the same `BEGIN/COMMIT`.
- Add indexes on `organization_id` (most already exist per CLAUDE.md §5) — RLS predicates
  must be index-backed to avoid seq scans.
- Benchmark p50/p95 on dashboard + pipeline endpoints before/after; target < 10% regression.

## 9. Testing — prove isolation, don't assume it

1. **Unit/integration:** seed two orgs A and B. With the GUC set to A, assert that
   `findMany`/`findFirst`/`update`/`delete` on B's row ids return empty / throw / affect 0
   rows for every tenant model. Add to `tests/security/`.
2. **Negative test for the fix itself:** temporarily remove an application-level `WHERE`
   in a test and confirm RLS still blocks cross-tenant access (proves the net works).
3. **Platform-owner path:** assert platform routers still see cross-org data.
4. **Regression:** full E2E of the careers portal + a tenant dashboard on a staging DB with
   RLS enabled before production.
5. **Pooler reality check:** run the isolation test against the **pooled** (6543) connection,
   not just a direct connection — this is where the transaction-scope assumption is validated.

## 10. Rollout & rollback

- Land behind a staging database first; never `db push` to prod.
- Roll out table-by-table if desired (RLS is per-table) to limit blast radius.
- **Rollback:** `ALTER TABLE t DISABLE ROW LEVEL SECURITY;` per table (instant, no data
  change). Keep the application-level `WHERE` checks throughout so disabling RLS never
  exposes data — it only removes the safety net.

## 11. Acceptance criteria

- [ ] Prisma connection role verified `NOBYPASSRLS` (or `FORCE RLS` on all tables).
- [ ] Every `organization_id`-bearing table has RLS enabled + `tenant_isolation` policy.
- [ ] Child tables without `organization_id` resolved (denormalized + backfilled or parent-join policy).
- [ ] `ctx.db` extension sets the GUC in the same transaction as each query; routers unchanged.
- [ ] Platform-owner and worker paths function (cross-org where intended).
- [ ] `tests/security/tenant-isolation.test.ts` proves cross-tenant reads/writes are blocked **on the pooled connection**.
- [ ] p95 latency regression < 10% on dashboard + pipeline.
- [ ] CLAUDE.md §3 updated to mark RLS as IMPLEMENTED.

## 12. Estimated effort

2–4 focused days: ~0.5d role/bypass verification + baseline migration, ~1d extension +
AsyncLocalStorage wiring, ~1d policies + child-table denormalization/backfill, ~1d testing
+ benchmarking on staging.
