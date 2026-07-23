# Phase-5 Slice 15 — Nine-box (calibration) WRITE surface (5 writes) → C#

**Status:** to build, dark-by-default behind `Platform:NineBoxWriteEnabled` (default false).
**Kind:** the WRITE port of the nine-box calibration domain (`efcoreStranglerWrite`), completing the calibration
surface after the NineBox READ slice (Slice-10). **Flip-clean:** `calibration_sessions`/`calibration_members`/
`calibration_votes` are touched by NOTHING outside `packages/api/src/routers/ninebox.ts` (grep-verified: 16 hits, one
file — zero foreign readers/writers). The 5 writes touch ONLY those three tables; `nine_box_evaluations` is NEVER
written by a mutation (one foreign READ from `succession.getSuggestedSuccessors`, irrelevant to a write-surface flip)
and stays `efcoreReadOnly`. Ports the 5 mutation bodies of `ninebox.ts` (inline `prisma.*`; no TS service/repo — the C#
port introduces the clean-arch layering, like succession Slice-14).

## ⚠️ TENANCY MODEL (differs from succession — read carefully)
`calibration_members` and `calibration_votes` have **NO `organization_id`** — tenancy is via the session FK. RLS is a
**session-subquery policy** (migration `20260604100000`): `USING/WITH CHECK EXISTS (SELECT 1 FROM calibration_sessions
par WHERE par.id = session_id AND par.organization_id = GUC)`. Consequences:
- The C# write entities for member/vote have **no `OrganizationId` property**; org scoping comes from the session
  linkage + the RLS subquery. WITH CHECK blocks inserting a member/vote whose session is not in the caller's org.
- Only `calibration_sessions` carries `organization_id` (RLS = the standard `organization_id = GUC`). `createdById`.
- Timestamps: session has `createdAt`+`updatedAt`; **member and vote have `createdAt` ONLY (no updatedAt)**.
- No native PG enums (status/quadrant are plain `String`). No jsonb writes. → NO NpgsqlDataSource holder.

## Endpoints (dark-by-default; mapped only when flag on OR build-time OpenAPI gen)

| Method | Route | TS analog | Gate |
|--------|-------|-----------|------|
| POST | `/ninebox/calibrations` | createCalibration | `ninebox:create` + **requireOrgScope** |
| POST | `/ninebox/calibrations/{sessionId}/votes` | submitCalibrationVote | `ninebox:update` + **membership+identity** (NO requireOrgScope) |
| POST | `/ninebox/calibrations/{sessionId}/members` | addCalibrationMember | `ninebox:update` + **requireOrgScope** |
| DELETE | `/ninebox/calibrations/{sessionId}/members/{userId}` | removeCalibrationMember | `ninebox:update` + **requireOrgScope** |
| POST | `/ninebox/calibrations/{sessionId}/finalize` | finalizeCalibration | `ninebox:update` + **requireOrgScope** |

## ⚠️ LOAD-BEARING SECURITY INVARIANTS (varied per-endpoint mechanics — do NOT collapse)
`NineBoxStaffGate` gains an action-parameterized overload (create/update; reads forward `"read"` byte-unchanged,
CancellationToken last) and RETURNS the resolved scope; each endpoint applies its own mechanic:

1. **submitCalibrationVote = MEMBERSHIP + IDENTITY anchored (NOT org-scoped)** — the marquee invariant (eval360
   submitRatings analog). In order (ninebox.ts:360-418): (a) session `{id, org}` exists → else **404** "Sesion de
   calibracion no encontrada"; (b) the VOTER (`caller.id`, NEVER input) must be a `calibration_member` of the session
   → else **403** "Solo un miembro del comite puede votar"; (c) the `evaluatedUserId` must be a user in-org → else
   **404** "Usuario evaluado no encontrado" (**a prior Codex hardening — REGRESSION CORPUS, preserve + red-if-regressed
   test**; deliberately NOT subject-scoped — committee panels calibrate across teams, MEMBERSHIP is the authority).
   `voterId = caller` in BOTH the upsert conflict-key AND the create → **an org-admin/non-member cannot forge or
   overwrite another member's vote** (bite-proven). NO requireOrgScope/assertScoped.
