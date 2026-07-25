# Write-Verification Harness — Design (tracer: compensation)

**Date**: 2026-07-24 · **Status**: approved (Federico) · **Scope**: one tracer surface, live-verified.

## Goal
Extend `scripts/parity/` to verify the C# **write** surfaces before their cutover — the write analog of the
read harness (Tier-1 + Tier-2). Tracer = compensation's 2 writes; roll the other 4 surfaces in a follow-up PR.
The C# write endpoints are dark behind `Platform__CompensationWriteEnabled` (OFF); the tracer is live-verified
after Federico flips that flag at canary, mirroring the read cutover flow.

## Scope decisions (Federico)
- **Depth**: IDOR + RBAC + **light parity** (no live TS double-write; golden = the known TS contract shape).
- **Build**: tracer = compensation (2 writes), live-verified. Others follow.

## The three checks (per write endpoint)
Writes mutate, so the checks differ from reads in what they mutate and how they're asserted. Every assertion
uses a **DB read-back** via the existing `postgres`/BYPASSRLS `pg` client (the one seed/`resolveResources` use).

1. **Write-IDOR** — org-A token → the write against an **org-B** resource → assert **denied** (create: subject
   out-of-org → 403; approve: `assertScoped` out-of-org → 404) **AND a read-back proves org-B was NOT mutated**
   (the org-B pending adjustment is still `pending`). A 403/404 that still mutated is the worst-case write leak,
   so no-mutation is verified, not assumed. No mutation.
2. **Write-RBAC deny** — the deny role (hrbp, which lacks compensation `create`/`approve`) → the write on an
   org-A resource → assert **403** AND read-back unchanged. No mutation.
3. **Light parity** (also the "allow"-role RBAC proof) — the probe role (super_admin) → the write **once** →
   assert **200 + response matches the golden** + a **DB read-back of the created/mutated row matches the
   golden**. This is the single mutation per endpoint. Golden = a hardcoded expected shape from the TS contract.

**Ordering** (critical): the two non-mutating checks (IDOR, RBAC-deny) run **before** the mutating light-parity,
so the org-A precondition is intact when they read it back. All mutations touch only synthetic `__parity_a/b`
tenants and are swept by teardown. **Write-verify requires a fresh `teardown + seed`** (not a bare re-seed):
an approve mutates the seeded pending row, and a bare re-seed would then create a *second* pending row.

## Architecture (additive to the existing harness)
- **`callers.ts`** — `callCsharpWrite(base, method, path, token, body, fetchFn?)`: POST/PATCH, `Bearer` +
  `Content-Type: application/json`, JSON body, returns `{status, body}` (mirrors `callCsharp`; JSON-or-text fallback).
- **`write-surfaces.ts`** (new registry, parallel to `SURFACES`) — `WriteSurface` / `WriteEndpointDef`:
  `{ name, method: 'POST'|'PATCH', csharpPath (with `{id}` sentinel), flag, idScopeKey?, bodyTemplate (with `{id}`
  sentinels for path/subject ids), expectedByRole (deny roles only + the probe), probeRole, golden }`.
  `golden = { response: <expected {id,status} matcher>, readback: { sql, params(ids), expectRow }, noMutation?: {...} }`.
- **`checks/write-parity.ts`, `checks/write-rbac.ts`, `checks/write-idor.ts`** — each takes the write caller + a
  `readback(sql, params) => rows` fn (injected; unit-tested with fakes). They return the same `CheckResult` union
  the report renderer consumes (`check: 'write-parity'|'write-rbac'|'write-idor'`).
- **`ids.ts`** — reuse `substituteEndpointId` for the org-A id substitution into `csharpPath` + `bodyTemplate`.
- **`seed.ts`** — `seedCompensationWritePreconditions(db, orgIds, userIds)` seeds the org-B pending adjustment
  (approve IDOR target); the org-A pending adjustment already exists from `seedCompensationData` (reused as the
  approve fixture — no second org-A pending, so read `pending-adjustments` parity is unaffected). `resolveWriteResources`
  returns `adjustment: { a, b }` by natural-key lookup (`WHERE org=? AND user_id=? AND status='pending'`).
- **`cli.ts`** — `verify-write <surface>` command: runs IDOR → RBAC-deny → light-parity per endpoint, renders the report.

## Per-endpoint spec (grounded in the C# + TS contracts)

