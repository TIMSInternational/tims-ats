# Phase 5 Slice 2 — external-vendor WRITE (`submitValidationResult`) → C#

Date: 2026-07-16 · Status: **In build (SDD).** Parent: `phase-5-strangler.md` / `phase-5-slice-1-external-vendor-read.md`.
Branch: `feat/csharp-phase5-external-vendor-write` off main `c4bc6b1`. **Cutover deferred (deploy-gated).**

## Objective
Complete the external-vendor domain by porting its inbound WRITE (Sprint 1.6 `external.submitValidationResult`)
to C#, exercising the WRITE side of the strangler recipe ("reads first, **then writes**"). This is the FIRST
C# endpoint that writes a **product** table (the audit writer only appends audit rows). Cutover (route→canary→
flip→delete TS) stays deferred; the C# write path is deploy-flag-OFF and Testcontainers-proven.

**The deploy flag is REAL (not just a ledger claim).** Two `PlatformOptions` flags, both DEFAULT `false`
(dark): `ExternalVendorWriteEnabled` (this slice's write) and `ExternalVendorReadEnabled` (Slice-1 read).
`Program.cs` maps `MapExternalValidationEndpoints()` / `MapExternalAssessmentEndpoints()` ONLY when the
respective flag is on — off ⇒ the route is not mapped ⇒ a request **404s**, so deploying Tims.Api activates
NO second live writer/reader and TS stays the sole active stack until Federico flips the flag per-surface at
canary (dark → canary → full). The build-time OpenAPI document still describes the routes (the GetDocument
doc generation forces them mapped), so the contract stays accurate while runtime stays dark.

## The coexistence-write reality (why a new ledger category)
The write targets **`preemployment_validations`** — a Prisma-OWNED table that is ALSO written by the TS
**staff** path (`updateValidation`, sets `completed_by_id`). So this slice ports ONLY the *vendor* write
path; the table stays Prisma-owned. New ledger category **`efcoreStranglerWrite`** = "Prisma-OWNED (DDL stays
Prisma), EF performs a specific documented UPDATE during an in-progress strangler; a deploy flag keeps exactly
one ACTIVE writer at runtime (TS until cutover); NOT yet an ownership transfer." Honest middle between
`efcoreAppendOnly` (INSERT-only) and `efcore` (owned). **Full ownership flip to `efcore` is BLOCKED on also
migrating the staff `updateValidation` write** (whole validation-write surface flips together, else two stacks
write one table = one-writer violation). Documented as the sequenced completing step.

## Characterized TS contract (source of truth)
`routers/external.ts` (`submitValidationResult`) · `services/external-validation.service.ts` ·
`repositories/external-validation.repository.ts` · `dto/external-validation.ts` · migration
`20260713140000_add_validation_completed_by_api_key`.

Endpoint: `externalPermissionProcedure('validation','update','validation:write', **alwaysEnforceScope=true**)`
→ `submitResult(auditMeta, input)`. Flow + invariants:
- **Input** `ExternalValidationSubmitInput`: `validationId` uuid; `status` ∈ {passed, failed}; `result`
  JSON object with `JSON.stringify(r).length ≤ 100_000`; `notes?` ≤ 5000. The API KEY is the principal —
  NEVER accept it as input.
