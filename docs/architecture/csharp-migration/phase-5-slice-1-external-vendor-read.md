# Phase 5 Slice 1 — First strangler: external-vendor assessment READ surface → C#

Date: 2026-07-16 · Status: **In build (SDD).** Parent: `phase-5-strangler.md` / `00-master-plan.md`.
Branch: `feat/csharp-phase5-external-vendor` off main `ddbde94`. **Cutover deferred (deploy-gated).**

## Objective + why this is the recipe-correct first strangler

Prove the Phase-5 strangler **recipe** (Characterize → Model → Port → golden-parity → [deferred: route→canary→
verify→flip→delete]) on the cleanest possible first domain. The strangler is the *bulk* of the convergence
(~60% still TS); its safety is the repeatable recipe, so the first one must be clean and complete.

**Scope = the external-vendor READ surface** (`external.getAssessmentResults` + `external.getAssessmentResult`,
Wave 2.5 slice 7b), NOT the write. The recipe says **"route reads first, then writes"**, and reads over a
Prisma-owned table use the established **`efcoreReadOnly`** ledger category — **no ownership flip, no
coexistence-write tangle**. (The write, `submitValidationResult`, shares `preemployment_validations` with the
TS *staff* validation-write path, so its cutover is blocked on also migrating that path — deferred to a later
slice; noted below.) The API-key auth plane this needs is **already ported** (Phase 2 WP2.3: `tims_` key →
ExternalApiKey principal, `ExternalScope`, `PermissionService`, audit).

## Characterized TS contract (source of truth to reproduce)

`packages/api/src/routers/external.ts` · `services/external-assessment.service.ts` ·
`repositories/external-assessment.repository.ts` · `dto/external-assessment.ts` ·
`access/{select-for,classification,entity-policies}.ts`.