### 1. `POST /compensation/adjustments` — createAdjustment (create)
- **Body** (org-A light parity): `{ userId: <employee.a = a:hr_admin>, type:'merit', previousSalary:60000,
  newSalary:66000, currency:'USD', reason:'parity', effectiveDate:'<Z-ISO>' }`.
- **Gate**: `compensation:create` + `assertSubjectInScope`. super/hr → 200; hrbp → **403** (no create grant);
  out-of-org subject → **403**.
- **Light parity**: 200 `{ id, status:'pending' }`; read-back the new `salary_adjustments` row → `status='pending'`,
  `user_id=employee.a`, `new_salary=66000`, `requested_by_id=<super_a id>`, `approved_by_id=null`. (Golden asserts
  those columns; `id` is dynamic → assert present + uuid.)
- **Write-IDOR**: super_a token, body `userId=<employee.b = b:hr_admin>` (an org-B user) → **403** (subject out of
  org-A scope) + read-back: **no** `salary_adjustments` row exists with `user_id=employee.b` (create was rejected
  pre-insert). No mutation.
- **RBAC-deny**: hrbp_a token, valid org-A body → **403** + read-back: no new row with `requested_by_id=<hrbp_a>`.
- Note: create has **no uniqueness/precondition** — its light-parity always inserts a fresh row (swept by teardown).

### 2. `POST /compensation/adjustments/{id}/approve` — approveAdjustment (state transition)
- **Precondition**: a `pending` `salary_adjustments` row in org A (`adjustment.a`, reused from `seedCompensationData`:
  user a:hr_admin, new_salary 66000) + one in org B (`adjustment.b`, seeded by `seedCompensationWritePreconditions`:
  user b:hr_admin). Both subjects have an `employee_compensations` row (a:hr_admin from `seedCompensationData`,
  b:hr_admin from `seedOrgBTier2Mirrors`) so the comp-update side effect is assertable.
- **Body**: `{ approved: true }`.
- **Gate**: `compensation:approve` + `assertScoped('salaryAdjustment', id)` IDOR probe. super/hr → 200; hrbp → **403**
  (no approve grant); out-of-org id → **404** (IDOR-safe).
- **Write-IDOR**: super_a token → `.../{adjustment.b}/approve` → **404** + read-back: `adjustment.b` is **still
  `status='pending'`** and b:hr_admin's `employee_compensations.current_salary` is **unchanged** (the critical
  write-leak check — a 404 that still flipped org-B's row is a severe bug). No mutation.
- **RBAC-deny**: hrbp_a token → `.../{adjustment.a}/approve` → **403** + read-back: `adjustment.a` still `pending`. No mutation.
- **Light parity**: super_a token → `.../{adjustment.a}/approve` `{approved:true}` → 200 `{ id:adjustment.a,
  status:'approved' }`; read-back: `adjustment.a.status='approved'`, `approved_by_id=<super_a>`, AND
  `employee_compensations(current_salary)` for a:hr_admin = **66000** (the tx side effect). This is the one mutation.

## Safety + repeatability
- Only synthetic `__parity_a/b` tenants are ever written; no real money/data. Teardown sweeps all
  `salary_adjustments`/`employee_compensations` rows (already org-scoped in `teardown()`).
- `verify-write` runs `teardown + seed` first (fresh single pending row); the light-parity's mutation is reset on
  the next run. IDOR/RBAC-deny never mutate (verified by read-back), so they're order-independent among themselves.

## Gate
- Local: parity unit tests (fakes for the caller + read-back) + `tsc` 0 + gitleaks clean.
- Federico flips `Platform__CompensationWriteEnabled` at canary (prepped flip JSON, like the read flips).
- **LIVE `verify-write compensation` all green** (the real proof — 2 endpoints × {idor, rbac-deny, light-parity}).
- Fresh-context opus adversarial review (Codex usage-limited). Merge.

## Roll-out (follow-up PRs)
Other 4 write surfaces (evaluation360, succession, nine-box, engagement — ~16 endpoints) reuse this mechanism:
each adds a `WriteSurface` registration + preconditions + goldens. State-machine writes (open/close/publish,
activate/finalize) follow the approve pattern (seed a precondition in the from-state; IDOR/RBAC-deny non-mutating;
light-parity transitions once). Multi-write surfaces seed distinct precondition rows per endpoint to avoid interference.
