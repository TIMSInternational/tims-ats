# Phase-5 Slice 25 — notification (issue #98)

> **Status**: steps 1–3 done, step 4 **backend half only**. Steps 5–7 open.
> **Flags**: `Platform:NotificationReadEnabled`, `Platform:NotificationWriteEnabled` — both default `false`.
> **Ledger**: `notifications` MOVED `efcoreAppendOnly` → `efcoreStranglerWrite`; `notification_preferences` added.

Ports `packages/api/src/routers/notification.ts` (11 procedures, 190 LOC) to C#.

## What "step 4" means here, precisely

The issue defines step 4 as dark endpoints **plus** the `apps/web/lib/platform-api/notification.ts` wrapper
behind `NEXT_PUBLIC_NOTIFICATION_VIA_CSHARP`. **This slice ships only the first half.** Saying "steps 1–4"
would be the same overstatement a panel corrected on #81 and again on #90. The wrapper is its own PR by the
#241 precedent.

FE consumers, measured: seven of the eleven procedures have live tRPC call sites
(`apps/web/app/(admin)/navbar/notification-dropdown.tsx`, `apps/web/app/(admin)/platform/notifications/page.tsx`)
— `list`, `unreadCount`, `markAsRead`, `markAllAsRead`, `archive`, `archiveAllRead`, `delete`.
**`getPreferences`, `updatePreferences`, `create` and `bulkCreate` have ZERO FE consumers.**

## The two authorization models

| Procedures                                                                                                                         | Gate                    | Authorization                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `list`, `unreadCount`, `getPreferences`, `markAsRead`, `markAllAsRead`, `archive`, `archiveAllRead`, `delete`, `updatePreferences` | `SelfServiceGate`       | **Identity only.** No grant, no org gate. Every statement hard-filters `user_id = <JWT-resolved caller>`. |
| `create`, `bulkCreate`                                                                                                             | `NotificationStaffGate` | `notification:create` — the domain's only grant.                                                          |

Nine of eleven being bare `protectedProcedure` is what makes this slice structurally different from every
prior one, and it changes three things: the gate, the test controls, and the parity story.

**The gate was extracted, not re-written.** `Evaluation360SelfServiceGate` was the only prior C# example of
this shape. It moved to `Tims.Api/Authentication/SelfServiceGate.cs` (domain-neutral) and evaluation360 now
consumes it there. This follows the `PlatformOwnerGate` convention, which exists for a security reason rather
than a DRY one: `ResolvePrincipalAsync` encodes impersonation-cookie handling and the middleware stash, and a
second hand-written copy is exactly where that gets subtly wrong.

**The test control had to change.** With no grant, "403 for the ungranted" cannot prove anything. The two
controls that carry the weight instead are:

1. a user holding **no** notification permission is **200** on all nine self-service procedures — this is what
   catches a self-service route mis-wired to the grant gate;
2. one user never sees or mutates another's rows.

Mutation 7 below confirms (1) is not decorative: wiring `unread-count` to the grant gate left every
"denied" test green and was caught **only** by the positive control.

## Divergence register

### 1. Cross-org notifications are hidden by RLS (DECIDED BY FEDERICO, 2026-08-19)

`notifications` rows are addressed by `user_id` but the production RLS policy is
`organization_id = current_setting('app.current_org_id')`. Both `notify()` call sites
(`routers/platform/organizations.ts:220`, `:300`) address **all platform owners** while stamping the
**target org's** id.

- **TS** reads via `tenantDb` as `postgres`, which is `BYPASSRLS` — so RLS never filters and owners see them.
- **C#** runs under `TenantScope`, which does `SET LOCAL ROLE app_tenant` (non-BYPASSRLS) — so RLS engages and
  those rows are **hidden**.

