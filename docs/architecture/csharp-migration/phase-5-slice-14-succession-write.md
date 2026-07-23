# Phase-5 Slice 14 — Succession WRITE surface (5 writes) → C#

**Status:** to build, dark-by-default behind `Platform:SuccessionWriteEnabled` (default false).
**Kind:** the WRITE port of the succession domain (`efcoreStranglerWrite`), completing the domain after Slice-8
(the 9 reads). With the 5 writes ported, the ENTIRE `succession` router (9 reads + 5 writes) has a C# analog and
the domain becomes **FLIP-READY** — **the cleanest flip candidate to date**: `critical_roles` + `successors` are
touched by NOTHING outside `packages/api/src/routers/succession.ts` (grep-verified: `\.(successor|criticalRole)\.<op>`
returns 19 hits, all in that one file — zero foreign readers, zero foreign writers). Succession itself READS foreign
tables (`nine_box_evaluations`, `employee_compensations`, `salary_bands`) but nothing foreign touches ITS tables,
which is exactly what an ownership flip requires. The flip to `efcore` is a deploy-gated cutover, deferred — TS stays
the sole ACTIVE writer until Federico flips the flag per surface at canary (dark → canary → full).

Ports the 5 mutation bodies of `packages/api/src/routers/succession.ts` (write logic is **inline `prisma.*` in the
router** — there is NO succession service/repository layer in TS; the C# port introduces the clean-arch layering the
read slice already established). All 5 are `permissionProcedure('succession', <action>)` staff-JWT mutations.

## Endpoints (dark-by-default)

| Method | Route | TS analog | Gate |
|--------|-------|-----------|------|
| POST | `/succession/critical-roles` | addCriticalRole | staff-JWT + `succession:create` + **requireOrgScope** |
| POST | `/succession/critical-roles/{criticalRoleId}/successors` | addSuccessor | staff-JWT + `succession:create` + **assertScoped(criticalRole)** + **assertSubjectInScope(userId)** |
| DELETE | `/succession/successors/{successorId}` | removeSuccessor | staff-JWT + `succession:delete` + **assertScoped(successor)** |
| PATCH | `/succession/successors/{successorId}/readiness` | updateSuccessorReadiness | staff-JWT + `succession:update` + **assertScoped(successor)** |
| PATCH | `/succession/critical-roles/{criticalRoleId}/band` | updateCriticalRoleBand | staff-JWT + `succession:update` + **assertScoped(criticalRole)** |