2. **createCalibration / addCalibrationMember / removeCalibrationMember / finalizeCalibration → `requireOrgScope`**
   (org governance — a committee member holds ninebox@team and must NOT create sessions / self-add-then-vote; narrow
   scope → 403). Reuse `OrgGate.RequireOrgScopeSatisfied`.
3. **createCalibration `memberIds` cross-tenant hardening (NEW — the succession H1 lesson).** TS inserts
   `input.memberIds` verbatim into nested `calibration_members.create` with **NO in-org validation** (ninebox.ts:243-250)
   — RLS only checks the session linkage, NOT the member `user_id`, so an org-scoped creator could seed a cross-tenant
   member (org-A session, org-B user). **FIX in BOTH stacks:** validate each `memberId` is a user in the caller's org
   (TenantScope-filtered `users` lookup) BEFORE the nested insert; a cross-org/nonexistent id → **400**, nothing
   written (atomic). (addCalibrationMember ALREADY validates its `userId` in-org, ninebox.ts:438-444 — preserve; and
   the vote's evaluatedUser is validated — preserve. createCalibration's memberIds is the only gap.)
4. **Provenance/anti-forgery:** `createdById = caller` (session), `voterId = caller` (vote), `status='draft'` (session
   on create) / `'invited'` (member) / `'finalized'` (finalize) — server-side, never from input. Every write UNDER
   `TenantScope`; the RLS WITH CHECK (session-org) is the tenant guard for member/vote inserts.

## The 5 writes — faithful ports
### createCalibration (`ninebox:create` + requireOrgScope)
Input `{ period: string ≤100, scheduledAt?: ISO-8601 datetime, memberIds?: uuid[] ≤100 }`. ONE TenantScope tx:
validate each memberId in-org (§3) → INSERT `calibration_sessions {id=Guid.NewGuid(), org, period, status='draft',
createdById=caller, scheduledAt?, createdAt=updatedAt=now}` → nested INSERT `calibration_members {id, session_id,
user_id=memberId, status='invited', createdAt=now}` for each. Returns the session with `include: { members: true }`
(the full member rows). VERIFY the exact returned member shape (TS `include: {members:true}` = full member rows).

### submitCalibrationVote (`ninebox:update` — membership+identity)
Input `{ sessionId(route), evaluatedUserId: uuid, quadrant: string ≤100, justification?: ≤20000 }`. Pre-checks (§1
a/b/c). **Atomic upsert** on unique `(session_id, evaluated_user_id, voter_id=caller)`: parameterized raw
`INSERT … ON CONFLICT ON CONSTRAINT calibration_votes_session_id_evaluated_user_id_voter_id_key DO UPDATE SET
quadrant=…, justification=…` (EF has no native upsert — mirror the eval360 raw-SQL ON CONFLICT). Under TenantScope, the
INSERT WITH CHECK (session-org) passes because the session is in-org. Returns the upserted vote (full row: id,
sessionId, evaluatedUserId, voterId, quadrant, justification, createdAt). VERIFY the exact constraint name in the
fixture DDL / a generated migration.

### addCalibrationMember (`ninebox:update` + requireOrgScope)
Input `{ sessionId(route), userId: uuid }`. ONE tx: session `{id, org}` exists → 404 "Sesion…"; userId in-org → 404
"Usuario no encontrado"; INSERT `calibration_members {status='invited'}`. Unique `(session_id, user_id)` violation
(23505, constraint `calibration_members_session_id_user_id_key`) → **409 CONFLICT** "El usuario ya es miembro de este
comite" (FAITHFUL — TS catches P2002→CONFLICT; use constraint-name-specific catch, succession M2 lesson). Returns
`{ id }` (TS `select: { id: true }`).

