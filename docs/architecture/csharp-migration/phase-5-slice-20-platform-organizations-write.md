# Phase-5 Slice 20 — platform organizations WRITE (#76)

**Status:** steps 1–4 done, shipping DARK behind `Platform:PlatformOrganizationsWriteEnabled`.
Steps 5 (verify in prod) and 6 (flip ownership) are Federico-gated and NOT in this slice.

Ports two of the three WRITE procedures of `packages/api/src/routers/platform/organizations.ts`:
`updateOrganization` (`:171-210`) and `suspendOrganization` (`:212-241`).

## Why `createOrganization` is not here

It is a 7-table provisioning transaction — `organizations` + `companies` + `business_units` + `teams` +
`org_entitlements` + `roles` + `subscriptions` — wrapped around `provisionOrgDefaults` and
`provisionOrgEntitlements`, the shared `org-provisioning` service that **#75 also imports**. Whichever
slice lands first defines that service's C# shape, so it gets its own slice (21) rather than being
smuggled into this one. **#75 depends on slice 21, not on slice 20.**

Keeping this slice to single-row updates is also what makes the fail-closed audit reviewable: the whole
argument below is about one UPDATE and one INSERT sharing one transaction.

## The deliberate divergence: the audit write is FAIL-CLOSED

The TS swallows its audit failure:

```ts
await db.auditLog.create({ … }).catch(() => {});
```

Federico decided on #76 that the C# port does not reproduce that. If the audit write fails, the
operation fails. This is a **divergence, not a bug fix** — a scenario where TS returns 200 with no audit
row returns an error here — so it is recorded rather than left to be discovered at step 5.

**The non-obvious consequence, and the reason this slice is shaped the way it is:** throwing _after_ the
UPDATE commits changes nothing. The organization is already modified, and unaudited — which is exactly
the state the decision exists to forbid. So the audit INSERT and the org UPDATE must share **one
transaction**, which means **one `DbContext` must map both `organizations` and `audit_logs`**.
`AuditLogDbContext` maps only `audit_logs`, so reusing it would have put them in two transactions and
silently given up the guarantee while looking like reuse. `PlatformOrganizationsWriteDbContext` maps
both; the audit **column map** is still shared, extracted to
`AuditLogModelConfiguration.ConfigureAuditLogs` so the two contexts cannot drift.

### Mutation-proved, both directions

`PlatformOrganizationsWriteRepositoryTests` runs against a real Postgres with a second database that has
no `audit_logs` table — a deterministic write failure with no error injection, the same technique
`AuditWriterFixture` already uses. `UpdateAsync_fails_closed…` and `SuspendAsync_fails_closed…` assert
the organization row is **byte-for-byte unchanged** after the throw, and
`The_control_for_the_mutation_proof_commits_on_the_healthy_database` proves the same call does commit
when the table exists — without that control, both would also pass if the repository wrote nothing at
all.

The tripwires were verified to bite: inserting `await scope.CommitAsync(...)` before the audit row (the
non-transactional shape) turns each of them RED, then reverted.

## `notify` is asymmetric with the audit, on purpose

`notify()` (`lib/notify.ts:16-41`) selects every user with `is_platform_owner = true` and inserts one
`notifications` row each. Here it runs **outside** the transaction and **unscoped**:

- **Outside**, because a notification is a side-effect of a suspension that already happened. Rolling
  back a completed suspension because a fan-out insert failed is a worse outcome than a missing
  notification. The audit row is evidence the action occurred; the notification is not.
- **Unscoped**, because platform owners belong to their own organizations — the lookup is cross-org by
  construction and cannot run inside the suspended org's `TenantScope`. The TS side is identical
  (unscoped `db`).

**Correction to the executable spec on #76**, which called `notify` "best-effort in TS": it is not.
`organizations.ts:220` awaits it with no `.catch`, so a notify failure propagates and fails the request
(after the update has already committed). This port reproduces that — exceptions propagate — rather than
adding a swallow that TS does not have. Only the audit divergence was authorized; inventing a second one
would make step 5 harder to read, not easier.

## Unlike slice 19, these writes DO run under `TenantScope`

The slice-19 reader is deliberately unscoped: a platform-owner read is cross-org, so there is no single
org to scope to and `PlatformOwnerGate` is the entire boundary. A write is different — the target
organization id is known, so RLS can stay engaged rather than resting on the production role being
BYPASSRLS, which the prod-roles reference is explicit is the wrong side of the tenancy invariant.

Both production policies pass under it: `organizations` scopes by its **own** id
(`id = current_org_id`, `20260604100000_enable_rls_tenant_isolation:320`) and `audit_logs` by
`organization_id`. The integration fixture applies those exact predicates with `app_tenant` as
NOLOGIN/NOBYPASSRLS, so this is measured rather than asserted.

## Parity notes — where the TS is reproduced rather than improved

