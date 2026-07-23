# Phase-5 Slice 13 — Evaluation360 WRITE surface (6 writes) → C#

**Status:** built, dark-by-default behind `Platform:Evaluation360WriteEnabled` (default false).
**Kind:** the WRITE port of the evaluation360 domain (`efcoreStranglerWrite`), completing the domain after Slice-7
(the 5 reads). With the 6 writes ported, the ENTIRE `evaluation360` router (5 reads + 6 writes) has a C# analog and
the domain becomes **FLIP-READY** (eval360-OWNED — no non-eval360 reader/writer of the three tables). The ownership
flip itself is a deploy-gated cutover, deferred — TS stays the sole active writer until Federico flips the flag per
surface at canary (dark → canary → full).

Ports the 6 mutation bodies of `packages/api/src/routers/evaluation360.ts` still on TS (the real write logic lives in
`repositories/evaluation360.repository.ts`; the service maps repo results → error codes):
- STAFF (`permissionProcedure` + **`requireOrgScope`**): `createCycle`, `openCycle`, `closeCycle`, `publishCycle`,
  `assignRaters`.
- SELF-SERVICE (`protectedProcedure` — **IDENTITY-anchored**): `submitRatings`.

## Endpoints (dark-by-default)

| Method | Route | TS analog | Gate |
|--------|-------|-----------|------|
| POST | `/evaluation360/cycles` | createCycle | staff-JWT + `evaluation360:create` + org-gate |
| POST | `/evaluation360/cycles/{id}/open` | openCycle | staff-JWT + `evaluation360:update` + org-gate |
| POST | `/evaluation360/cycles/{id}/close` | closeCycle | staff-JWT + `evaluation360:update` + org-gate |
| POST | `/evaluation360/cycles/{id}/publish` | publishCycle | staff-JWT + `evaluation360:update` + org-gate |
| POST | `/evaluation360/cycles/{id}/raters` | assignRaters | staff-JWT + `evaluation360:create` + org-gate |
| POST | `/evaluation360/assignments/{id}/ratings` | submitRatings | **IDENTITY** (any resolved principal; NO grant, NO scope) |

Mapped ONLY when `Platform:Evaluation360WriteEnabled` is true OR at build-time OpenAPI generation
(`GetDocument.Insider`) — the emitted contract stays accurate while runtime stays dark. `TS stays the single active
writer` is a runtime FACT, not a ledger claim.

## ⚠️ THE LOAD-BEARING SECURITY INVARIANT (router docstring L40-49)

`submitRatings` is **IDENTITY-anchored**: authorization is `raterUserId === caller.id`, NOT an RBAC grant and NOT
scope. It uses the `Evaluation360SelfServiceGate` (Slice-7, the identity-only gate) — NOT the staff gate — and its
every query/write HARD-FILTERS on `raterUserId = caller.id` (+ org). It MUST NOT use `requireOrgScope` /
`assertScoped` / `scopeWhereFor`: for an org-scoped caller (super_admin/hr_admin) those degrade the where-fragment to
match-all, which would let an admin submit **forged feedback** on behalf of another rater. `raterAssignment` is
deliberately NOT a `ScopedEntity`. BITE-PROVEN: an org-admin caller cannot submit for an assignment whose
`raterUserId ≠` their own id → NOT_FOUND, no write (`Evaluation360WriteEndpointAuthTests`
`Submit_OrgAdmin_ForAnotherRatersAssignment_Is404_NoForgedWrite` + repo bite `Submit_identity_anchored_*`).

## The 6 writes — faithful ports

### createCycle (`evaluation360:create`)
Input `{ name: string 1..200 }`. INSERT `review_cycles` `{ organizationId, createdById = caller, name, status =
'draft' }` (tracked EF add; id client-generated `Guid.NewGuid()`, Prisma `@default(uuid())` parity; created_at/
updated_at set explicitly, Prisma client-side). Returns the repo select `{ id, name, status, createdAt }` (the TS
`service.createCycle` returns the repo row verbatim).

