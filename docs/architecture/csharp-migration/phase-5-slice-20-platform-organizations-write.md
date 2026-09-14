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

> **#76's decision comment required this to be "pinned by a parity fixture". That obligation is NOT
> discharged here, and an earlier draft of this doc claimed otherwise.** The surface has no
> `scripts/parity/surfaces.ts` entry at all (#195 — at the time, the registry covered 4 of ~15 C# domains;
> #203/#204 and the 2026-08-11 access-review/audit-log restoration took it to 8), so there was
> nothing to hang a fixture on and nothing will diff C# against TS at step 5. What _does_ pin the
> behaviour is the mutation proof below, against a real Postgres. Closing the parity-fixture gap needs
> #195 first.

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
non-transactional shape) turns each of them RED, then reverted. **The control goes red under that mutation
too** — an early commit leaves the transaction completed, so the following `SaveChanges` throws for
everyone. Its job is therefore narrower than "stays green under mutation": it proves the two fail-closed
tests are non-vacuous in the _unmutated_ code, i.e. that this call shape does commit when `audit_logs`
exists.

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
`organizations.ts:299` awaits it with no `.catch`, so a notify failure propagates and fails the request
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

**That covers the two tables inside the transaction, and no more.** The notification fan-out is unscoped,
and production has FORCE RLS with a `tenant_isolation` policy on **both** `users` and `notifications`
(`…_enable_rls_tenant_isolation:199-202`). With no org GUC set the owner SELECT returns zero rows and the
INSERT is refused by the `WITH CHECK`, so that one call rests entirely on the app role being BYPASSRLS —
the dependency the rest of this slice exists to reduce. The failure mode if that role ever changes is
silent: zero owners found, early return, suspensions stop notifying, no error. Not covered either way —
the fixture's login role is a superuser, so adding the policies there would not close the gap; closing it
needs a NOBYPASSRLS login role for that one call.

## Parity notes — where the TS is reproduced rather than improved

| Behaviour                                                                 | Disposition                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absent field ≠ null                                                       | Every input field is `.optional()`, which **rejects** an explicit null. Omitting `name` must not clear it. Expressed as `COALESCE({param}, column)`, so no input can null a column.                                                                  |
| `settings` REPLACES rather than merges                                    | Prisma overwrites a `Json` column, so `settings: { locale }` drops an existing `timezone`. Destructive and surprising — reproduced exactly. Narrowing it during a port makes a step-5 diff unreadable.                                               |
| `changes` is a jsonb **string scalar**, not an object                     | See below. This is the highest-risk parity detail in the slice.                                                                                                                                                                                      |
| `suspendOrganization` writes no `changes` at all                          | The direction lives in the action (`org_suspended` / `org_activated`), not a payload.                                                                                                                                                                |
| An unknown organization is **404**, not the TS 500                        | Prisma's `update()` throws P2025, which tRPC surfaces as INTERNAL_SERVER_ERROR — an accident of the ORM, not a contract. Same precedent as `SuccessionWriteEndpoints` mapping a unique violation to 409. Recorded as a small divergence.             |
| Ordering: TS is update → notify → audit; here it is update+audit → notify | Forced by making the audit transactional. **Observable on one path:** when `notify` throws, TS never reaches its audit write and leaves no audit row, while this port has already committed one. Both fail the request. A second, benign divergence. |
| `"Organizacion suspendida: …"` keeps the missing accent                   | It is what the TS writes. Correcting the spelling would be a silent content change in a user-visible string.                                                                                                                                         |

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

`PlatformOrganizationsReadDbContext` maps **five columns across four native Postgres enum types**
(`organizations.plan` and `subscriptions.plan` → `OrgPlan`; `subscriptions.status` → `SubscriptionStatus`;
`invoices.status` → `InvoiceStatus`; `platform_invitations.status` → `InvitationStatus`) onto C# `string`
properties, but shipped registered on a plain connection string. EFCore.PG cannot materialise an unmapped
enum into a string — it throws
`InvalidCastException: Reading as 'System.String' is not supported for fields having DataTypeName '-.-'`
the first time a row is materialised.

**`listOrganizations` and `getOrganization` would have thrown the moment the flag was flipped**, with every
unit test green, because the fault only exists against a real Postgres. `getOrganizationKpis` would not:
it is COUNT-only (`PlatformOrganizationsReadRepository.GetKpisAsync` issues five `CountAsync` calls and
materialises nothing). Whether its `status == 'trialing'` predicate against an enum column also fails is a
different failure mode and is untested either way — so "all three endpoints", which an earlier draft of
this doc said, is an overstatement.

Fixed by `PlatformOrganizationsDataSource` (`EnableUnmappedTypes`, isolated behind a holder so it cannot
bleed into other contexts — the pattern billing, evaluation360 and external-vendor already use; DEI solves
the same problem the other way, with `MapEnum<T>` onto real CLR enums, so it is not a precedent here),
wired to both the read and write contexts. Guarded by `PlatformOrganizationsReadDbContextTests`, which
asserts the read works on the data source AND still throws on a plain connection string, plus a third test
pinning that the column really is a native enum so the pair cannot pass vacuously.

**Coverage limit, stated:** that guard exercises `organizations.plan` only. The other four columns, and
every enum-in-`WHERE` path, remain uncovered.

