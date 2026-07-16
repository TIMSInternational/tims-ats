# Phase 3 — First real C# domain: HRIS (greenfield)

Date: 2026-07-15 · Status: **Outline; full detail JIT once Sprint 1.8 requirements firm up.**
Parent: `00-master-plan.md` · Starts after Phase 2 gate G2.

## Why HRIS is the first real domain (not a rewrite)
It's **not built yet** (Sprint 1.8 = BambooHR-first, one-way read-only sync), it's backend-heavy (sync,
scheduling, retries — .NET hosted services shine), it needs the worker infra anyway, and it has natural
Team-Suite affinity. Building it directly in C# proves the whole plane on **new value at low risk** — no
working code is touched. (The build-plan's Sprint 1.8 was originally scoped in TS; this reroutes it to C#.)

## Objective
Ship HRIS in C#, prod-live, behind the Phase-1/2 auth+tenant+RLS plane, with characterization/parity tests.
**This is also the first C# production deploy** — so it carries the hosting/deploy work.

## Exit gate G3
- BambooHR one-way read-only sync runs in prod through the C# stack.
- Tenant isolation + RBAC + audit hold live (Testcontainers + prod verification).
- The C# service is deployed, observable, and co-located with the DB region.
- Zero user-visible regression; the sync's data surfaces in the existing React UI via the generated client.

## Work packages (to detail JIT)
- **WP3.1 HRIS domain model** — connectors, external-employee records, field mapping, sync run/state, conflict
  policy (read-only → last-write-from-source). EF-owned new tables, each with `EnableTenantRls`.
- **WP3.2 Connector abstraction** — `IHrisConnector` (BambooHR first), with the existing circuit-breaker/
  retry discipline; secrets from the platform store.
- **WP3.3 Sync use case** — idempotent pull → map → upsert; runs as a scheduled worker (ties to Phase 4).
- **WP3.4 First prod deploy** — containerize `Tims.Api` + `Tims.Workers`; deploy to the DB region (AWS
  Fargate/App Runner default, or Azure per the org cloud decision); Supavisor 6543 runtime, 5432 DDL; OTel/
  Sentry wired; health/ready behind the load balancer; CORS locked to the app origin.
- **WP3.5 UI surface** — expose sync status/records via OpenAPI → generated client; a React page consumes it
  (no new backend logic in TS).
- **WP3.6 Parity/characterization** — golden fixtures for the mapping logic; RLS/audit integration tests.

## Open inputs (blockers to full detail, not to starting)
- **Sprint 1.8 HRIS requirements** (fields, BambooHR API scope, sync cadence, conflict rules).
- **Cloud host decision** (AWS vs Azure) — needed for WP3.4, since this is the first real deploy.
- Whether HRIS writes any existing TIMS table (likely new tables only → clean EF ownership; confirm in the
  ledger before building).
