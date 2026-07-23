# Phase 5 · Slice 16 — Engagement WRITE surface (coexistence, dark)

**Branch** `feat/csharp-phase5-engagement-write` off `main` `a316e87`.
**Flag** `Platform:EngagementWriteEnabled` (default **false**) — dark-by-default; off ⇒ every write route 404s.
**Ledger** `surveys`, `survey_responses`, `action_plans`: `efcoreReadOnly` → **`efcoreStranglerWrite`** (COEXISTENCE,
**NOT a flip**). These tables stay read by the LIVE TS `monitoring.ts` + `dei.ts` + the alert-evaluation cron AND by the
C# engagement READ slice (#166). `leader_commitments` + `alerts` stay `efcoreReadOnly` (not written by these 5).

This is the FIRST coexistence-write on a NON-flip-clean domain since billing. Same per-slice recipe: pure-faithful port,
dark flag-gate, both-stacks hardening for any cross-tenant hole, 3-review + Codex gate, regression corpus.

## 1. Scope — the 5 writes (packages/api/src/routers/engagement.ts, VERIFIED against source)

| Endpoint | Perm | Table | Scope mechanic | Returns |
|---|---|---|---|---|
| `createSurvey` | `engagement:create` | surveys | grant-only (org via `ctx.user.organizationId`) | **full survey row** |
| `activateSurvey` | `engagement:create` | surveys | 404-gate id+org → update | `{id,status}` |
| `submitSurveyResponse` | `engagement:create` | survey_responses | **identity-anchored** (userId=caller) | `{id,submittedAt}` |
| `createActionPlan` | `engagement:create` | action_plans | `assertSubjectInScope(responsibleId)` | **full row** |
| `updateActionPlan` | `engagement:update` | action_plans | `assertScoped('actionPlan',id)` + optional `assertSubjectInScope` | **full row** |

