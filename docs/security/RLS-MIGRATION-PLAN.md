# Database-Level Tenant Isolation (Postgres RLS) — Migration Plan

> Status: **PLANNED — not yet implemented.** Owner: NexaDev. Created after the
> 2026-06-04 security audit. This is the highest-priority remaining security item.

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