### openCycle / closeCycle / publishCycle (`evaluation360:update`)
Input `{ cycleId }` (route param). Atomic guarded transition via conditional `ExecuteUpdateAsync`:
- open: `WHERE id, org, status='draft'` → `status='open', opens_at=now`.
- close: `WHERE id, org, status='open'` → `status='closed', closes_at=now`.
- publish: `WHERE id, org, status='closed'` → `status='published', published_at=now`.

**count 0 ⇒ CONFLICT** (409 `"La transición no es válida para el estado actual del cycle"`) — the row is absent, not
this org, or not in the expected current state (the TS guarded `updateMany` + `count===0` → CONFLICT). `draft → open →
closed → published` only.

### assignRaters (`evaluation360:create`)
Input `{ cycleId, assignments[1..500] of { subjectUserId, raterUserId, relationship∈RATER_RELATIONSHIPS } }`. All in
ONE transaction under TenantScope (the status re-check is INSIDE the tx, not a separate pre-read, so a concurrent
closeCycle cannot slip a createMany through — TOCTOU parity):
1. Re-check the cycle: `findFirst { id, org, status ∈ ['draft','open'] }` → null ⇒ **cycleNotOpen** → 409
   `"El ciclo debe estar en borrador o abierto para asignar evaluadores"`. (**NOTE**: draft AND open are BOTH allowed
   — the spec's parenthetical "draft or closed" is imprecise; only `closed`/`published` error. Faithful to the TS
   `expectedStatuses = ['draft','open']`.)
2. Validate org-membership: every distinct subjectUserId/raterUserId must be a `users` row in the org; any
   cross-org/nonexistent id ⇒ **missingUserIds** → 400 `"Uno o más usuarios no pertenecen a esta organización"`.
3. `createMany` with `skipDuplicates` on the `[cycle_id, subject_user_id, rater_user_id]` unique key — ported as a
   parameterized `INSERT … SELECT … FROM unnest(@ids,@subjects,@raters,@rels) … ON CONFLICT (…) DO NOTHING`; the
   returned affected-row count is the `created` count (skipped duplicates are not counted — Postgres/Prisma parity).
   Returns `{ created }`.

### submitRatings (`protectedProcedure` — IDENTITY)
Input `{ assignmentId, ratings[EXACTLY 6, each competency once, rating 1..5, comment? ≤5000] }`. The Zod
`.length(6).refine(6 distinct competencyKeys)` is enforced in the endpoint BEFORE any DB work (→ 400).
1. **Ownership pre-fetch** (org + rater anchored): does an assignment `{ id, org, raterUserId = caller }` exist? null ⇒
   404 `"Evaluación no encontrada"` — a mismatch on id, org OR raterUserId is indistinguishable from outside.
2. **Atomic claim + insert** in ONE tx under TenantScope: conditional `ExecuteUpdateAsync` on `rater_assignments
   WHERE id, org, raterUserId = caller, status='pending', cycle open` → `status='submitted', submitted_at=now`;
   **count 0 ⇒ CONFLICT** (409 `"La evaluación no está abierta o ya fue enviada"` — already submitted / cycle not
   open, claim-idempotency). On a successful claim, INSERT the 6 `rater_responses` (tracked AddRange) — both commit
   or roll back together.

## Reuse (no re-invention)

- **Native enums**: `review_cycles.status` / `rater_assignments.relationship` / `.status` are native Prisma enums the
  writes FILTER and SET — the write context reuses the Slice-7 `Evaluation360ReadDataSource.Build`/`.MapEnums`
  (Postgres has no implicit `enum = text` operator) behind a dedicated `Evaluation360WriteDataSourceHolder` (mirrors
  the read holder so the enum mapping never bleeds into other string-based contexts).
- **Staff gate**: `Evaluation360StaffGate` gains an action-parameterized `AuthorizeAsync` overload (create/update);
  the existing read overload forwards `"read"` byte-unchanged (CA1068-safe — `CancellationToken` stays last). It
  still applies the organization/company org-gate (`OrgGate`) — all 5 staff writes require org scope (TS
  `requireOrgScope`).