Non-goals: the 14 reads (#166, already shipped) and the FX reads (#168) are untouched. NO ownership flip.

### 1.1 Per-endpoint mechanics (port FAITHFULLY — router lines cited)

- **createSurvey** (L68–105): `survey.create` — title, type (`pulse|enps|climate|custom`), **questions jsonb** (array,
  ≥1; each: text≤500, type `scale|text|multiple_choice|yes_no`, options≤100×≤200, required default true, category≤100),
  **targetGroups jsonb?** (companyIds/businessUnitIds/teamIds each uuid[]≤1000, whole object optional),
  startsAt?/endsAt? (ISO datetime → Date), organizationId=ctx, createdById=ctx.user.id, status='draft'. Returns the
  full created row (Prisma default select — echoes responseCount:0, createdById, timestamps). **Port the full-row return
  faithfully** (no §21 trim — the create just wrote it; responseCount is 0 so no k-anon concern).
- **activateSurvey** (L107–120): findFirst {id, org} select {id, startsAt} → null ⇒ **404 NOT_FOUND** (`TRPCError`);
  else update status='active', `startsAt = existing.startsAt ?? new Date()` (preserve a prior startsAt, else stamp now),
  select {id, status}. Single logical op; the read-then-update is not atomic in TS — port as-is but do the update with a
  `WHERE id AND organization_id` guard so a concurrent org change can't slip (RLS already guards org).
- **submitSurveyResponse** (L242–289): findFirst {id, org, status:'active'} select {id} → null ⇒ **`throw new Error`**
  (plain Error → tRPC INTERNAL_SERVER_ERROR wire; message "Encuesta no encontrada o no activa"). Faithful C# = map to a
  distinct result → **the endpoint returns 404** is NOT what TS does — TS surfaces a 500-shaped tRPC error. **Match TS
  behavior**: a plain-Error path (not a typed NOT_FOUND). Recommend a `SurveyNotActive` result → **500-class** to match
  the tRPC wire, OR document the deliberate improvement (clean 404) the way billing getInvoice did (#141). Pick 404 +
  DOCUMENT as an intentional port improvement (leak-free, deploy-flag-gated) — flag for the reviewer.
  Then `surveyResponse.create` {surveyId, **userId=ctx.user.id (ALWAYS the caller)**, answers jsonb, org} select
  {id, submittedAt}. **P2002 (unique surveyId,userId) → `TRPCError CONFLICT` "Ya respondiste esta encuesta"**.
  IDENTITY-ANCHORED like eval360 submitRatings (#170) / nine-box vote (#172): an org-admin CANNOT forge another user's
  response — userId is the caller, never an input. **submitSurveyResponse carries NO requireOrgScope** (an org-gate would
  forbid the own-scoped employee — the myPendingSurveys/getSurveyForResponse pattern). Just the grant + identity anchor.
- **createActionPlan** (L507–532): `assertSubjectInScope(access, caller, responsibleId, msg)` (throws FORBIDDEN if the
  target is outside the caller's subject set) → `actionPlan.create` {title, responsibleId, area?, notes?, dueDate?, org,
  status:'pending'}. Full-row return.
- **updateActionPlan** (L534–562): `assertScoped('actionPlan', id, access, caller, org)` (by-id IDOR probe → 404 if
  out-of-scope/missing) → if `responsibleId` present, `assertSubjectInScope(...)` (reassignment can't push out of scope)
  → `actionPlan.update` where {id, org} data {title?, notes?, status?(`pending|in_progress|completed`), responsibleId?,
  dueDate? — **`dueDate !== undefined ? (dueDate ? new Date : null) : {}`** tri-state: absent=unchanged, null-clears}.
  Full-row return.

## 2. Security analysis (the decisions that matter)

### 2.1 🔴 H1-class — createActionPlan / updateActionPlan cross-org `responsibleId` → BOTH-STACKS HARDENING
**Confirmed** (write-rules.ts:20 == SubjectInScope.cs:27–30): `assertSubjectInScope` returns **allowed with NO
org-membership check for organization/company scope**. `engagement:create` pre-seed grants are **org-wide** (org scope),
so the common caller path no-ops the check. `responsibleId` is a bare FK to `users`; RLS WITH CHECK on `action_plans`
guards only `organization_id`, and the FK constraint only checks the user EXISTS (in ANY org). ⇒ an org-scoped admin can
persist a **cross-org `responsibleId`** onto `action_plans.responsible_id`. This is the SAME class as succession H1/H2
(#171) and nine-box memberIds (#172), and it is a **pre-existing LIVE-TS hole**.
**Directive** (succession/11c precedent): **fix in BOTH stacks** — add an in-org existence check on `responsibleId`
under `TenantScope` before the create AND before the update-with-reassignment; **out-of-org ⇒ 403** (Spanish message).
C# in the write use-case/repo; TS in `engagement.ts` (a `db.user.findFirst({where:{id:responsibleId, organizationId}}})`
guard, or reuse an existing in-org user check). Bite-proven RED (neutralize→cross-org persists) → GREEN (403).
NOTE: because reads are RLS-scoped the cross-org row is not a data *leak*, but it IS a cross-tenant integrity/enumeration
hole — harden it. Confirm the LIVE-TS reachability before editing TS (don't assume; verify the grant scope path).

### 2.2 🟡 LOW (documented, NOT hardened) — createSurvey `targetGroups` unvalidated cross-org UUIDs
TS stores `targetGroups` (companyIds/businessUnitIds/teamIds) as **opaque jsonb** with no in-org validation. In the ported
surface `target_groups` is **never read back** (the C# read entity `SurveyReadEntity` doesn't map it; listSurveys selects
explicit fields sans targetGroups; no access decision consumes it). Validating would **diverge from TS** with no exploit
path. **Port faithfully (store as-is); document as a LOW + Federico follow-up** (a DB-CHECK/app validation if targeting is
ever wired to access) — mirrors the nine-box DB-CHECK-trigger follow-up. Do NOT harden this slice.

### 2.3 updateActionPlan by-id probe — MISSING EntityRootTable root (wire it, comp #169 precedent)
`assertScoped('actionPlan', id)` is a **by-id IDOR probe**. `ScopeProbeRegistry.Tables["action_plans"]` exists (field-map
for the scopeWhereFor translator, Slice-11) but there is **NO `EntityRootTable` entry** (registry comment L154 says so).
Add `[ScopedEntity.ActionPlan] = "action_plans"` to `EntityRootTable` (ScopeProbeRegistry.cs:201), anchored on
`responsible_id` (already the ProbeTable field). EXACTLY like Slice-12 wired the missing salaryAdjustment root. Verify
`ScopedProbe.ProbeAsync` resolves it → out-of-scope ⇒ `ScopedNotFoundException` → **404** "Plan de accion no encontrado"
(the message already exists, ScopedNotFoundException.cs:45). action_plans has no `deleted_at` → NOT soft-deletable.

### 2.4 Identity anchor + P2002 (submitSurveyResponse)
userId=caller ALWAYS (never an input). Reproduce the unique(survey_id,user_id) violation → **409 CONFLICT**. Prefer an
atomic guarded insert (nine-box vote precedent) OR catch Postgres 23505 on the unique constraint → CONFLICT; either is
faithful. Active-gate (status='active') stays a pre-insert existence check.

## 3. C# design (reuse the succession/nine-box WRITE template)

**Files (mirror `services/Tims.Platform/src/*/Succession/*Write*`):**
- `Tims.Domain/Engagement/EngagementWriteModels.cs` — command records (CreateSurveyCommand w/ questions/targetGroups as
  parsed+revalidated shapes, ActivateSurveyCommand, SubmitSurveyResponseCommand, Create/UpdateActionPlanCommand) + result
  DTOs (full-survey-row DTO, {id,status}, {id,submittedAt}, full-action-plan DTO). JSON via the shared
  `Tims.Domain.Json` Node-ISO converter for timestamps; jsonb bound as raw text.
- `Tims.Application/Engagement/IEngagementWriteRepository.cs` + `EngagementWriteUseCase.cs` — orchestration
  (config-gate → resolve scope from the gate → per-endpoint scope check [SubjectInScope / ScopedProbe] → repo write).
- `Tims.Infrastructure/Engagement/EngagementWrite{Entities,DbContext,Repository}.cs` — **WRITE** DbContext over the 3
  tables under `TenantScope` (SET LOCAL app_tenant + org GUC; RLS WITH CHECK enforces org). Reuse the read-entity column
  mappings but ADD the write-only columns: `SurveyWriteEntity` needs **TargetGroups** + **CreatedById** (+ ResponseCount
  default 0, Status). ⚠️ **jsonb parameter type**: bind jsonb columns with the Npgsql `jsonb` type hint (EF
  `HasColumnType("jsonb")` on a string prop works for EF-tracked writes; raw SQL needs `::jsonb` cast — the #140/#347 +
  nine-box lesson: a text param without a type hint 500s). ⚠️ **timestamp**: Prisma `timestamp(3) without time zone` →
  `HasColumnType("timestamp")` Unspecified-kind (read-slice precedent); persisted==returned truncation for JS-Date parity.
- `Tims.Api/Engagement/EngagementStaffGate.cs` — **add an action-parameterized overload** (`create`/`update`) keeping the
  existing 5-arg `read` gate **byte-unchanged** (CompensationStaffGate #169 precedent). Returns the resolved
  `EngagementGateResult` (context + scope) so each endpoint applies its own mechanic.
- `Tims.Api/Engagement/EngagementWriteEndpoints.cs` — 5 POST/PATCH endpoints, JWT + gate + `EngagementWriteEnabled`
  flag-gate (off ⇒ 404, mapped ONLY at build-time OpenAPI via `GetDocument.Insider` so the contract is accurate but the
  runtime is dark). Wire into `Program.cs`.
- `ScopeProbeRegistry.cs` — add the `[ScopedEntity.ActionPlan]` EntityRootTable root (§2.3).
- `PlatformOptions.cs` — add `EngagementWriteEnabled` (default false).

**AnchorLoader**: createActionPlan/updateActionPlan `assertSubjectInScope` needs the team/unit anchor loaders for narrow
scopes — reuse the existing `IAnchorLoader` wiring (comp/succession write path). Org/company scope short-circuits (§2.1
hardening runs regardless of scope).

## 4. Invariants / regression corpus (every one a red-if-regressed test)

1. **Dark-by-default**: flag off ⇒ all 5 routes 404 (no writer active on deploy).
2. **createActionPlan/updateActionPlan cross-org responsibleId ⇒ 403** (both stacks; bite RED→GREEN). ← the H1 fix.
3. **submitSurveyResponse userId=caller** — org-admin cannot forge another user's response (bite: attempt → own row only).
4. **P2002 duplicate response ⇒ 409** "Ya respondiste esta encuesta".
5. **activateSurvey** startsAt preserve-else-now; 404 on missing/cross-org.
6. **updateActionPlan** by-id probe out-of-scope ⇒ 404; dueDate tri-state (absent=unchanged / null=clear / set=update).
7. **createSurvey** questions/targetGroups jsonb round-trip: the PERSISTED jsonb bytes + values are identical both
   stacks (Postgres normalizes equally); the createSurvey RETURN echoes the in-memory node so its ephemeral JSON key
   ORDER differs from the TS Postgres-normalized order (semantically irrelevant — see §6c F1). JS Date truncation;
   status='draft'; responseCount 0.
8. **RLS**: every write under TenantScope; unset GUC / cross-org write ⇒ blocked (Testcontainers real RLS).
9. **createSurvey full-row return** shape parity (echoes createdById + timestamps).
10. Golden shared fixtures where a pure kernel is extracted (if any shaping is shared — likely none; these are thin writes).

## 5. Gate plan (standing)
Independent local gate (NEVER trust agent self-report): `pnpm install --frozen-lockfile` + `pnpm exec prisma generate`
(NOT npx) in the worktree; C# build 0-warn / `dotnet format` / unit + integration (Docker real RLS) /
`node scripts/table-ownership.mjs` / api+web tsc / vitest. Then 3-review in parallel (security opus + parity opus + Codex
via `codex:codex-rescue`) → fix Crit/High/Med bite-proven → Codex recheck → GO. Docker-crash mass-fail ⇒ check
`docker info` FIRST (infra). Merge `--squash --admin` past the CI billing trap.

## 6b. Implementation notes / deliberate divergences (as built)
- **submitSurveyResponse clean-404 (intentional, flag-gated).** The TS throws a plain `Error('Encuesta no encontrada
  o no activa')` → a tRPC INTERNAL_SERVER_ERROR (500-shaped). The C# port maps the not-found-or-inactive path to a
  clean, leak-free **404** (`SubmitSurveyResponseOutcome.SurveyNotActive`). This is the billing getInvoice (#141)
  precedent — documented in code (`EngagementWriteModels.cs`, `EngagementWriteRepository.cs`, `EngagementWriteEndpoints.cs`)
  and dark behind `EngagementWriteEnabled`. NOT a silent divergence.
- **updateActionPlan dueDate null-clear is reachable only at the repo layer.** The TS resolver spread
  `dueDate !== undefined ? (dueDate ? new Date : null) : {}` has a latent null-clear branch, but the Zod input is
  `z.string().datetime().optional()` (NOT `.nullable()`), so a wire `dueDate: null` is rejected **400** at the boundary
  — the null-clear is dead code through the validated path. The C# port matches this exactly: the endpoint validator
  rejects `dueDate: null` → 400 (Zod parity), while `UpdateActionPlanInput` faithfully carries the resolver's tri-state
  (absent=unchanged / null=clear / value=set) and is exercised at the repository level (INV-6 repo test). Production
  behavior is byte-identical to TS.
- **§2.1 H1 both-stacks fix (as built + bite-proven).** LIVE-TS reachability confirmed: `write-rules.ts:20`
  `assertSubjectInScope` returns with NO org-membership check for organization/company scope, and `engagement:create`
  pre-seeds are org-wide → the check no-ops on the common path; `responsibleId` is a bare FK (`users`), RLS WITH CHECK
  on `action_plans` guards only `organization_id`. Fixed in BOTH stacks — C# (`EngagementWriteRepository.ResponsibleInOrgAsync`,
  under TenantScope, → 403) AND live TS (`engagement.ts` createActionPlan + updateActionPlan reassign, a
  `db.user.findFirst({ where: { id: responsibleId, organizationId }, select: { id } })` guard → `TRPCError FORBIDDEN`).
  Bite-proven RED→GREEN: C# neutralizing `ResponsibleInOrgAsync` → the 4 cross-org tests go 200 (cross-org persists) →
  restoring → 403; TS dropping the `organizationId` filter → the `scope-wiring-engagement-write.test.ts` H1 tripwire RED
  → restoring → GREEN.
- **targetGroups (§2.2 LOW) ported faithfully.** Stored as opaque jsonb with NO in-org validation; the endpoint
  validates only the Zod SHAPE (uuid arrays ≤1000, unknown keys stripped like Zod) → 400 on a malformed shape. Never
  read back by any access decision. Federico follow-up (below) if targeting is ever wired to access.

## 6c. Review-gate fixes (3-review + Codex; applied before merge)
- **🔴 Codex HIGH — updateActionPlan scope-probe-then-update TOCTOU (both stacks, FIXED).** The endpoint's
  `assertScoped('actionPlan')` probe and the final UPDATE ran in SEPARATE transactions; a concurrent reassignment could
  move the plan's `responsible_id` out of the caller's narrow (team/unit) scope BETWEEN them, and the UPDATE (reloading
  by `id + organization_id` only) would still apply. Intra-org (no cross-tenant breach) but a real authorization-scope
  race AND a faithful port of the same LIVE-TS hole → fixed in BOTH stacks (the succession #171 / nine-box #172 atomic-
  guard precedent; security-opus rated it LOW, Codex HIGH — adjudicated as a fix per the standing both-stacks directive).
  - **C#**: `EngagementWriteRepository.UpdateActionPlanAsync` now re-checks the caller's scope predicate ATOMICALLY —
    a `SELECT 1 FROM action_plans t WHERE t.id=@id AND t.organization_id=@org AND (<predicate>) FOR UPDATE` on the SAME
    TenantScope txn BEFORE the mutation. A concurrent reassignment is either already visible (predicate → 0 rows → 404)
    or blocks on the row lock until commit. The predicate is built ONCE in the endpoint from the SAME scope + anchors as
    the probe (`ScopeWhereFor.BuildAsync` + `ScopePredicateSqlTranslator.Translate("action_plans", …)`) and threaded in
    as parameterized SQL; org/company scope → `TRUE` (no-op). Fully parameterized (identifiers are registry constants).
  - **TS**: `engagement.ts` updateActionPlan replaces the bare `db.actionPlan.update({where:{id,org}})` with an atomic
    `db.actionPlan.updateMany({ where: { AND: [{id},{organizationId},scopeWhereFor('actionPlan')] }, data })` → `count 0`
    ⇒ `TRPCError NOT_FOUND`, then a `findFirst` (explicit select) returns the full row. `assertScoped` stays (fast-fail +
    404-before-403 precedence).
  - Bite-proven: C# `UpdateActionPlan_scope_atomic_guard_out_of_scope_row_is_NotFound_and_no_change` (a plan whose
    responsible is M3, OUT of the {TeamLead,M1,M2} team set → 404, no mutation) + the in-scope positive test; TS tripwire
    asserts the scoped `updateMany`/`count 0`→404 shape and that a bare `actionPlan.update({` is NOT the write path.
  - **Codex recheck follow-up (TS read-back).** `tenantDb` wraps each Prisma call in its OWN txn, so the post-write
    `findFirst` return runs in a separate txn from the guarded `updateMany` — a concurrent reassignment between them
    could otherwise echo an out-of-scope row in the RESPONSE (the write itself is correctly blocked). Fixed: the
    read-back `findFirst` ALSO composes `scopeWhere` (`where: { AND: [{id},{organizationId},scopeWhere] }`) → a plan
    that left scope post-write returns null (leak-free), never an out-of-scope row. The C# path is inherently race-free
    (it mutates + returns the FOR UPDATE-locked row in ONE txn). Tripwire asserts both where-clauses are scoped.
- **Coverage (Codex) — dark-gate.** Added flag-off → 404 endpoint tests for the 3 previously-uncovered routes
  (activateSurvey / submitSurveyResponse / createActionPlan); all 5 write routes now proven dark, not just 2.
- **Accepted LOWs (documented, no code change):**
  - **submitSurveyResponse active-gate-then-insert race (Codex Med → accepted LOW).** External-writer-dependent and
    benign: a user's OWN response landing microseconds after a concurrent close. NO authorization / tenant / scope
    boundary is crossed (contrast the updateActionPlan race, which crosses a scope boundary and IS fixed above), and it
    is faithful to the TS (same check-then-insert structure). Not hardened.
  - **createSurvey jsonb key-order (parity F1).** The C# createSurvey return echoes the in-memory rebuilt jsonb node
    (insertion key order), while TS returns Postgres jsonb-normalized key order. Persisted bytes AND values are
    identical — only the ephemeral response's JSON key ORDER differs, which is semantically irrelevant (consumers read
    by key). See the softened INV-7 wording.
  - **activateSurvey 404 message (parity F2).** The C# 404 carries `{ message: "Encuesta no encontrada" }`; the TS 404
    is `TRPCError NOT_FOUND` with no message. An ADDED message (not a mismatch); both are 404, and the tRPC-vs-REST
    error envelopes differ structurally regardless.

## 6. Federico queue additions (surface, don't act)
- Flip `Platform:EngagementWriteEnabled` at canary (with the other write flags).
- targetGroups in-org validation / DB-CHECK if targeting is ever wired to access (§2.2 LOW follow-up).
- The consolidated grant-only/org-scope sensitive-aggregate access-model decision (unchanged; engagement reads carry it).