Two endpoints, both `externalPermissionProcedure('assessment','read','assessment:read')` (default scope
enforcement — an empty-scope key IS a wildcard here, unlike the write's `alwaysEnforceScope`):
- **list** `getAssessmentResults(take≤25 default 25, cursor?)` → `{ items: v1[], nextCursor? }`.
- **getOne** `getAssessmentResult(assignmentId)` → `v1` or NOT_FOUND.

Query (`assessment_results` ⋈ required to-one `assessment_assignments` ⋈ `assessment_types.name`):
- **INV-A Completed-only lifecycle gate:** only `assignment.status = 'completed'` rows exposed. A by-id fetch
  of a scored result on a NON-completed assignment → `null` → NOT_FOUND. *(This is a FIXED leak — regression
  corpus: getOne was once status-agnostic and leaked restricted scores outside the list's lifecycle gate.)*
- **INV-B Scope:** `scopeWhereFor('assessmentAssignment', access, principalId)`. External API keys resolve to
  an **org-level** access scope ⇒ `scopeWhereFor` returns `{}` (no-op); org filter + RLS do the isolation.
  *(Confirm in build: external keys are never team/unit/assigned-scoped, so the narrow assessmentAssignment
  anchor-loader/probe — deferred/fail-closed in Phase 2 — is NOT exercised here. Pin it with a fixture.)*
- **INV-C Classification ceiling (`selectFor(['external'],'assessmentResult')`):** anchors `id,
  organizationId, assignmentId` (always) + fields `fieldsVisibleTo(['external'],'assessmentResult')` =
  **breakdown, rawScore, normalizedScore, percentile, interpretation, modelVersion** (all six — `external` is
  the second-most-privileged psychometric reader, Federico Jun 15) + `scoredAt` (added explicitly). **No
  narrowing vs v1**, but the ceiling MUST be reproduced faithfully so a future config change stays in parity.
- **INV-D Fail-CLOSED audit:** each exported row writes a `data_access_logs` row `entity='assessmentResult',
  action='export', actorId=apiKeyId` **fail-closed** (`failClosed:true`) — awaited BEFORE the row is
  returned; list audits EVERY row first. A lost audit ABORTS the export (no unlogged psychometric data
  leaves). *(Contrast the write's fail-soft audit — different invariant, do not conflate.)*
- **INV-E Tenant isolation (defense-in-depth):** explicit `organizationId` on BOTH the result row AND the
  joined assignment, plus RLS. Cross-org → no rows.
- **INV-F Pagination:** `take+1` to compute `hasMore`; cursor on `assignmentId` (`cursor:{assignmentId}, skip:1`);
  `orderBy [{scoredAt:'desc'},{assignmentId:'asc'}]`; `nextCursor = hasMore ? rows[take-1].assignmentId : undefined`.
- **INV-G Cross-org / missing → NOT_FOUND** (getOne, Spanish message `Resultado de evaluacion no encontrado`).
- **v1 DTO** (`toExternalAssessmentResultV1`): stable versioned contract `schemaVersion:'v1'` + the flat field
  set (assignment context + the six scored fields + scoredAt) — map explicitly, never reshape v1.

## C# port — structure (files under `services/Tims.Platform/`)

```
src/Tims.Domain/Access/
  FieldClassification.cs   → NEW pure kernel: port fieldsVisibleTo + the assessmentResult CLASSIFICATION
                             entry + ANCHOR_FIELDS (fail-closed union; anchors always). Golden-fixtured.
                             Registers assessmentResult only (extensible); unknown entity → {id}.
src/Tims.Domain/ExternalVendor/            (or Access/ — the pure v1 mapping shape)
  ExternalAssessmentResultV1.cs → the versioned DTO record + the pure mapper (row → v1). Golden-fixtured.
src/Tims.Application/ExternalVendor/
  ExternalAssessmentReadModels.cs → ExternalResultRow + query request/response records.
  IExternalAssessmentRepository.cs → ports: ListAsync(org, scope, take, cursor) / GetOneAsync(org, scope, assignmentId).
  ExternalAssessmentReadUseCase.cs → orchestrates: query → **fail-closed audit each row (await BEFORE return)**
                             → map v1 → paginate. Infra-free (drives ports + IDataAccessAuditor).
src/Tims.Infrastructure/ExternalVendor/
  ExternalAssessmentDbContext.cs (or reuse a read context) → read-only EF (AsNoTracking) over
                             assessment_results ⋈ assessment_assignments ⋈ assessment_types, UNDER TenantScope
                             (RLS) + explicit organizationId; completed-only gate; the take+1 cursor page.
  *Entities (read-only, Prisma-owned): AssessmentResultReadEntity, AssessmentAssignmentReadEntity, AssessmentTypeReadEntity.*
src/Tims.Api/
  Program.cs               → wire the read use case + repo + the external-assessment endpoints.
  ExternalVendor/…         → GET /external/assessment-results (list, cursor) + /external/assessment-results/{assignmentId}
                             (getOne), RequireAuthorization(ApiKey scheme) + assessment:read grant + scope,
                             per-key rate-limit filter (as /external-whoami), OpenAPI-emitted.
```

## Kernels: reuse vs new
- **REUSE (do NOT re-port):** `ApiKeyAuthenticationHandler`/`ApiKeyResolver` (ExternalApiKey principal),
  `ExternalScope` (assessment:read, default enforcement), `PermissionService` (assessment:read grant),
  `ScopeWhereFor` (assessmentAssignment → `{}` for org-level external keys), `DataAccessAuditWriter`
  (fail-closed mode), `TenantScope` (RLS).
- **NEW (this slice):** `FieldClassification` (fieldsVisibleTo/selectFor ceiling — first column-classification
  kernel in C#) + the external-assessment read use case + read EF repo + the two API endpoints.

## Golden parity (anti-drift spine — BOTH CIs) + regression corpus
- `contracts/access-fixtures/field-classification.json` — `fieldsVisibleTo(roles, 'assessmentResult')` for
  external/super/hr/hrbp/recruiter/employee/empty → asserted IDENTICALLY by the REAL TS `fieldsVisibleTo`
  (`tests/access/...`) and C# `FieldClassificationFixtureTests`. Must BITE (drop a role → red both stacks).
- `contracts/external-fixtures/assessment-result-v1.json` — row → v1 mapping byte-identical TS + C#.
  **The v1 DATE wire format is now PINNED (not deferred):** the C# DTO's `DateTimeOffset` fields serialize
  via `NodeIsoDateTimeOffsetConverter` to Node `.toISOString()` form (`yyyy-MM-ddTHH:mm:ss.fffZ`), and BOTH
  the C# `ExternalAssessmentResultV1FixtureTests` (serialize + assert the string) and the TS
  `assessment-result-v1-fixtures.test.ts` (assert `.toISOString()`) pin that SAME string form — closing the
  "STJ `+00:00` ≠ Node `Z`" gotcha and the L1 cutover risk for these dates.
- **Testcontainers (real RLS, NEVER mocked):** seed two orgs × assignments in {completed, in_progress} with
  scored results → prove (INV-A) completed-only gate incl. the by-id non-completed → NOT_FOUND leak-fix bite;
  (INV-E) cross-org returns nothing; (INV-F) cursor pagination boundary; (INV-D) fail-closed audit lands one
  `data_access_logs` row per exported result AND an injected audit failure ABORTS the export (no row returned).
- Regression-corpus catalogue for this surface: INV-A leak-fix (getOne status-agnostic), INV-C external-ceiling
  (breakdown/rawScore restricted→external), INV-D fail-closed-audit-before-return, INV-B empty-scope-wildcard
  (assessment:read, NOT alwaysEnforce). Each pinned by a red-if-regressed test.

## Ledger
`efcoreReadOnly += assessment_results, assessment_assignments, assessment_types` (EF reads Prisma-owned tables
read-only; `@@map`'d, AsNoTracking, no write). No new tables, no migration, tables stay Prisma-owned.

## Deferred (documented, not silent)
- **Cutover** (route BFF/generated-client reads → C#, canary vs TS, prod-verify, then delete the TS
  `external-assessment` router/service/repo). Deploy-gated (WP3.4/G3 must land first).
- **The write surface** (`submitValidationResult`) → a later slice. Design note: `preemployment_validations`
  is co-written by the TS **staff** `updateValidation` path, so the vendor-write cutover needs a ledger
  category for a strangler coexistence-write (`efcoreStranglerWrite`) AND is blocked on migrating the staff
  write too — the whole validation-write surface flips together, or it violates one-writer-per-table.
- **Narrow-scoped external keys:** if external keys ever get team/unit/assigned scope, register the
  assessmentAssignment anchor-loader/probe (Phase-2 deferred set) — not needed for org-level keys today.

## Local gate (before PR)
From `services/Tims.Platform`: build `-c Release` 0-warn · `dotnet format --verify-no-changes` · unit + integration
(Docker). From root: `node scripts/table-ownership.mjs`. **TS touched** (shared golden fixtures genuinely span
both stacks — sanctioned): `cd packages/db && npx prisma generate` → `pnpm --filter @tims/api exec tsc --noEmit`
→ `cd apps/web && npx tsc --noEmit` → `npx vitest run`.
