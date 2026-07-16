# Phase 1 — C# Runway + the two make-or-break spikes

Date: 2026-07-15 · Status: **Detailed, ready to execute.**
Parent: `00-master-plan.md` · Architecture: `../2026-07-15-csharp-backend-target-architecture.md`

## Objective

Stand up the C# platform skeleton and **prove the two assumptions the entire convergence rests on** before
any product traffic or domain work:

- **Spike A — RLS/tenant isolation survives EF Core under transaction pooling.**
- **Spike B — the authorization kernel produces identical decisions in C# and TS, pinned by shared fixtures.**

If either spike fails, we take a risk-triggered off-ramp (master §5) — cheaply, in week one, not month six.

**Exit gate G1 (all must be green):**
1. `Tims.Platform` builds + tests in CI; `/health` + `/ready` run locally and in a container; OpenAPI emits.
2. Spike A: Testcontainers proves cross-tenant read is blocked and an unset GUC returns 0 rows — through EF +
   the RLS interceptor — on a **transaction-pooled** connection profile.
3. Spike B: `contracts/access-fixtures` passes IDENTICALLY in the TS suite and `Tims.UnitTests`.
4. Compensation read-only diff-harness spike: byte-identical C# vs TS on ≥1 real fixture.
5. Table-ownership ledger + CI check + `EnableTenantRls()` migration helper exist and are enforced.

No product endpoint depends on any of this yet.

---

## Work packages

Each WP: deliverable → acceptance criteria → notes/risks. Build each via SDD (implementer + reviewer);
the two spikes additionally get a Codex adversarial pass (they are security-critical).

