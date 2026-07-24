# TIMS C# Cutover Verification Harness — Design Spec

- **Date**: 2026-07-24
- **Status**: Design approved (Federico); pending spec review → implementation plan
- **Owner**: NexaDev LLC
- **Related**: `PROD-DEPLOY-RUNBOOK-gate-g3.md` §6 (cutover order), `phase-5-slice-6-team-intel-read.md`,
  `contracts/access-fixtures/` (RBAC golden), memory `resume-tims-csharp-fx-gateway-11c`,
  `tims-redis-upstash-bridge-elasticache-preprod`

## 1. Purpose & context

The TIMS backend is migrating **TS (tRPC/Prisma on Vercel) → C# (.NET on AWS App Runner)**,
strangler-style, one surface at a time behind per-surface feature flags — **all currently dark**.
The first prod deploy is live (App Runner `tims-platform-api`, us-west-2, `/ready` Healthy,
DB + Redis wired). Before any surface's flag stays flipped in prod, we must prove the C#
implementation is:

- **(P) Parity** — output-identical to the TS implementation on real data,
- **(R) RLS** — tenant-isolated (a tenant can never read another tenant's rows through C#),
- **(B) RBAC** — correctly permissioned (role × module:action:scope enforced, k-anon intact),

**end-to-end against the live App Runner service + the real Supabase prod DB** — not just in CI.
This harness makes that verification **repeatable and push-button**, so each per-surface canary is
fast and rigorous instead of manual.

## 2. Goals / non-goals

**Goals**
- Repeatable P/R/B verification per surface with a single red/green verdict.
- Zero-risk **pre-flip** preparation (no feature flag touched).
- Generic across read surfaces — adding the next surface is **config, not code**.
- Self-verifying: the harness proves it can go red (not vacuously green).

**Non-goals (v1)**
- Load / performance testing.
- Write-surface parity (reads cut over first; write verification is a later extension).
- Replacing the CI layer. The existing **golden fixtures** (RBAC kernel byte-identical both stacks)
  and **Testcontainers real-RLS** tests remain the code-level proof; this harness is the
  **deploy-verify layer on top**, against live prod.

## 3. Architecture

A **TypeScript CLI** at `scripts/parity/`, run locally against the two prod base URLs. Secrets read
from a **git-ignored** `scripts/parity/.env` (root `.gitignore` line 14 `.env` already covers it —
verified via `git check-ignore`). Subcommands:

```
tims-parity seed [--teardown]      # create/remove test orgs + users
tims-parity auth                   # mint real Supabase tokens (signInWithPassword)
tims-parity parity   <surface>     # diff C# vs TS output
tims-parity rls      <surface>     # cross-tenant isolation probe
tims-parity rbac     <surface>     # role × endpoint permission matrix
tims-parity verify   <surface>     # parity + rls + rbac + report
tims-parity report                 # aggregate green/red
```

Surface definitions live in a config module (`surfaces.ts`). The C# side is called via the repo's
**generated OpenAPI client** (`apps/web/lib/platform-api/`); the TS side via a thin **tRPC HTTP
caller** (POST the tRPC batch endpoint, strip the superjson envelope).

## 4. Components (each single-purpose)

1. **`seed`** — using the `service_role` admin API, **idempotently** creates 2 clearly-named test
   orgs (`__parity_a`, `__parity_b`), one user per key role in each (known passwords), their
   membership + role grants, and the minimal seed data the surface-under-test reads. Idempotent
   (safe to re-run) and reversible (`--teardown` removes everything it created).
2. **`auth`** — `supabase.auth.signInWithPassword` via the **anon** key → real **ES256** access
   tokens per (org, role); cached + refreshed. *(We cannot self-sign tokens: C# validates against
   Supabase's ES256 JWKS and we don't hold the private key — so the harness authenticates real
   seeded users to obtain genuine Supabase-signed tokens.)*
3. **`parity`** — for a configured surface, calls **TS** (tRPC, superjson-stripped) and **C#**
   (REST) with the *same* token + inputs, **normalizes** (ISO date strings, array ordering, nullable
   omission per the documented DTO shapes), and **deep-diffs**. Reports every divergence with path.
4. **`rls`** — with org-A's token: assert every returned row belongs to org A; attempt to fetch an
   org-B resource **by id** → expect `404`/empty. The **#1 safety check**.
5. **`rbac`** — run each role's token across the surface's endpoints; assert `200`/`403` matches the
   **expected grant matrix** (sourced from `contracts/access-fixtures` + the surface config,
   including k-anon suppression where applicable).
6. **`report`** — aggregate per-surface, per-check green/red with actionable diffs.

## 5. Data flow

`seed` → users/orgs/data exist. `auth` → tokens per (org, role). For a surface: `parity`/`rls`/`rbac`
call the live endpoints with those tokens → diff/assert → `report`.

## 6. Run modes (surfaces are dark until flipped)

- **Pre-flip (now, zero-risk):** `seed` + `auth` + capture TS **golden baselines** + run the C#
  **structural matrix** that needs no flag (`401` unauth / `403` under-permissioned / `404` dark).
  No feature flag is touched. This builds and self-tests the whole harness safely.
- **Canary (at flip):** Federico flips **one** surface's flag → harness runs full `parity` +
  `rls`-with-data + `rbac`-allow → verdict → **keep** (clean) or **flip back** (any red, instant
  rollback). Then delete that TS router.

## 7. First configured surface: team-intel read

`getDashboardKpis` (+ members table once its FE wrapper is wired), matching
`phase-5-slice-6-team-intel-read.md`. Flag `Platform__TeamIntelReadEnabled` (exact name confirmed
from code at build time). Endpoints, inputs, and the expected RBAC matrix are defined in the surface
config. Chosen because it is the lowest-risk surface and its FE wrapper is already staged in
`apps/web/lib/platform-api/`.

## 8. Secrets & safety

- `service_role` key used **only** by `seed`; `anon` key used by `auth`. Both in git-ignored `.env`.
- Test orgs are clearly named (`__parity_*`), RLS-isolated, and torn down after full cutover.
- **Prod-write acknowledgement:** seeding creates test orgs in the **prod** Supabase (there is no
  separate staging DB). Federico chose the seeded-test-org approach knowing this.
- **`service_role` rotation** recommended after verification is complete (the key transited chat).

## 9. Self-test (trust the verdicts)

The harness includes a deliberate **known-divergence** check: injecting a wrong field must make
`parity` go **red**, and treating a same-org id as cross-tenant must make `rls` go **red**. This
guarantees green means something.

## 10. Open items (resolved before / during build)

- **TS prod base URL** (Vercel domain / tRPC endpoint) — pending from Federico; `TIMS_TS_BASE` in `.env`.
- Confirm exact **flag names** + **tRPC procedure paths** + **C# route paths** from code at build time.
- k-anon / suppression specifics per surface captured in the surface config as surfaces are added.

## 11. Testing strategy

- Unit: normalizers (date/order/null), superjson stripper, diff engine — fixture-driven.
- Self-test (§9) run in CI-lite mode against recorded fixtures (no network) so the harness logic is
  regression-guarded independent of live endpoints.
- The live P/R/B checks are the integration/acceptance layer, run at each canary.