- **Self-service identity anchoring**: `submitRatings` reuses the Slice-7 `Evaluation360SelfServiceGate` verbatim
  (any resolved principal; the caller's `UserId` becomes the `raterUserId` hard-filter).
- **EF writes-under-RLS**: `TenantScope.BeginAsync` + a transaction; conditional `ExecuteUpdateAsync` (count-0
  CONFLICT) for the four transitions + the submit-claim (mirrors Slice-12 `CompensationWriteRepository` + #140).

## Ledger / ownership

`review_cycles` + `rater_assignments` + `rater_responses` move `efcoreReadOnly` → `efcoreStranglerWrite` in
`docs/architecture/table-ownership.md`. All three are Prisma-OWNED (DDL/migrations) AND still written by the TS
evaluation360 router, so the flip is a COEXISTENCE write (deploy-flag keeps exactly one ACTIVE writer). They are ALSO
still READ by `Evaluation360ReadDbContext` (Slice-7) — a strangler-write table may be read too; the ledger tracks the
table's strongest EF relationship (write), exactly like `subscriptions` (Slice-4) and `salary_adjustments` (Slice-12).
The domain is now **FLIP-READY** (eval360-owned — grep-confirmed no non-eval360 reader/writer of the three tables); the
ownership flip to `efcore` stays deferred to the deploy-gated cutover. `node scripts/table-ownership.mjs` stays green
(all three stay Prisma-`@@map`'d + registered — no cross-owner collision, no unregistered EF table).

## Invariants (each BITE-PROVEN, real-RLS Testcontainers)

1. **State machine** — each illegal transition (openCycle on an already-open/closed/published cycle, closeCycle on a
   non-open, publishCycle on a non-closed, or a cross-org cycle) → count 0 ⇒ 409, no state change. `draft → open →
   closed → published` only.
2. **assignRaters** — cycle not draft/open (closed/published) → cycleNotOpen (409); missing/foreign-org subject/rater
   id → missingUserIds (400); the status guard runs INSIDE the tx; `skipDuplicates` → the `created` count excludes
   pre-existing rows.
3. **submitRatings identity-anchoring** — an org-admin (org scope) CANNOT submit for another user's assignment →
   NOT_FOUND, no write (the raterUserId hard-filter, NOT scope).
4. **submitRatings claim-idempotency** — a 2nd submit on a claimed assignment → 409, no duplicate responses (and a
   submit on a non-open cycle → 409).
5. **submitRatings validation** — exactly 6 competencies each once (`.length(6)` + distinct refine) → 400 otherwise;
   rating 1..5; comment ≤5000.
6. **Tenant isolation** — every write UNDER TenantScope (app_tenant + org GUC → RLS) + explicit `organization_id`; no
   cross-org write (a cross-org cycle transition/assign → count 0 / cycleNotOpen; RLS hides the row).

## Clean-architecture layout

- **Domain** `Tims.Domain/Evaluation360/Evaluation360WriteModels.cs` — `RaterAssignmentInput`,
  `RatingSubmissionInput`, `CreateCycleResult`, `CycleTransitionResult`, `AssignRatersDbResult`,
  `AssignRatersOutcome`/`AssignRatersResult`, `SubmitRatingsOutcome`/`SubmitRatingsResult`, `Eval360Relationships`.
- **Application** `IEvaluation360WriteRepository` + `Evaluation360WriteUseCase` (transition count-0 → conflict;
  assignRaters outcome mapping; submitRatings pre-fetch → claim).
- **Infrastructure** `Evaluation360WriteDbContext` (+ `ReviewCycleWriteEntity` / `RaterAssignmentWriteEntity` /
  `RaterResponseWriteEntity` / `UserWriteEntity`) + `Evaluation360WriteDataSource` (the `Evaluation360WriteDataSourceHolder`) +
  `Evaluation360WriteRepository` (TenantScope + guarded ExecuteUpdate + unnest ON CONFLICT insert).
- **Api** `Evaluation360WriteEndpoints` (the 6 routes; gate + bounded input + the 6-competency refine) + the
  `Evaluation360StaffGate` action overload + `Program.cs` DI/mapping + `PlatformOptions.Evaluation360WriteEnabled`.