### removeCalibrationMember (`ninebox:update` + requireOrgScope)
Input `{ sessionId(route), userId(route) }`. session `{id, org}` exists → 404; then atomic `ExecuteDeleteAsync`
`calibration_members WHERE session_id, user_id`; affected 0 → **404** "Miembro no encontrado". Returns `{ success: true }`
(TS shape). (Set-based delete — no tracked-load TOCTOU risk.)

### finalizeCalibration (`ninebox:update` + requireOrgScope)
Input `{ sessionId(route) }`. **UNCONDITIONAL update** (TS has NO state-machine guard, ninebox.ts:483-492): conditional
`ExecuteUpdateAsync` `calibration_sessions WHERE id, org` SET `status='finalized', completed_at=now, updated_at=now`;
count 0 → **404 NOT_FOUND** (a documented minor improvement over TS `update`→P2025→500 on absent/cross-org, exactly the
succession removeSuccessor precedent). Returns the updated session (full row). VERIFY the TS return shape (full session).

## Reuse (no re-invention)
`NineBoxStaffGate` action overload; `OrgGate.RequireOrgScopeSatisfied`; the read slice's calibration entities as a
template for a NEW `NineBoxWriteDbContext` (do NOT make the read context writable) + a read-only `users` entity for the
in-org checks; `TenantScope.BeginAsync` + tx; shared `NodeIsoDateTimeOffsetConverter` for all wire timestamps; membership
check = a `calibration_members {session, user=caller}` read under TenantScope (identity-anchored, like eval360
SelfServiceGate — NOT a ScopedEntity probe; calibrationSession/Member are NOT registered scoped entities). Strict-uuid
`Guid.TryParseExact(…,"D")` for body uuids (succession Codex-LOW precedent). JsonObject Zod-parity parse for optional/
null fields (succession F1).

## Ledger / ownership
`calibration_sessions` + `calibration_members` + `calibration_votes` → `efcoreStranglerWrite` (Prisma-owned DDL +
still TS-written = coexistence; flip-ready — all three clean-owned). `nine_box_evaluations` UNCHANGED (`efcoreReadOnly`).
`node scripts/table-ownership.mjs` stays green.

## Invariants (regression corpus — each BITE-PROVEN, real-RLS Testcontainers w/ the session-subquery policy)
1. **Vote membership+identity** — a non-member (even org-admin) → 403; voterId is always the caller (cannot target
   another voter_id) — bite.
2. **Vote upsert idempotency** — a 2nd (session, evaluated, voter) vote UPDATEs in place, no dup row.
3. **Vote evaluatedUser in-org** (preserve Codex hardening) — cross-org evaluatedUserId → 404, no vote.
4. **createCalibration memberIds in-org (H1-class)** — a cross-org memberId → 400, NO session/members written — bite
   (neutralize→RED). Both stacks.
5. **addCalibrationMember** — cross-org userId → 404; dup (session,user) → 409 (constraint-specific), no 2nd row.
6. **removeCalibrationMember** — count-0 → 404; cross-org session → 404 (RLS hides it).
7. **finalizeCalibration** — absent/cross-org → 404 (count-0); a valid finalize sets finalized+completedAt.
8. **requireOrgScope** on create/add/remove/finalize — a narrow leader → 403, no write.
9. **Tenant isolation** — every write UNDER TenantScope; the WITH CHECK (session-org) blocks a cross-org member/vote
   insert (RLS-necessity bite: tenant role w/o GUC → 42501 / cross-org session → blocked).
10. **Input bounds** — period ≤100, quadrant ≤100, justification ≤20000, memberIds ≤100; strict uuids.