Mapped ONLY when `Platform:SuccessionWriteEnabled` is true OR at build-time OpenAPI generation
(`GetDocument.Insider`) — the emitted contract stays accurate while runtime stays dark (Slice-2 standing rule:
every strangled C# product surface MUST be dark-by-default flag-gated). "TS stays the single active writer" is a
runtime FACT, not a ledger claim.

## ⚠️ THE LOAD-BEARING SECURITY INVARIANTS (each faithful to a TS guard, several are prior Codex hardenings)

The five writes carry DIFFERENT scope mechanics on the SAME `succession:create/update/delete` grants — the gate
authorizes the grant and RETURNS the resolved `AccessScope`; each endpoint then applies its own mechanic (identical
pattern to `SuccessionReadEndpoints`, which already does this for the 9 reads). DO NOT collapse them into a blanket
org-gate:

1. **addCriticalRole → `requireOrgScope` (org governance, NOT a leader/hrbp grant).** succession.ts:130-132:
   "Defining an org-critical role is org governance … → org/company scope only." A narrow-scoped caller
   (leader/hrbp with succession:create but team/unit/own scope) → **403**. Reuse `OrgGate.RequireOrgScopeSatisfied`
   (the read slice's `AuthorizeOrgRollupAsync` pattern).
2. **addSuccessor → `assertScoped('criticalRole', criticalRoleId)` (parent IDOR probe) THEN
   `assertSubjectInScope(userId)` (Codex subject-scope hardening).** succession.ts:154-168. The parent role must be
   in the caller's grant (out-of-grant/absent → **404** `ScopedNotFoundException`), AND the proposed successor must be
   a user in the caller's subject set (out-of-set → **403** "No puedes agregar este sucesor"). This is a WRITE-rule
   subject check (no successor row exists yet to probe) → use `SubjectInScope.IsSatisfiedAsync` exactly as
   `CompensationWriteEndpoints.createAdjustment` does (its "gate the TARGET userId, no row to probe yet" precedent).
3. **removeSuccessor / updateSuccessorReadiness → `assertScoped('successor', id)` (IDOR probe → 404).**
   succession.ts:186,202.
4. **updateCriticalRoleBand → `assertScoped('criticalRole', criticalRoleId)` (IDOR probe → 404).** succession.ts:222.
5. **Provenance/anti-forgery:** `addSuccessor` stamps `addedById = caller.id` server-side (succession.ts:173) — never
   from input. `organizationId = caller.org` on every write. Every write is UNDER `TenantScope` (app_tenant + org GUC
   → RLS) + an explicit `organization_id` WHERE/value (defense in depth; RLS hides cross-org rows anyway).

`ScopedEntity.CriticalRole` and `ScopedEntity.Successor` are ALREADY registered probe roots (the read slice uses
both via `ScopedProbe.AssertScopedAsync` + `ScopeWhereFor.BuildAsync`). Confirm both resolve a probe-root table
(like comp Slice-12 had to wire the missing `salaryAdjustment` root) — they should already, since the reads probe
them; add nothing unless a root is missing.

## The 5 writes — faithful ports

### addCriticalRole (`succession:create` + requireOrgScope)
Input (Zod, succession.ts:118-127): `{ title:1..255, positionId?:≤100, currentHolderId?:uuid, companyId?:uuid,
unitId?:uuid, criticality:enum('critical','high','medium','low'), flightRisk?:number 0..1 }`. INSERT `critical_roles`
`{ ...input, organizationId = caller }`. **No `select`** in TS → returns the FULL created row (id, organizationId,
title, positionId, currentHolderId, companyId, unitId, criticality, flightRisk, targetBandLevel(=null),
createdAt, updatedAt). Client-set `id = Guid.NewGuid()` (Prisma `@default(uuid())` is client-side), `createdAt =
updatedAt = now()` set explicitly (Prisma `@default(now())`/`@updatedAt` are client-side) — parity with the eval360
write.

### addSuccessor (`succession:create` + assertScoped(criticalRole) + assertSubjectInScope(userId))
Input (succession.ts:144-151): `{ criticalRoleId:uuid, userId:uuid, readiness:enum('ready_now','ready_1_year',
'ready_2_years','developing'), type:enum('internal','external'), developmentPlan?:≤20000 }`. After BOTH scope
checks: INSERT `successors` `{ ...input, organizationId = caller, addedById = caller.id }`, returns the row with
nested `user { id, firstName, lastName, avatar }` (TS `include`). Client-set id/createdAt/updatedAt as above.
**DB `@@unique([criticalRoleId, userId])`** (succession.prisma:44). TS does NOT catch the unique violation → it
leaks a Prisma P2002 as a 500. **DELIBERATE, DOCUMENTED PORT IMPROVEMENT** (architecturally-correct-not-safe; same
precedent as the billing getInvoice clean-404 improvement and the ninebox `addCalibrationMember` P2002→CONFLICT
mapping in the SAME product area): map the unique violation → **409 CONFLICT** with a Spanish message
("Este sucesor ya está asignado a este rol"), bite-proven, and flag it in the PR body as a divergence for Federico's
cutover decision. (Do the INSERT and detect the unique violation — either a pre-check `findFirst` inside the same
`TenantScope` txn before the add, or catch the `DbUpdateException`/`PostgresException` SqlState 23505; prefer the
catch so it stays atomic and race-safe.)

### removeSuccessor (`succession:delete` + assertScoped(successor))
Input `{ id:uuid }` (route param `successorId`). After the probe: DELETE `successors WHERE id, organizationId`.
TS `delete` returns the full deleted row. `assertScoped` already guarantees the row exists + is in grant (else 404),
so the delete normally succeeds; guard the TOCTOU (row vanished between probe and delete) → if 0 rows affected,
return **404** `ScopedNotFoundException` message ("Sucesor no encontrado" — match the probe's message). Return the
deleted row shape (or `{ id }` minimal — see Return shapes).

### updateSuccessorReadiness (`succession:update` + assertScoped(successor))
Input (succession.ts:193-199): `{ id:uuid, readiness:enum(...4), developmentPlan?:≤20000 }`. After the probe:
UPDATE `successors WHERE id, organizationId` SET `readiness`, `developmentPlan` (+ `updatedAt = now()`). TS returns
the full updated row. count 0 (TOCTOU) → 404.

### updateCriticalRoleBand (`succession:update` + assertScoped(criticalRole))
Input (succession.ts:215-219): `{ criticalRoleId:uuid, targetBandLevel: string ≤50 | null }`. After the probe:
UPDATE `critical_roles WHERE id, organizationId` SET `targetBandLevel` (+ `updatedAt = now()`), returns
**`select { id, targetBandLevel }`** (the ONLY write with a narrowed select — match it exactly). `targetBandLevel`
is explicitly nullable and settable to null.

## Enums are PLAIN STRINGS (simpler than eval360/comp — NO native-enum datasource)

`criticality`, `readiness`, `type` are **plain `String` columns** in `succession.prisma` (verified — no `enum`
declarations in that schema; the Zod `.enum()` is app-layer validation only). The DB stores the string verbatim →
the write DbContext is a plain string-based context; **NO `NpgsqlDataSource.EnableUnmappedTypes` holder** is needed
(unlike eval360/billing). Enforce the enum sets at the endpoint (Zod parity → 400 on an out-of-set value, validated
AFTER auth per tRPC ordering). Store the validated string verbatim (do NOT coerce/normalize — TS stores it raw).

## Reuse (no re-invention)

- **Staff gate:** extend `SuccessionStaffGate.AuthorizeAsync` with an **action-parameterized overload**
  (`create`/`update`/`delete`); the existing read callers forward `"read"` **byte-unchanged** (CA1068-safe —
  `CancellationToken` stays last). It resolves the principal + returns the `AccessScope`; each write endpoint applies
  requireOrgScope / assertScoped / assertSubjectInScope as tabled above.
- **Scope primitives:** `ScopedProbe.AssertScopedAsync(ScopedEntity.CriticalRole|.Successor, …)`,
  `OrgGate.RequireOrgScopeSatisfied`, `SubjectInScope.IsSatisfiedAsync`, `IAnchorLoaderFactory`/`IAnchorLoader`
  (dispose in `finally`) — all already wired for the read slice; reuse verbatim.
- **EF writes-under-RLS:** `TenantScope.BeginAsync` + a transaction; the create/update/delete run inside it
  (mirrors Slice-12 `CompensationWriteRepository` + Slice-13 `Evaluation360WriteRepository`). Single-row ops don't
  need multi-statement atomicity, but the write stays inside the TenantScope txn (RLS GUC lifetime).
- **Date serialization:** the create/add/remove/update-readiness returns carry `createdAt`/`updatedAt` — serialize
  via the shared `NodeIsoDateTimeOffsetConverter` (`Tims.Domain.Json`) so the wire is Node `.toISOString()`
  (`…Z`, NOT STJ `+00:00`) — the recurring STJ-vs-Node gotcha, already killed in prior slices; scope the converter
  to the write DTOs.
- **Entities:** `SuccessionReadEntities.cs` already models `critical_roles`/`successors` (read-only). Add write
  entities/config in a dedicated `SuccessionWriteDbContext` (own `ToTable` mapping) — do NOT make the read context
  writable. `CriticalRole` has NO `deletedAt` (hard delete on successors only).

## Ledger / ownership

`critical_roles` + `successors` move `efcoreReadOnly` → `efcoreStranglerWrite` in `docs/architecture/table-ownership.md`.
Both are Prisma-OWNED (DDL/migrations) AND still written by the TS succession router, so the flip is a COEXISTENCE
write (the deploy flag keeps exactly one ACTIVE writer). They are ALSO still READ by `SuccessionReadDbContext`
(Slice-8) — a strangler-write table may be read too; the ledger tracks the strongest EF relationship (write), exactly
like `subscriptions`/`salary_adjustments`/`review_cycles`. The domain is now **FLIP-READY** (grep-confirmed no
non-succession reader/writer of the two tables — the CLEANEST flip candidate); the ownership flip to `efcore` stays
deferred to the deploy-gated cutover. `node scripts/table-ownership.mjs` stays green (both stay Prisma-`@@map`'d +
registered → no cross-owner collision, no unregistered EF table).

## Invariants (regression corpus — each BITE-PROVEN, real-RLS Testcontainers unless noted)

1. **addCriticalRole org-governance** — a narrow-scoped (team/unit/own) succession:create caller → **403**, no INSERT
   (`requireOrgScope`). Org/company scope → 200.
2. **addSuccessor parent probe** — successor add against a criticalRole outside the caller's grant / nonexistent →
   **404**, no INSERT (`assertScoped(criticalRole)`).
3. **addSuccessor subject-scope (Codex hardening)** — a caller whose subject set excludes `userId` → **403**
   "No puedes agregar este sucesor", no INSERT (`assertSubjectInScope`). Bite by narrowing the caller's scope so the
   target user is out-of-set.
4. **addSuccessor provenance** — `addedById` = caller id even if a different id is smuggled anywhere; `organizationId`
   = caller org.
5. **addSuccessor dedup** — a 2nd add of the same `(criticalRoleId, userId)` → **409 CONFLICT** (the documented
   improvement), no duplicate row (`@@unique`). Bite the constraint.
6. **removeSuccessor / updateSuccessorReadiness / updateCriticalRoleBand IDOR probe** — an out-of-grant / cross-org
   id → **404**, no mutation (`assertScoped`).
7. **updateCriticalRoleBand shape + nullability** — returns exactly `{ id, targetBandLevel }`; `targetBandLevel` set
   to null clears it.
8. **Input bounds (Zod parity, → 400 after auth)** — title 1..255, developmentPlan ≤20000, targetBandLevel ≤50,
   flightRisk 0..1, the 3 enum sets (criticality/readiness/type) rejected when out-of-set. developmentPlan/notes are
   bounded (§21 — Successor.developmentPlan can run 20k).
9. **Tenant isolation** — every write UNDER TenantScope (app_tenant + org GUC → RLS) + explicit `organization_id`;
   a cross-org write is blocked (RLS hides the row → probe 404 / an RLS-necessity bite: tenant role w/o GUC → 42501).
10. **Enums stored verbatim** — criticality/readiness/type persisted as the raw validated string (no native enum,
    no normalization).

## Clean-architecture layout (additive; mirrors the eval360/comp write slices)

- **Domain** `Tims.Domain/Succession/SuccessionWriteModels.cs` — input records (`AddCriticalRoleInput`,
  `AddSuccessorInput`, `UpdateSuccessorReadinessInput`, `UpdateCriticalRoleBandInput`) + result/outcome records
  (`CriticalRoleRow`, `SuccessorRow` with nested `user`, `RemovedSuccessorResult`, `CriticalRoleBandResult`,
  `AddSuccessorOutcome` for the CONFLICT/OK discrimination) + the enum-set constants
  (`SuccessionCriticalityValues`, `SuccessionReadinessValues`, `SuccessionSuccessorTypeValues`).
- **Application** `ISuccessionWriteRepository` + `SuccessionWriteUseCase` (dedup → conflict mapping; delete/update
  count-0 → not-found; provenance stamping).
- **Infrastructure** `SuccessionWriteDbContext` (+ `CriticalRoleWriteEntity`/`SuccessorWriteEntity`/`UserWriteEntity`
  for the nested successor `user` projection) + `SuccessionWriteRepository` (TenantScope + create/update/delete +
  unique-violation catch → conflict outcome).
- **Api** `SuccessionWriteEndpoints` (the 5 routes; the gate action overload; bounded input + enum-set + Node-ISO
  DTOs; requireOrgScope / assertScoped / assertSubjectInScope per the table) + `Program.cs` DI/mapping +
  `PlatformOptions.SuccessionWriteEnabled`.

## Review fix wave (3-review + Codex gate — applied)

The independent local gate was green and the security + parity opus reviews returned **GO**, but **Codex
cross-model verification found two HIGH cross-tenant paths both opus reviewers missed** — faithful ports of
PRE-EXISTING TS holes (verified against `succession.ts` + `write-rules.ts`), fixed in **BOTH stacks** to keep golden
parity and ship the prod hardening (the 11c precedent):

- **H1 (HIGH) — cross-org successor creation.** `assertSubjectInScope`/`SubjectInScope` no-op for
  organization/company scope (they enforce SCOPE, not org membership), so an org-scoped `succession:create` caller
  could pass an org-A `criticalRoleId` + an org-B `userId` and persist a cross-tenant reference (the `successors.userId`
  FK check bypasses RLS). FIX: `addSuccessor` now proves the target user is a member of the caller's org under
  TenantScope (an RLS-filtered `users` lookup) BEFORE the INSERT — cross-org → **403** (no row). The lookup doubles as
  the nested-user projection (removes the prior `user!` assertion). TS: same `db.user.findFirst({id, organizationId})`
  guard. **Bite-proven** (repo `AddSuccessor_cross_org_user_is_subject_not_in_org_and_no_insert` + endpoint
  `AddSuccessor_OrgAdmin_CrossOrgUser_Is403_NoInsert` go RED with the guard neutralized).
- **H2 (HIGH) — addCriticalRole cross-org holder/company/unit.** The create persisted arbitrary
  `currentHolderId`/`companyId`/`unitId` (only UUID-syntax checked). FIX: each PROVIDED optional reference is validated
  against the caller's org (TenantScope-filtered `users`/`companies`/`business_units` lookups) BEFORE the INSERT —
  cross-org → **400** (no row). Both stacks. Bite-proven (`AddCriticalRole_CrossOrgReference_Is400` theory ×3 +
  `AddCriticalRole_cross_org_reference_is_null_and_no_insert`; happy-path `AddCriticalRole_InOrgRefs_Is200`).
- **M1 (MED) — delete/update TOCTOU → 500.** A row deleted between the tracked load and `SaveChanges` threw an
  uncaught `DbUpdateConcurrencyException`. FIX: caught → **404** (parity with the "absent at load" 404), on all three
  load-then-save methods. (Code-verified; the mid-method race is not reachable through the public repo API to
  bite-test deterministically.)
- **M2 (MED) — 409 catch not constraint-specific.** `IsUniqueViolation` mapped ANY 23505 to the dup-successor 409.
  FIX: now matches ONLY `ConstraintName == "successors_critical_role_id_user_id_key"`; any other unique violation
  propagates. (`successors` has only that unique + a server-minted PK, so no other 23505 is reachable to bite-test;
  the dedup 409 test still proves the target constraint maps correctly.)
- **F1 (LOW) — POST optional-null / empty-string parity.** The two POST endpoints deserialized into typed records
  that collapsed absent vs explicit `null`. FIX: both POST bodies parse as `JsonObject` (like the PATCH paths) and
  REJECT a present-null key on a Zod `.optional()` field + an empty-string optional uuid → **400**. Bite-proven
  (`AddCriticalRole_ExplicitNullOptional_Is400`, `AddSuccessor_ExplicitNullDevelopmentPlan_Is400`).
- **F2 (LOW) — addCriticalRole validated scope before body.** Reordered to validate the body (→400) BEFORE
  `requireOrgScope` (→403), matching tRPC input-first ordering. Bite-proven
  (`AddCriticalRole_NarrowLeader_MalformedBody_Is400_NotForbidden`).

### UUID canonicality (Codex recheck LOW — body fields FIXED, route-param residual documented)
The Codex recheck confirmed all 6 prior findings CLOSED and flagged one residual LOW: `Guid.TryParse` accepts
non-canonical UUID forms (braces/parens/no-hyphen) that Zod `.uuid()` rejects, vs the strict `TryParseExact(…, "D")`
precedent in `BillingReadEndpoints`. FIXED for the BODY uuid fields (userId + currentHolderId/companyId/unitId now use
`Guid.TryParseExact(…, "D")` → Zod-strict; bite-proven `AddCriticalRole_NonCanonicalUuid_Is400`). **Residual (accepted):**
the `{id:guid}` ROUTE-PARAM constraint is framework-parsed and a malformed segment → 404 (not the TS 400) — the
ESTABLISHED cross-slice pattern for every prior C# slice; accepted for consistency rather than changing the routing layer.
- **Ledger:** the H2 fix adds read-only `companies` + `business_units` to `SuccessionWriteDbContext` (existence checks
  only, never written); both remain Prisma-owned `efcoreReadOnly` — no ledger change beyond the two write tables.

## Gate (per-slice, non-negotiable)

INDEPENDENT local gate re-run at worktree HEAD (never trust self-reported numbers): `pnpm install
--frozen-lockfile` + `prisma generate` first; then C# build 0-warn / `dotnet format` / unit + integration (Docker
real RLS) / `node scripts/table-ownership.mjs` / api+web `tsc` / `vitest`. THEN 3-review adversarial gate
(security + parity opus agents + Codex `codex:codex-rescue`). Fix Crit/High/Med bite-proven (neutralize→RED /
restore→GREEN). Document standing LOWs (incl. the consolidated currency-fallback LOW carried since 11c — not in
this slice's surface, no new currency here).