### WP1.1 — Solution skeleton
**Deliverable:** `services/Tims.Platform/Tims.Platform.sln` with projects and clean-architecture references:
```txt
Tims.Api            → refs Application, Infrastructure
Tims.Application    → refs Domain            (use cases; no infra deps)
Tims.Domain         → (no project refs)       (entities, value objects, Access kernel, k-anon, policies)
Tims.Infrastructure → refs Application, Domain (EF Core, Npgsql, Redis, clients)
Tims.Workers        → refs Application, Infrastructure
tests/Tims.UnitTests, tests/Tims.IntegrationTests
```
- .NET 9 (LTS-track; confirm current LTS at kickoff). `Directory.Build.props` with `TreatWarningsAsErrors`,
  nullable enabled, analyzers on (the C# analog of TS-strict/no-any).
- `EFCore.NamingConventions` (`UseSnakeCaseNamingConvention`) so entities map to existing snake_case columns.
**Acceptance:** `dotnet build` + `dotnet test` pass locally; the dependency directions above are enforced
(Domain has zero outward refs — an architecture test via NetArchTest or a simple csproj-ref check).

### WP1.2 — CI pipeline (.NET)
**Deliverable:** a GitHub Actions workflow: restore → build (warnings-as-errors) → unit tests → integration
tests (Testcontainers, needs Docker) → format check (`dotnet format --verify-no-changes`).
**Acceptance:** green on a trivial PR; integration-test job spins a Postgres container. Note the existing
**CI billing trap** (checks may "fail" in 3-5s on spend-limit) — the .NET jobs must be distinguishable from
that (real duration, real logs); document the admin-merge path.

### WP1.3 — Runtime conventions (health, config, logging, OpenAPI)
**Deliverable:**
- `/health` (liveness) + `/ready` (readiness — checks DB + Redis).
- Config: `IOptions<T>` bound from env, **validated at startup (fail-fast)** — the C# analog of the Zod env
  gate. Secrets never in code; sourced from the platform secret store.
- Logging: Serilog → JSON (matches Pino) with request/tenant correlation ids; **never log PII/tokens/request
  bodies** (existing rule). OpenTelemetry traces on requests + EF commands, exported to the existing OTel/
  Sentry backend.
- OpenAPI doc emitted (built-in .NET OpenAPI or Swashbuckle) → written to `contracts/openapi/`.
**Acceptance:** container runs, `/health` 200, `/ready` reflects DB/Redis, OpenAPI JSON generated, a sample
log line is structured JSON with a correlation id and no PII.

### WP1.4 — **SPIKE A: RLS/tenant isolation through EF Core** (make-or-break)
**Deliverable:** the tenant data-access plumbing + a proving integration test.
- **Two Npgsql data sources / DbContext profiles:** `TenantDbContext` (connects, then `SET LOCAL ROLE
  app_tenant` + GUC per request-transaction) and `PrivilegedDbContext` (owner role, no `SET ROLE`; for
  resolved platform-owner requests only). Selected by `ITenantContext.PrincipalType`.
- **`TenantConnectionInterceptor`** (`DbConnectionInterceptor` / unit-of-work wrapper): after the per-request
  `BEGIN`, issue `SET LOCAL ROLE app_tenant` and `SELECT set_config('app.current_org_id', @org, true)`.
  `@org` comes from a scoped `ITenantContext`. Empty/absent org → empty GUC → RLS hides all rows (fail-closed).
- **`Tims.IntegrationTests` (Testcontainers-Postgres):** apply the real `tenant_isolation` policies + create
  the `app_tenant` role; seed two orgs (A, B) with rows in an org-scoped table; then assert:
  1. context(org A) reads only A's rows;
  2. context(org A) **cannot** read/update/delete B's rows (0 rows / no effect);
  3. an **unset GUC** (no tenant context) returns **0 rows** (fail-closed);
  4. behavior holds when the connection is **reused from the pool** across two different-org requests (no
     GUC leakage) — simulate transaction-mode pooling (borrow → set local → query → commit → return → borrow
     again as the other org).
**Acceptance:** all four assertions pass; **#4 is the critical one** — it proves `SET LOCAL` (not `SET`) is
correct under transaction pooling. Codex adversarial pass specifically hunts for a GUC/role leak path.
**Risk/off-ramp:** if EF's connection lifecycle can't reliably scope the `SET LOCAL` to the request txn under
pooling, fall back to (i) a thin Npgsql/Dapper tenant-data layer with explicit per-command transactions, or
(ii) a PgBouncer/proxy-injected GUC. Decide here, cheaply.

### WP1.5 — **SPIKE B: authorization-kernel golden fixtures** (make-or-break)
**Deliverable:** the shared behavior spec + a C# port of the pure kernel + wiring into both CIs.
- **`contracts/access-fixtures/` (JSON):** cases of
  `{ principal: { roles[], organizationId, isPlatformOwner, apiKeyScopes? }, module, action, dataShape? }
   → { allowed, scope, suppressed? }`. Seed it from the CURRENT TS behavior — generate expected outputs by
  running the existing `buildAccessForUser`/`resolveAccess`/k-anon over the fixture inputs (so the fixtures
  encode today's truth, not a guess). Cover: each of the 9 roles; org/company/unit/team/own scope resolution;
  `requireOrgScope` allow/deny; identity-anchored self-service; external-key scope narrowing incl.
  `alwaysEnforceScope` (the 1.6 fix); k-anon min-5 (platform) and min-3 (360) incl. suppress-by-omission.
- **`Tims.Domain.Access`:** pure C# port of the scope lattice, `ResolveAccess`, `RequireOrgScope`, the
  entity-anchor predicates, and `SuppressBelowMin(n)`. No infra deps.
- **Both CIs load the fixtures:** add a TS test that asserts the existing kernel matches the fixtures, and a
  `Tims.UnitTests` test that asserts the C# port matches the same fixtures. A behavior change edits the
  fixture once; either stack disagreeing = red build.
**Acceptance:** identical pass in both languages across the full fixture set; a deliberately-wrong C# scope
comparison makes the C# job red (proves the fixtures bite).
**Risk/off-ramp:** if a fixture can't be expressed language-neutrally (e.g. it depends on live DB rows), that
case belongs in an integration test, not the golden set — split it and note why.

### WP1.6 — Compensation diff-harness spike (throwaway)
**Deliverable:** a minimal, read-only C# port of ONE pure compensation/currency calculation + a harness that
runs the same fixture inputs through the TS calc and the C# calc and asserts byte-identical output.
**Acceptance:** ≥1 real fixture matches exactly. **This is a throwaway** — its only job is to validate the
old-vs-new diff methodology we'll reuse in Phase 5. It is NOT a committed compensation migration.

### WP1.7 — Governance rails
**Deliverable:**
- `docs/architecture/table-ownership.md` — every table → `{ owner: prisma|efcore, migratedOn? }`; a CI check
  that fails a PR mutating a table it doesn't own (parse migrations/schema touched vs the ledger).
- `EnableTenantRls("table")` EF migration helper emitting the `ENABLE + FORCE + tenant_isolation` block, so no
  org-scoped C# table can ship without RLS (encodes the FIT-engine lesson).
**Acceptance:** a sample EF migration that creates an org-scoped table without `EnableTenantRls` is caught by
a test; the ledger CI check fails a crafted cross-owner PR.

---

## Execution order & rough shape

```txt
WP1.1 skeleton ─► WP1.3 conventions ─► WP1.4 Spike A ─┐
             └──► WP1.2 CI ───────────────────────────┼─► G1 gate
WP1.5 Spike B (parallel to A, own fixtures) ──────────┤
WP1.6 comp diff-harness (after WP1.5 harness pattern) ┤
WP1.7 governance rails (parallel) ────────────────────┘
```

Spikes A and B are independent and can run in parallel. A and B are the gate; 1.6/1.7 are supporting.

## What Phase 1 deliberately does NOT do
- No product endpoints, no real domain logic, no data migration.
- No hosting/prod deploy of C# yet (that lands with Phase 3/4 when there's traffic).
- No EF ownership of any existing table yet (only the spike/test tables). Prisma still owns everything real.

## Open inputs (do not block Phase 1)
- Cloud host (AWS vs Azure) — needed for Phase 3/4 deploy, not for Phase 1 local/CI spikes.
- Team Suite study — feeds Phase 6, irrelevant here.
- Exact .NET LTS + EF/Npgsql versions — confirm at kickoff (pin exact versions, lockfile committed — the
  slopsquatting/version-pin rule applies to NuGet too).
