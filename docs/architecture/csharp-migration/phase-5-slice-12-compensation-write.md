# Phase-5 Slice 12 — Compensation WRITE surface (createAdjustment + approveAdjustment) → C#

**Status:** built, dark-by-default behind `Platform:CompensationWriteEnabled` (default false).
**Kind:** the FIRST WRITE port of the compensation domain (`efcoreStranglerWrite`), after Slice-9 (FX-free reads)
and Slice-11c (FX reads) completed the read surface. NO ownership flip — TS stays the sole active writer until
Federico flips the flag per-surface at canary (dark → canary → full). Deploy-gated cutover, deferred.

Ports the LAST two bodies of `packages/api/src/routers/compensation.ts` still on TS:
- `createAdjustment` (`permissionProcedure('compensation','create')`, L276)
- `approveAdjustment` (`permissionProcedure('compensation','approve')`, L324)

With these two writes ported, the ENTIRE `compensation` router (12 reads + 2 writes) has a C# analog.

## Endpoints (dark-by-default)

| Method | Route | TS analog | Gate |
|--------|-------|-----------|------|
| POST | `/compensation/adjustments` | createAdjustment | staff-JWT + `compensation:create` + `assertSubjectInScope` on the TARGET userId |
| POST | `/compensation/adjustments/{id}/approve` | approveAdjustment | staff-JWT + `compensation:approve` + `assertScoped('salaryAdjustment', id)` by-id IDOR probe |

Mapped ONLY when `Platform:CompensationWriteEnabled` is true OR at build-time OpenAPI generation
(`GetDocument.Insider`) — so the emitted contract stays accurate while runtime stays dark. `TS stays the single
active writer` is a runtime FACT, not a ledger claim.

## createAdjustment — faithful port