| Behaviour                                                                 | Disposition                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absent field ≠ null                                                       | Every input field is `.optional()`, which **rejects** an explicit null. Omitting `name` must not clear it. Expressed as `COALESCE({param}, column)`, so no input can null a column.                                                      |
| `settings` REPLACES rather than merges                                    | Prisma overwrites a `Json` column, so `settings: { locale }` drops an existing `timezone`. Destructive and surprising — reproduced exactly. Narrowing it during a port makes a step-5 diff unreadable.                                   |
| `changes` is a jsonb **string scalar**, not an object                     | See below. This is the highest-risk parity detail in the slice.                                                                                                                                                                          |
| `suspendOrganization` writes no `changes` at all                          | The direction lives in the action (`org_suspended` / `org_activated`), not a payload.                                                                                                                                                    |
| An unknown organization is **404**, not the TS 500                        | Prisma's `update()` throws P2025, which tRPC surfaces as INTERNAL_SERVER_ERROR — an accident of the ORM, not a contract. Same precedent as `SuccessionWriteEndpoints` mapping a unique violation to 409. Recorded as a small divergence. |
| Ordering: TS is update → notify → audit; here it is update+audit → notify | Forced by making the audit transactional. Nothing observable depends on the order of two independent inserts.                                                                                                                            |
| `"Organizacion suspendida: …"` keeps the missing accent                   | It is what the TS writes. Correcting the spelling would be a silent content change in a user-visible string.                                                                                                                             |

### `audit_logs.changes` — measured, not assumed

`changes` is a Prisma `Json?` field and the TS hands it `JSON.stringify(rest)` — a JS **string**. So the
stored jsonb is a **string scalar** whose content is the JSON text, not the object it spells out.
Measured against Postgres 16 through Prisma 6:

| Written as                     | `jsonb_typeof` | stored                                 |
| ------------------------------ | -------------- | -------------------------------------- |
| `JSON.stringify({name:'N',…})` | `string`       | `"{\"name\":\"N\",\"isActive\":true}"` |
| the object itself              | `object`       | `{"name": "N", "isActive": true}`      |

jsonb re-orders and re-spaces object keys; it preserves a string scalar **verbatim**. So key order,
spacing and escaping are all part of the stored value:

- **Key order is Zod's**, not the caller's. `ZodObject` rebuilds the parsed object by iterating its own
  `shape`, so the order is always `name, plan, isActive, settings` (and `locale, timezone, currency`
  inside `settings`) whatever order the client sent. Verified by parsing
  `{"settings":{"currency":…,"locale":…},"isActive":…}` against the real schema.
- **Escaping must match `JSON.stringify`.** The .NET default encoder escapes `&`, `<`, `+` and every
  non-ASCII character as `\uXXXX`. Organization names here are Spanish, so the default encoder would make
  almost every audit row differ from the TS bytes. `JavaScriptEncoder.UnsafeRelaxedJsonEscaping` is used,
  pinned by unit tests.

## Defect found in slice 19 and fixed here

`PlatformOrganizationsReadDbContext` maps four **native Postgres enum** columns (`organizations.plan`,
`subscriptions.plan`/`status`, `invoices.status`, `platform_invitations.status`) onto C# `string`
properties, but shipped registered on a plain connection string. EFCore.PG cannot materialise an unmapped
enum into a string — it throws
`InvalidCastException: Reading as 'System.String' is not supported for fields having DataTypeName '-.-'`
on the first row. **All three slice-19 endpoints would have 500'd the moment the flag was flipped**, with
every unit test green, because the fault only exists against a real Postgres.

Fixed by `PlatformOrganizationsDataSource` (`EnableUnmappedTypes`, isolated behind a holder so it cannot
bleed into other contexts — the pattern billing/eval360/DEI/external-vendor already use), wired to both
the read and write contexts. Guarded by `PlatformOrganizationsReadDbContextTests`, which asserts the read
works on the data source AND still throws on a plain connection string, plus a third test pinning that
the column really is a native enum so the pair cannot pass vacuously.

## Ownership ledger

`organizations` moves `efcoreReadOnly[]` → `efcoreStranglerWrite[]`; `notifications` is added to
`efcoreAppendOnly[]`. `audit_logs` was already append-only; `users` stays read-only. Nothing is
transferred — Prisma still owns every DDL and the TS procedures are still the active writers. One-active-
writer rests entirely on `Platform:PlatformOrganizationsWriteEnabled` defaulting false.

**Governance gap found while doing this, worth its own issue:** `scripts/table-ownership.mjs` only greps
`.ToTable("…")`, so a **raw-SQL** writer is invisible to it. `BillingWebhookRepository.cs:130` has been
`UPDATE`ing `organizations.plan` since the billing-webhook slice while the ledger listed the table as
read-only, and nothing flagged it. That writer is itself flag-gated, so it is not a live one-writer
violation — but the ledger was describing the repo inaccurately and the check could not tell.

## Verification

- `dotnet test` — 24 new unit tests (input bounds, the `changes` bytes, the notify branch) and 12 new
  integration tests against a real Postgres, including the two mutation proofs and their control.
- `dotnet build Tims.Platform.slnx -c Release` to regenerate `contracts/openapi/Tims.Api.json` — a DARK
  endpoint still changes the contract, and `dotnet test` does not catch it.
- `node scripts/table-ownership.mjs`, both `tsc --noEmit` runs, full `vitest`, gitleaks.
- Cross-model verification: **NOT RUN** (check 15 exit 2 — Codex quota-blocked to 2026-08-15,
  `OMNIROUTE_MODEL` unset so tier 2 correctly refuses). A tier-3 same-model panel ran instead. Per
  `.claude/rules/verification.md` this is **not** cross-model verified.