Federico chose to keep RLS engaged and pin the divergence rather than add a second BYPASSRLS-dependent reader
(the design #179 rejected in PR #141).

**Measured 2026-08-19 against production: 0 rows in `notifications`, 0 in `notification_preferences`, 0
org-less users, 2 platform owners.** The divergence is therefore **latent, not active** — but it is exactly
the shape `notify()` produces, so it will bite once rows exist. Pinned by
`List_CrossOrgRowAddressedToTheCaller_IsHiddenByRls_TheRecordedDivergence`.

**This is a step-5/6 blocker.** Flipping `NotificationReadEnabled` before it is resolved would empty the
platform notifications page. The real fix is a user-scoped RLS policy, which needs prod DDL **and** a user GUC
that `TenantScope` does not currently set — a repo-wide change, out of scope here.

### 2. An org-less platform owner sees an empty inbox

`TenantContext.OrganizationId` is `""` for a platform owner. `Guid.Parse("")` would 500, so the org id is
carried as `Guid?` and a null makes `TenantScope` set the GUC to `''`, which the fail-closed policy turns into
zero rows. A 200-with-empty-list, not an error. Pinned by `List_OrgLessPlatformOwner_SeesEmptyInbox_NotAnError`.

### 3. A foreign cursor returns an empty page instead of positioning it

Prisma's cursor subquery is by id. Here the boundary lookup is scoped to the caller's own rows, so a cursor
belonging to another user yields no boundary → empty page (the `ExternalAssessmentRepository` precedent).
Unscoping it would make the cursor an oracle for another user's notification timestamps.

## Reproduced faithfully (NOT fixed — "reproduce, don't improve")

- **`list` loses one row per page boundary.** TS pops the `(limit+1)`-th row and uses **its** id as
  `nextCursor`; the next call passes that id as a Prisma `cursor` with `skip: 1`, which starts _after_ it. The
  popped row appears on neither page. A pre-existing TS defect, **filed separately**. Pinned by
  `List_ExactlyLimitPlusOne_DropsTheOverflowRow_AndNamesItAsTheCursor` and
  `List_WithCursor_SkipsTheCursorRow_ReproducingTheTsRowLoss`.
- **`markAllAsRead` has no `archived` filter**, so it marks archived-and-unread rows read while `list` and
  `unreadCount` both exclude archived rows — it can report a count larger than the badge the caller can see.
- **`getPreferences` is a tRPC `query` that INSERTs.** It therefore sits under the READ flag while writing, and
  `NotificationReadEnabled` alone can create `notification_preferences` rows. It also has no upsert and no
  unique-violation handling, so two concurrent first-calls race.
- **`create`/`bulkCreate` do not validate that the target `userId` is in the caller's org**, and `bulkCreate`
  does not de-duplicate `userIds`. Both are TS behaviour. The unvalidated target is worth narrowing later; it
  is filed rather than fixed here so a step-5 diff stays interpretable.

## Traps this slice hit

- **TRAP 6** — `created_at`/`read_at`/`updated_at` are `timestamp(3) without time zone`. Every date carries
  `NodeIso(Nullable)DateTimeConverter`. Its companion also bit: the generator drops `"type"` through a custom
  converter, so a schema transformer restores it. **Scope stated honestly: 109 typeless `format: date-time`
  properties across 46 schemas exist on this branch; this slice contributed 2 and fixes only those 2. The
  remaining 107 are pre-existing and filed separately.**
- **TRAP 9** — every query parameter binds as `string?` and is parsed after the gate. The real cost is audit
  suppression: `SecurityDenialAuditMiddleware` records only 401/403, so a pre-gate 400 would let an ungranted
  caller enumerate `create` with a garbage body and leave no `authz_denied` row. Both directions pinned.
- **TRAP 11** — timestamps are truncated to whole milliseconds and re-kinded to `Unspecified` at the repository
  boundary. JS `Date` carries whole ms; `DateTime.UtcNow` carries 100ns ticks that Postgres would _round_.
- **TRAPs 3 and 8 do NOT apply** — `notifications.type` is plain `text`, not a native Postgres enum. Verified
  against the live schema, not assumed from the Prisma model.
- **EF `ValueGeneratedOnAdd` is not Prisma's "omit if unset".** It decides by _sentinel_, so an explicit
  `emailEnabled: false` — the CLR default — would be dropped and the DB default `true` stored instead. Every
  INSERT in this slice is raw SQL for that reason. Pinned by
  `UpdatePreferences_NoExistingRow_InsertsWithSuppliedValueNotTheDatabaseDefault`.
- **`SqlQuery<T>` needs a class with a parameterless ctor and settable properties** — a positional record does
  not materialise.
- **Routing**: `DELETE /notifications/{id:guid}` stays in the 405 candidate set for any 2-segment GET under
  `/notifications`, even though a non-guid segment fails the constraint. Harmless in production (no read and
  write route share a method+path) but it makes an "unmapped route" probe return 405, not 404.

## Verification

| Check                                          | Result                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `dotnet test` (full solution)                  | **1315 unit / 1591 integration**, 0 failed                                                                                                  |
| `npx vitest run`                               | **3240 tests / 324 files**, 0 failed                                                                                                        |
| `tsc --noEmit` (api, web)                      | pass                                                                                                                                        |
| `dotnet format --verify-no-changes` (check 19) | pass                                                                                                                                        |
| `schema.d.ts` freshness (check 20)             | pass                                                                                                                                        |
| OpenAPI contract freshness                     | pass (Release build produced no drift)                                                                                                      |
| gitleaks                                       | clean                                                                                                                                       |
| **Check 15 — cross-model**                     | **EXIT 2 — NOT RUN.** Codex quota-blocked until ~2026-09-09. Tier-3 same-model panel ran instead. **This is not cross-model verification.** |

Anchors before this slice: 3238 vitest / 1308 C# unit / 1521 C# integration. Deltas: +2 vitest (the `it.each`
over cutover.sh's surface list, no new file), +7 unit, +70 integration.

### Mutation proofs — 7 applied, 7 killed

| #   | Mutation                                         | Killed by                                                        |
| --- | ------------------------------------------------ | ---------------------------------------------------------------- |
| 1   | Drop `user_id` from the `list` query             | 5 tests incl. `List_NeverReturnsAnotherUsersNotification`        |
| 2   | Drop `user_id` from `markAsRead`'s UPDATE        | `MarkAsRead_AnotherUsersRow_Returns0_AndDoesNotMutateIt`         |
| 3   | Parse the `create` body BEFORE the gate (TRAP 9) | `Create_UngrantedMember_WithGarbageBody_Is403_NotBadRequest`     |
| 4   | "Fix" `nextCursor` to the last returned row      | 2 tests (endpoint + unit)                                        |
| 5   | Stop re-kinding timestamps (TRAP 11)             | 10 tests                                                         |
| 6   | Always write `quiet_hours_start`                 | `UpdatePreferences_PartialBody…` + `…_ExplicitNullQuietHours…`   |
| 7   | Wire `unread-count` to the GRANT gate            | **the positive control only** — every "denied" test stayed green |

Each mutation was compiled before being tested (a mutation that does not compile is not a mutation), and the
tree was committed clean before the first one so no revert could wipe uncommitted work.

## Step 5 is UNRUNNABLE BY ANYONE, and for a new reason

No notification surface exists in `scripts/parity/surfaces.ts`, and unlike every prior unregistered surface it
**cannot be registered by adding a grant fixture**. The harness compares **by role** against `expectedByRole`,
but nine of eleven procedures consult no grant at all. Registration needs **per-role notification ROWS** — each
probe role owning its own, so a 200 means "saw my own" rather than "saw everyone" — which is a different and
larger job than `seedXGrants`. With an empty fixture every role would compare empty-vs-empty: the vacuous-PASS
shape.

Prerequisites for step 5:

1. Per-role `notifications` rows in the parity seed (not grants).
2. A `notification:create` grant fixture for the two grant-gated routes (this half _is_ the usual `seedXGrants`
   work — copy scopes from `packages/db/prisma/seed-access-matrix.ts`, never invent them).
3. Write-surface fixtures for `create`/`bulkCreate` whose rows no read expectation depends on.
4. **Divergence 1 resolved** — otherwise the two stacks legitimately disagree and the run is uninterpretable.
5. The code must be **DEPLOYED with the flag on** — `cli.ts` preflight probes the live surface, and the C# API
   does not auto-deploy.

## Step 6 preconditions

`notifications` has writers outside this router and outside any flag: `packages/api/src/lib/notify.ts`
(`createMany`, called from `routers/platform/organizations.ts:220` and `:300`) and the C#
`PlatformOrganizationsWriteDbContext`/`CreateDbContext`. The write flag is the one-active-writer control for the
**router path only** — an unqualified claim would be false. That coexistence is why both tables sit in
`efcoreStranglerWrite` rather than `efcore`.