1. **Write-rule subject scope** (most sensitive check in the module): there is NO row to probe yet, so gate on
   whether the TARGET `input.userId` is inside the caller's subject set — `SubjectInScope.IsSatisfiedAsync(scope,
   anchors, callerId, targetUserId)`. Out-of-set → 403 `"No puedes crear ajustes para este usuario"`. (Exactly the
   simulate-adjustment endpoint's anchor-loader pattern.)
2. **Currency fallback**: `currency = normalizeCurrencyCode(input.currency, subjectComp?.currency ?? 'USD')` —
   `CurrencyCodes.NormalizeCurrencyCode(input.currency, subjectCurrency ?? "USD")`. The subject's
   `employee_compensations.currency` is read (or null) under TenantScope. Not atomic with the insert (TS is not).
3. **INSERT** `salary_adjustments` `{ userId, type, previousSalary, newSalary, currency, reason, effectiveDate,
   organizationId, requestedById = caller, status = 'pending' }` (a TRACKED EF add). id is client-generated
   (`Guid.NewGuid()`, Prisma `@default(uuid())` parity); `created_at`/`updated_at` set explicitly (Prisma sets
   them client-side); `effective_date` written as the Prisma `timestamp(3)` UTC wall-clock (Unspecified kind,
   truncated to whole ms).
4. **§21 minimal-select**: returns ONLY `{ id, status }` — `previousSalary/newSalary/reason` are NEVER echoed from
   a write response. **NO audit** (nothing restricted is returned).

## approveAdjustment — faithful port

1. **assertScoped('salaryAdjustment', id)** by-id IDOR probe (belt-and-braces; approve needs an explicit org
   grant). Out-of-scope → `ScopedNotFoundException` → 404 `"Ajuste salarial no encontrado"` (never confirms the id
   exists to a narrow-scoped id-guesser). See "assertScoped probe root" below.
2. **Load pending** `salary_adjustments` `findFirst({ id, org, status:'pending' })` select `{ userId, newSalary,
   currency }`; null → 404 `"Ajuste no encontrado o ya procesado"` (the TS `throw new Error(...)`).
3. **Fail-closed audit BEFORE the mutation** (`salaryAdjustment`, `update`, recordId = id, `failClosed: true`) —
   reading `newSalary` is a restricted-field read, so an audit-write failure aborts BEFORE any state change.
4. **`$transaction` (one EF transaction under TenantScope)**:
   a. Conditional `ExecuteUpdateAsync` on `salary_adjustments WHERE id AND org AND status='pending'` SET
      `status = newStatus, approvedById = caller, updated_at = now`. **count 0 ⇒ CONFLICT** (409 — the TOCTOU race
      guard: a concurrent approve flipped it between the load and here).
   b. If `approved`: `ExecuteUpdateAsync` on `employee_compensations WHERE userId AND org` SET
      `currentSalary = adj.newSalary, currency = adj.currency, updated_at = now`.
   Both commit or roll back TOGETHER.
5. Returns `{ id, status: newStatus }`. `comment` is accepted + bounded (≤500) but NEVER persisted (TS parity —
   the TS mutation reads `input.comment` but never writes it).

## The two tricky bits

### 1. `assertScoped('salaryAdjustment')` by-id IDOR probe root (NEW this slice)

`salaryAdjustment` was already a `ScopedEntity` + registered in `ScopeProbeRegistry.Tables` (`salary_adjustments`
→ `userId`/`user_id`) + handled by `ScopeWhereFor` (`SubjectAsync("userId")`) — but ONLY as a `scopeWhereFor` ROW
FILTER (Slice-9 `listPendingAdjustments`). It was NOT wired as a by-id `assertScoped` PROBE ROOT (no
`EntityRootTable` entry), so `assertScoped('salaryAdjustment', id)` would have thrown "no probe map registered".

This slice adds the ONE missing piece: `ScopeProbeRegistry.EntityRootTable[SalaryAdjustment] = "salary_adjustments"`
(mirroring how Slice-8 added `criticalRole` and Slice-11 added `action_plans`/`leader_commitments` to the
translator's probe-table map). The probe now resolves `SELECT 1 FROM salary_adjustments t WHERE t.id=@id AND
t.organization_id=@org AND (t.user_id = @p0 | t.user_id = ANY(@p0) | TRUE) LIMIT 1`, anchored on
`salary_adjustments.user_id` with the org filter, fail-closing 404 out-of-scope. `salary_adjustments` has NO
`deleted_at` → NOT soft-deletable (no `deleted_at IS NULL` clause). The field map + `ScopeWhereFor` logic already
existed — only the `EntityRootTable` registration was missing.

### 2. `CompensationStaffGate` action parameter

The Slice-9/11c gate hardcoded `read`. This slice adds a 7-arg `AuthorizeAsync` overload with an explicit
`action` parameter; the existing 6-arg overload forwards `"read"`, so every existing read call site is
byte-unchanged (and CA1068-safe — `CancellationToken` stays last). The two write endpoints pass `"create"` /
`"approve"`, enforced via the SAME `PermissionService` kernel.

## Ledger / ownership

`salary_adjustments` + `employee_compensations` move `efcoreReadOnly` → `efcoreStranglerWrite` in
`docs/architecture/table-ownership.md`. Both are Prisma-OWNED (DDL/migrations) AND still written by TS paths
(the compensation router's own writes + org-provisioning), so the ownership flip is BLOCKED (the whole write
surface must flip together) — this is a COEXISTENCE write. Both are ALSO still READ by `CompensationReadDbContext`
(Slice-9/11c) and `employee_compensations` by `SuccessionReadDbContext` (Slice-8) — a strangler-write table may be
read too; the ledger tracks the table's strongest EF relationship (write), exactly like `subscriptions` (Slice-4,
read by `BillingReadDbContext`). One-active-writer stays a runtime FACT: the C# routes are dark-by-default behind
`Platform:CompensationWriteEnabled`. `node scripts/table-ownership.mjs` stays green (both tables stay Prisma-@@map'd
and remain registered — no cross-owner collision, no unregistered EF table).

## Invariants (each BITE-PROVEN, real-RLS Testcontainers)

1. **TOCTOU** — conditional `ExecuteUpdateAsync where status='pending'` → 0 rows ⇒ 409. Two concurrent approves on
   one pending row → exactly one Applied, one Conflict; the losing tx applies NO comp update.
2. **Atomicity** — the status transition + `employee_compensations.currentSalary` commit/roll-back TOGETHER (one EF
   transaction under TenantScope). A forced failure on the comp update (a fixture `current_salary >= 0` CHECK bitten
   by a directly-seeded negative `new_salary`) rolls the status transition back → the adjustment stays `pending`.
3. **§21 minimal-select** — create + approve return ONLY `{ id, status }`.
4. **Fail-closed audit BEFORE mutation** on approve — the auditor pointed at a table-less DB throws
   `AuditWriteFailedException` → the status never changes (no mutation ran).
5. **createAdjustment subject-scope** — `assertSubjectInScope` out-of-set → 403; in-set → inserted.
6. **approveAdjustment assertScoped** by-id IDOR probe — out-of-scope id → 404 (never 403).
7. **currency normalization** fallback — input → subject comp currency → `USD`.

## Clean-architecture layout

- **Domain** `Tims.Domain/Compensation/CompensationWriteModels.cs` — `CreateAdjustmentCommand`,
  `CreateAdjustmentResult`, `PendingAdjustmentRow`, `ApproveOutcome`, `ApproveAdjustmentResult`, `AdjustmentTypes`.
- **Application** `ICompensationWriteRepository` + `CompensationWriteUseCase` (currency-normalize + insert;
  load → fail-closed audit → conditional transaction).
- **Infrastructure** `CompensationWriteDbContext` (+ `SalaryAdjustmentWriteEntity` tracked-INSERT entity +
  `EmployeeCompensationWriteEntity` for the `ExecuteUpdate`) + `CompensationWriteRepository` (TenantScope + the two
  `ExecuteUpdateAsync` in one transaction).
- **Api** `CompensationWriteEndpoints` (the two routes; gate + subject-scope/probe + bounded input) + the
  `CompensationStaffGate` action overload + `Program.cs` DI/mapping + `PlatformOptions.CompensationWriteEnabled`.