## Ownership ledger

`organizations` moves `efcoreReadOnly[]` → `efcoreStranglerWrite[]`; `notifications` is added to
`efcoreAppendOnly[]`. `audit_logs` was already append-only; `users` stays read-only. Nothing is
transferred — Prisma still owns every DDL and the TS procedures are still the active writers. One-active-
writer rests entirely on `Platform:PlatformOrganizationsWriteEnabled` defaulting false.

**Governance gap found while doing this, filed as #199:** `scripts/table-ownership.mjs` only greps
`.ToTable("…")`, so a **raw-SQL** writer is invisible to it. `BillingWebhookRepository.cs:130` has been
`UPDATE`ing `organizations.plan` since the billing-webhook slice while the ledger listed the table as
read-only, and nothing flagged it. That writer is itself flag-gated, so it is not a live one-writer
violation — but the ledger was describing the repo inaccurately and the check could not tell.

**A second control gap, filed as #200:** the SQL-injection scan (`ci.yml:119-120` and its mirror
`tests/security/sql-injection.test.ts:74`) is TypeScript-only, so `services/Tims.Platform/**/*.cs` is
unscanned. The C# sink is the worse of the two — `ExecuteSqlRaw($"…{x}…")` concatenates silently while the
safe `ExecuteSqlInterpolated` looks almost identical — and this slice adds hand-written SQL against
`organizations`. Nothing in this diff is injectable (every hole binds as an Npgsql parameter), but the
guardrail CLAUDE.md claims does not reach this stack.

**The two narrowings deliberately not done here are #201:** `settings` REPLACES rather than merges on a
partial update, and `getOrganization` over-fetches a whole `billing_profiles` row to read one field.

## Endpoint-layer coverage, and why it was nearly missing

The first draft of this slice shipped with no endpoint tests — the same gap slice 19 has. The tier-3 review
panel flagged it as the one thing to block on, and it was right: with the repository-level tests alone,
`PlatformOwnerGate.AuthorizeAsync` could be deleted from both handlers and every test would still pass,
because the fail-closed proof calls the repository directly. Nineteen other slices ship a
`*EndpointAuthTests`.

`PlatformOrganizationsWriteEndpointAuthTests` now boots `WebApplicationFactory<Program>` over the fixture
DB with a locally-minted JWKS and drives the real pipeline: platform-owner → 200, ordinary org-user → 403
(asserting the row is unchanged and no audit row was written, not just the status code), missing/tampered
JWT → 401, **flag at its default → 404**, unknown org → 404, an 11-case 400 matrix over the hand-written
body parser, and the auth-before-validation ordering.

Both new controls were mutation-proved: neutering the gate turns `OrdinaryOrgUser_is_403_on_both_writes`
and `AuthRunsBeforeValidation…` red; bypassing the flag guard turns `Routes_are_404…` red.

Two endpoint-layer behaviours the panel surfaced and this slice fixed rather than documented:

- **A duplicate-key body was a 500.** `JsonObject` materialises its dictionary on the first property read,
  not at parse, so `{"name":"a","name":"b"}` threw `ArgumentException` from inside the handler. It is now
  parsed eagerly and returns 400. TS is last-wins and returns 200, so this IS a divergence — a 400 on an
  ambiguous body is the safer of the two.
- **An absent body was a 400.** `updateOrganization({ id })` is a valid 200 in TS, and with `id` in the
  route the REST equivalent carries no body at all. An empty body is now read as `{}`.

## Verification

- `dotnet test` — 24 new unit tests (input bounds, the `changes` bytes, the notify branch) and 38 new
  integration tests against a real Postgres, including four mutation proofs (fail-closed update,
  fail-closed suspend, the gate, the dark flag).
- `dotnet build Tims.Platform.slnx -c Release` to regenerate `contracts/openapi/Tims.Api.json` — a DARK
  endpoint still changes the contract, and `dotnet test` does not catch it.
- `node scripts/table-ownership.mjs`, both `tsc --noEmit` runs, full `vitest`, gitleaks.
- Cross-model verification: **NOT RUN** (check 15 exit 2 — Codex quota-blocked to 2026-08-15,
  `OMNIROUTE_MODEL` unset so tier 2 correctly refuses). Per `.claude/rules/verification.md` this is
  **not** cross-model verified.
- The declared tier-3 substitute DID run: a 3-lens same-model adversarial panel (security/tenant-isolation,
  claim auditor, coverage), each prompted to refute and to re-read source rather than trust this document.
  It found the missing endpoint tests, the backwards OpenAPI schema, the duplicate-key 500, the absent-body
  divergence, and **nine false or overstated claims in this doc and the code comments** — including a
  "pinned by a parity fixture" that was an obligation restated as a fact, an "all three endpoints would
  have 500'd" that is two, a "four enum columns" that is five, and eight `file:line` citations off by one.
  All are corrected above; the claim-auditor lens again outperformed the security lens.

**A note on check 15's first run.** It exited **0** with "no changes vs `origin/main`" — because the work
was still uncommitted. That is a vacuous pass in exactly the shape `.claude/rules/verification.md` warns
about: the script is honest about having nothing to review, but a caller who reads only the exit code
would record a pass. Re-run after committing, it exits 2 as expected.