- **INV-1 Scope alwaysEnforce:** `validation:write` required UNCONDITIONALLY — an empty-scope key is NOT a
  wildcard here (unlike the read's `assessment:read`), so seeding the `validation:update` grant can never
  silently widen an existing key. (`ExternalScope.ExternalScopeSatisfied(..., alwaysEnforceScope:true)`.)
- **INV-2 Grant:** the `external` role's `validation:update` grant (org scope) via `PermissionService`.
- **INV-3 NOT_FOUND (read gate):** `getValidationForSubmit(org, id)` = findFirst `{id, organizationId}`
  select `{id, status}`; null → NOT_FOUND `Validacion no encontrada` (cross-org id → RLS/org filter → null).
- **INV-4 TOCTOU pending-only guard:** the write is an ATOMIC `updateMany where {id, organizationId,
  status:'pending'}` — `count===0` ⇒ CONFLICT `La validacion no esta abierta para envio de resultados`
  (row gone / not this org / already finalized). NEVER a read-then-write on the status. *(Regression corpus:
  the atomic-guard TOCTOU pattern, [[tims-security-audit-2026-07-01]].)*
- **INV-5 Provenance:** sets `completed_by_api_key_id = apiKeyId` AND `completed_by_id = null` (vendor, never
  a staff completer). DB CHECK `preemployment_validations_single_completer_chk` (`completed_by_id IS NULL OR
  completed_by_api_key_id IS NULL`) enforces mutual exclusion at the DB level — no code path can violate it.
- **INV-6 Fail-SOFT audit:** `logDataAccess(entity='preemploymentValidation', action='update',
  actorId=apiKeyId, failClosed:false)` — the write is committed + is the source of truth; a lost audit row
  must NOT abort a successful vendor submission (CONTRAST the read surface's fail-CLOSED export audit).
- **INV-7 Tenant isolation:** `organizationId` filter on both the read and the updateMany + RLS under
  `TenantScope`. **INV-8 status enum + bounds:** only passed/failed; result ≤100KB, notes ≤5000.
- **v1 output** `toExternalValidationResultV1({id, status, completedAt})` → `{schemaVersion:'v1', id, status,
  completedAt}`. `completedAt` is a Date → REUSE `NodeIsoDateTimeOffsetConverter` (Slice 1) for wire parity.

## C# port — structure (`services/Tims.Platform/`)
```
src/Tims.Domain/ExternalVendor/
  ExternalValidationResultV1.cs   → versioned DTO record + pure Map; [JsonConverter(NodeIso…)] on completedAt.
  ExternalValidationSubmitCommand.cs → validated value object (status enum, result JSON ≤100KB, notes ≤5000).
src/Tims.Application/ExternalVendor/
  IExternalValidationRepository.cs → GetStatusForSubmitAsync(org,id) + SubmitResultAsync(org,id,apiKeyId,cmd)→count.
  ExternalValidationSubmitUseCase.cs → read-gate (null→NotFound) → atomic pending-only update → count==0→Conflict
                                       → fail-SOFT audit → map v1. Infra-free (ports + IDataAccessAuditor).
  ExternalValidationNotFoundException / ExternalValidationConflictException (Spanish messages).
src/Tims.Infrastructure/ExternalVendor/
  ExternalValidationEntity.cs      → maps preemployment_validations (write-capable subset).
  ExternalValidationDbContext.cs   → EF context (efcoreStranglerWrite).
  ExternalValidationRepository.cs  → read (AsNoTracking projection {id,status}) + ExecuteUpdateAsync
                                     (status/result/notes/completed_by_api_key_id/completed_by_id=null/completed_at)
                                     with the `status=='pending'` WHERE → affected count, ALL under TenantScope/RLS.
src/Tims.Api/ExternalVendor/
  ExternalValidationEndpoints.cs   → POST /external/validations/{validationId}/result (body {status,result,notes}),
                                     ApiKey scheme + validation:update grant + validation:write scope
                                     (alwaysEnforce) + per-key rate-limit; 200 v1 / 400 bounds / 404 / 409.
```
Ledger: **`efcoreStranglerWrite += preemployment_validations`** (+ extend `scripts/table-ownership.mjs` +
`table-ownership.md` mirroring `efcoreAppendOnly`: array-validation, `registeredEfTables` union, must-be-@@map'd
check, return field). Governance test bites a strangler-write-not-prisma case.

## Kernels: reuse vs new
- **REUSE:** ApiKey auth (`ApiKeyAuthenticationHandler`/`ApiKeyResolver`), `ExternalScope` (alwaysEnforce),
  `PermissionService` (validation:update grant), `TenantScope` (RLS write), `DataAccessAuditWriter`
  (fail-soft), `NodeIsoDateTimeOffsetConverter` (date wire), `ApiKeyRateLimitFilter`.
- **NEW:** the validation-submit use case + write EF repo/context + the endpoint + `efcoreStranglerWrite`
  ledger category. (First C# **product-table write**.)

## Golden parity (both CIs) + regression corpus (each pinned red-if-regressed)
- `contracts/external-fixtures/validation-submit-scope.json` — `externalScopeSatisfied('validation:write',
  scopes, alwaysEnforceScope:true)` cases (empty scope → FALSE here, vs the read's TRUE) asserted by REAL TS
  `externalScopeSatisfied` + C# `ExternalScope`. Must bite.
- `contracts/external-fixtures/validation-result-v1.json` — v1 mapping incl. the canonical `…fffZ`
  `completedAt`, byte-identical TS + C#.
- **Testcontainers (real RLS + the real CHECK — NEVER mock):** seed a `pending` validation → submit flips
  status + sets provenance (completed_by_api_key_id set, completed_by_id null) + satisfies the CHECK;
  a NON-pending validation → count 0 → CONFLICT (INV-4 bite); a second submit → CONFLICT (double-submit);
  a cross-org id → NOT_FOUND (INV-3/7); an attempt to also set completed_by_id alongside the api-key id is
  REJECTED by the CHECK (prove the constraint exists + bites); fail-soft audit lands one row but a forced
  audit failure does NOT roll back the committed write (INV-6 bite).

## Deferred (documented, not silent)
- **Cutover** (route the TS `external.submitValidationResult` → C#, canary, prod-verify) AND the **ownership
  flip** — both BLOCKED on migrating the TS **staff** `updateValidation` write (the whole
  `preemployment_validations` write surface flips together). Until then the table stays
  `efcoreStranglerWrite` and TS is the active writer.
- Date wire-format is pinned (reuses the Slice-1 converter); no new deferral.

## Local gate (before PR)
From `services/Tims.Platform`: build `-c Release` 0-warn · `dotnet format --verify-no-changes` · unit +
integration (Docker). Root: `node scripts/table-ownership.mjs` (now validates `efcoreStranglerWrite`). TS
touched (shared fixtures span both stacks — sanctioned): `prisma generate` → `@tims/api tsc` → `apps/web tsc`
→ `vitest run`.