## Clean-arch layout (additive; mirrors succession Slice-14)
Domain `NineBoxWriteModels.cs` (inputs + result rows [session+members, vote, member-id, session] + outcome enums for
Conflict/NotFound/Forbidden/SubjectNotInOrg); Application `INineBoxWriteRepository` + `NineBoxWriteUseCase`;
Infrastructure `NineBoxWriteDbContext` (+ write entities [no OrganizationId on member/vote] + read-only user entity) +
`NineBoxWriteRepository` (TenantScope + raw ON-CONFLICT upsert + tx nested-insert + ExecuteDelete/ExecuteUpdate +
constraint-specific 23505 catch); Api `NineBoxWriteEndpoints` (5 routes + gate overload + JsonObject input) +
`Program.cs` DI/mapping + `PlatformOptions.NineBoxWriteEnabled`.

## Review fix wave (3-review + Codex gate — applied)

Independent gate green; security review **GO**; parity **GO-with-conditions**; Codex **GO-with-conditions**. Applied
(all C#-only — the TS stack was already correct on these):

- **F1 (parity MEDIUM) — vote justification wiped on re-vote.** `DO UPDATE SET justification = EXCLUDED.justification`
  NULLed a prior justification when a re-vote omitted it, whereas TS Prisma skips `undefined` and PRESERVES it. FIX:
  `justification = COALESCE(EXCLUDED.justification, calibration_votes.justification)` (exactly faithful — TS can't
  clear it on re-vote either; an explicit JSON null is a 400 upstream). **Bite-proven** (neutralize→RED /
  restore→GREEN: `SubmitVote_revote_without_justification_preserves_prior`).
- **Codex M1 (MED) — vote TOCTOU.** Membership was checked before the upsert but not atomically with it; a member
  racing their own `removeCalibrationMember` could still cast a vote. FIX: the upsert is now a guarded
  `INSERT … SELECT … WHERE EXISTS(calibration_members session,voter) AND EXISTS(users id,org) … ON CONFLICT … DO
  UPDATE` — the eligibility is re-verified ATOMICALLY at write time; 0 rows (race lost) → RETURNING empty → the caller
  maps to 403, no write. Closes both the membership race and the (speculative) evaluated-user race. Pre-checks kept
  for the distinct UX error codes/messages.
- **F2 (LOW) — scheduledAt over-permissive.** `DateTimeOffset.TryParse(RoundtripKind)` accepted zone-less strings Zod
  `.datetime()` rejects and stored a machine-TZ-dependent instant. FIX: require a `Z` suffix + parse `AssumeUniversal`
  (UTC). Bite-proven (`CreateCalibration_BadInput_AfterAuth_Is400` zone-less case → 400).
- **F3 / Codex-L (LOW) — invalid-member 400 body.** Now returns the TS Spanish message
  (`"Uno o mas miembros no pertenecen a esta organizacion"`) alongside `error: "invalid_member"`.

### Accepted / documented (no code change)
- **Codex M2 (memberIds create race) — accepted as UNREACHABLE.** Codex itself found no cross-org user-move mutation,
  so the "user moves org between the up-front in-org check and the nested insert" race has no code path today. The
  up-front distinct-in-org check + `calibration_members` session-subquery RLS + the `users` FK are the defenses. The
  fully-atomic belt-and-suspenders (a DB CHECK/trigger enforcing `member.user.org == session.org`) is a Prisma-DDL
  change out of scope for a dark strangler — **flagged as a Federico compliance-hardening follow-up.**
- **Security L1 (duplicate memberIds in one createCalibration → 500) — faithful to TS** (TS nested `create` with a
  dup → P2002 uncaught → 500). Both stacks 500; self-inflicted, atomic rollback, no cross-tenant/partial write. Left
  faithful (a `Distinct()` on the insert would DIVERGE from TS).

## Gate (same as every slice)
Independent local gate (never trust agent numbers): pnpm install --frozen-lockfile + `pnpm exec prisma generate` (NOT
npx — succession version-trap) → build 0-warn / format / unit+integration (Docker real RLS — `docker info` FIRST if a
mass integration fail appears) / table-ownership / api+web tsc / vitest. Then 3-review (security + parity opus + Codex
`codex:codex-rescue` → poll the companion) → fix Crit/High/Med bite-proven → push → PR → admin-merge past the CI billing
trap → worktree remove + branch delete → memory.
