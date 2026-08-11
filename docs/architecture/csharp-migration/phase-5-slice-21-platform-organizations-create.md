# Phase-5 Slice 21 — platform organizations CREATE (#76)

**Status:** steps 1–4 done, shipping DARK behind `Platform:PlatformOrganizationsCreateEnabled`.
Steps 5 (verify in prod) and 6 (flip ownership) are Federico-gated and NOT in this slice — and step 6 is
**permanently unreachable** for these tables, see [Ownership ledger](#ownership-ledger).

Ports the last WRITE procedure of `packages/api/src/routers/platform/organizations.ts`:
`createOrganization` (`:104-169`), plus the shared `org-provisioning` service
(`packages/api/src/services/org-provisioning.ts`) it wraps.

> **This document was missing when the slice was first written.** Seven shipped code comments cited "the
> slice doc" as the record for divergences #1–#5 while no such file existed, and the ownership-ledger note
> carried a mutation-proof claim that had never been run. The adversarial panel caught both. Everything
> below is written from re-read source and re-run commands, not from the implementer's summary.

## What #75 gets from this slice, and what it does NOT

`platform/invitations.ts` (#75) is the **third** org-creation path in the codebase. Its transaction
(`invitations.ts:83-114`) needs five things:

| #   | TS statement                        | Ported here?                                                |
| --- | ----------------------------------- | ----------------------------------------------------------- |
| 1   | `organization.create` (`:84-91`)    | **No** — private to `PlatformOrganizationsCreateRepository` |
| 2   | `provisionOrgDefaults` (`:100`)     | Yes — `OrgProvisioningWriter.ProvisionDefaultsAsync`        |
| 3   | `provisionOrgEntitlements` (`:101`) | Yes — `OrgProvisioningWriter.ProvisionEntitlementsAsync`    |
| 4   | `role.create` (`:103-105`)          | Map only — `RoleWriteEntity` is shared; the write is not    |
| 5   | `subscription.create` (`:106-113`)  | **No** — private to the create repository                   |

So #75's dependency is **half satisfied**. The two raw INSERTs, `IsSlugConflict`, `AddAuditRow`,
`ToTimestampText` and `ToPostgresTimestamp` are `private` members of a `sealed` class in the
`PlatformOrganizations` namespace. #75 must either promote them into `Tims.Infrastructure.OrgProvisioning`
or re-derive them — and re-deriving means re-hitting both traps this slice paid for:

- **Native Postgres enums cannot be written through EF.** `organizations.plan`, `subscriptions.plan` and
  `subscriptions.status` are `OrgPlan`/`SubscriptionStatus`. `EnableUnmappedTypes` makes Npgsql **read** an
  unmapped enum as text; it cannot bind text **into** one. The fix is an explicit cast in raw SQL —
  `{plan}::"OrgPlan"` — and it is the only reason any raw SQL exists in this slice.
- **`Kind=Utc` cannot bind to `timestamp without time zone`.** The natural caller value is
  `TimeProvider.GetUtcNow().UtcDateTime`, whose `Kind` IS `Utc`, and Npgsql refuses that pairing outright.
  Every unit test stays green and the first EF INSERT 500s against a real Postgres. `ToPostgresTimestamp`
  normalises at the persistence boundary, and it lives in **both** the repository and the shared writer so
  #75 inherits it rather than rediscovering it.

## Recorded divergences from TS

Numbered, because five code comments refer to them by number.

### (1) The audit write is FAIL-CLOSED and inside the transaction

TS writes it **after** the transaction and swallows the failure (`organizations.ts:157-166`,
`.catch(() => {})`). Federico's decision on #76 is that the C# port does not reproduce that: if the audit
INSERT fails, the whole seven-table creation rolls back. Same decision already shipped for
update/suspend in slice 20.

This forces the shape of the whole slice: throwing _after_ seven tables commit leaves exactly the state
the decision forbids, so the audit INSERT must share the creation transaction, which means **one
`DbContext` must map all of them**. Every context in this service is registered with its own connection
(nothing shares a `DbConnection` + `Database.UseTransaction`), so reusing `AuditLogDbContext` would have
split the transaction and silently given up the guarantee _while looking like reuse_. The audit **column
map** is still shared (`AuditLogModelConfiguration`), as is the provisioning map
(`OrgProvisioningModelConfiguration`, which #75 will also use), so only the transaction boundary differs.

### (2) A duplicate slug is 409, not the TS 500

`organizations.ts` has no `P2002` handling, `trpc.ts:17-19`'s `errorFormatter` is a pass-through and there
is no Prisma-error interceptor, so a duplicate slug leaks raw Prisma text as an `INTERNAL_SERVER_ERROR`
that `create-org-modal.tsx:93-97` renders verbatim to the operator. House precedent for improving that is
`SuccessionWriteRepository`.

**Only the NAMED `organizations_slug_key` constraint is mapped.** A future unique index, or a primary-key
collision on the client-generated uuid, must propagate rather than be mislabeled — see
`A_unique_violation_that_is_not_the_slug_key_propagates_instead_of_becoming_SlugTaken`, which drives a
real `org_entitlements_organization_id_module_code_key` violation through the same path.

### (3) A notify failure leaves an audit row behind where TS leaves none

The **500-after-commit is parity, not a bug.** `organizations.ts:149` is `await notify({ … })` with no
`try` and no `.catch`, so a fan-out failure returns 500 to the operator after the transaction has
committed. Do **not** wrap it in try/catch at step 5.

What diverges is the wreckage. In TS the audit write is the statement _after_ `notify`, so a notify
failure leaves the organization committed with **no** `org_created` audit row. Here the audit row is
already committed — a direct consequence of divergence (1). Both stacks fail the request; they differ in
what is left behind. Asserted, not merely commented, by
`A_notify_failure_propagates_but_leaves_the_whole_creation_committed`.

### (4) `ProvisionEntitlementsAsync` returns a count where TS returns `void`

Added purely so the fail-OPEN zero-entitlement case is assertable instead of invisible. No caller checks
it. Zero behaviour change — **a reviewer may strike it.**

### (5) An added `CurrentTransaction is null` guard in `OrgProvisioningWriter`

An **ADDED GUARD, not a port of anything.** `Prisma.TransactionClient` is
`Omit<PrismaClient, ITXClientDenyList>`, so a full `PrismaClient` is structurally assignable — nothing
stops a TS caller passing the global `db` and getting non-atomic auto-commit writes. The atomicity
guarantee rests entirely on a prose comment (`org-provisioning.ts:8-10`). C# has the same hole and can
close it, and it changes no path the TS supports: every TS caller is inside `$transaction`, so it is
unreachable on every successful path. **A reviewer may strike it** — but note it is the guard that would
catch #75 calling `ProvisionDefaultsAsync` outside a transaction. Pinned by `OrgProvisioningWriterTests`.

## Mutation results — RUN, not asserted

Every mutation below was applied to source, rebuilt `-c Release`, run, and reverted from a byte-exact
backup on 2026-08-11. Reverting by inverse string-replace is unsafe for deletions (`""` matches
everywhere) and silently corrupted one file mid-run before the harness was switched to backups.

| #   | Mutation                                                               | Result                                       |
| --- | ---------------------------------------------------------------------- | -------------------------------------------- |
| M1  | move `scope.CommitAsync` before the audit `Add`                        | **RED** — 19/21 repository tests             |
| M2  | delete the `AddAuditRow` call                                          | **RED** — 6/21, incl. the audit-payload test |
| M3  | hard-code `'trial'::"OrgPlan"` in the `organizations` INSERT           | **RED** — exactly the 3 non-trial plan cases |
| M4  | `Limit = planModule.Limit` → `Limit = null`                            | **RED** — 2                                  |
| M5  | delete `.Where(pm => pm.PlanCode == BasePlanCode)`                     | **RED** — 4                                  |
| M6  | delete both `EnsureCallerTransaction(db)` call sites                   | **RED** — exactly the 2 guard tests          |
| M7  | drop `ConstraintName` from `IsSlugConflict`                            | **RED** — exactly the new negative test      |
| M8  | `null` for the impersonation secret in `PlatformOwnerGate`             | **GREEN** — see below                        |
| M8b | `null` for the impersonation secret in `PrincipalResolutionMiddleware` | **RED** — exactly the impersonation test     |

**Read M1 honestly.** The ledger originally claimed it "makes the fail-closed test go RED while the
healthy-DB anti-vacuity control stays green". Only the first half is true. The control goes red too, and
so do 17 other tests, because committing mid-scope invalidates the transaction the remaining statements
need. M1 is a **crude** mutation, not a surgical one — it proves the fail-closed test is not vacuous, and
nothing finer. M3–M7 are surgical, and each was added by this review because the mutation it kills
previously **passed the entire suite**.

**M8 is a finding, not a failure.** Nulling the impersonation secret inside `PlatformOwnerGate` changed
nothing, because `PrincipalResolutionMiddleware` stashes a resolved principal into `HttpContext.Items`
before any gate runs, so the gate's own `ResolvePrincipalAsync` fallback is unreachable on an
authenticated request. That fallback is shared by every staff gate in the service and is not introduced
here; M8b proves the impersonation denial is real by mutating the path that actually executes.

## Ownership ledger — this can NEVER become a flip

See `docs/architecture/table-ownership.md`, note `platform_organizations_create_slice21`, for the
authoritative record. The load-bearing conclusion:

Self-serve signup (`apps/web/app/auth/callback/route.ts`) creates all seven of these tables and is not in
scope for any C# slice, so the TS writer cannot be retired and `efcore[]` is unreachable for them.
**Count the set before repeating the mechanism:** the shared helpers write **four** tables — `companies`
(`:18-21`), `business_units` (`:23-26`), `teams` (`:28-31`), `org_entitlements` (`:57-65`). The other
three — `organizations`, `roles`, `subscriptions` — are written **inline** by every caller
(`route.ts:80,96,122`; `invitations.ts:84-91,103-105,106-113`). An earlier draft said "all seven through
the shared helpers", which is how #75 would end up shipping an org with no `super_admin` role and no
subscription.

`organizations` and `subscriptions` are written with raw `ExecuteSqlInterpolatedAsync` and are therefore
**invisible to `scripts/table-ownership.mjs`**, which greps `.ToTable("…")` only (#199). That is exactly
why every other table here goes through EF: it is the only thing that makes their ledger entries
enforced.

## Not registered in the parity harness — recorded here as the spec requires

**There is no `organization-create` surface in `scripts/parity/write-surfaces.ts`, and `seed.ts` is
untouched.** Build spec §8/D16 permits skipping registration only if the omission is recorded explicitly
in this document. It is recorded here, and tracked as **#208**.

The reason is not laziness. Every registered write is idempotent _by construction_ — slice 20 sends
`suspend: false` and renames only `name`, precisely so `verify-write organization` needs no teardown. A
create is the opposite: it INSERTs into seven tables **in production** on every run,
`organizations_slug_key` is global, and there is no teardown. That is Federico's call, not a
review-pass edit.

**The consequence, stated plainly:** flipping `Platform__PlatformOrganizationsCreateEnabled` at canary
means divergences (1), (2) and the `organizations.plan` write have never been diffed against TS on real
data. Note too that migration `20260708000000_add_entitlements` grants nothing to `app_tenant` explicitly
— it relies on `20260604100000`'s `ALTER DEFAULT PRIVILEGES` — so a missing SELECT on `plan_modules` would
surface as a 500 on first use: fail-closed, but undetected until then.

## Known coverage gaps, stated rather than papered over

- **The notification fan-out rides on the connecting role being BYPASSRLS.** `PlatformOwnerNotifier`
  selects `users WHERE is_platform_owner` and inserts into `notifications` with no `TenantScope` and no
  org filter. Production has FORCE RLS + `tenant_isolation` on both tables; this works only because the
  app connects as `postgres`. **The fixture cannot test it** — adding the policies would not help, because
  the fixture's login role is a superuser, so the notify tests pass identically whether or not the
  dependency holds. Closing it needs a NOBYPASSRLS login role for this one call. This slice does not
  narrow the gap; it **doubles the number of callers riding on it** (slice 20 was the first).
- **The fixture's RLS predicates are migration-declared, not prod-verified.** All seven citations are
  exact against the repo migrations. What is _not_ established is that live prod still matches them — this
  repo carries a standing finding that live RLS diverged from repo migrations on 67 production tables.
- **The `ats-base` module list is a hand-typed C# mirror** of `ATS_BASE_MODULES`
  (`seed-entitlements.ts:22-25`), typed out three times in the fixture. C# cannot import a TS constant, so
  a mirror is unavoidable — but it is _not_ the drift protection `signup-defaults.test.ts:3` has, which
  genuinely `import`s the exported list.
- **`plan` and the two email fields are under-specified in `contracts/openapi/Tims.Api.json`** — no
  `enum`, no `format: email`. `[AllowedValues]` and `[EmailAddress]` were both applied and both **ignored**
  by this project's OpenAPI emitter (verified by reading the regenerated file; `minLength`/`maxLength`/
  `pattern` did land). They were removed rather than left as no-ops that read like enforcement.
- **Neither email is length-bounded**, in either stack — `organizations.ts:109-110` is `.email()` with no
  `.max()`. A `.claude/rules/api-security.md` violation, ported as-is so the step-5 diff stays readable,
  and tracked as **#207**. Two tests pin the current acceptance so a silent tightening surfaces as a
  failure; **both invert when #207 lands.**
- **The `Guid.TryParse(gate.Context.UserId)` → 401 branch is unreachable** through the fixture and
  therefore untested. `PrincipalResolver` only ever yields a `users.id` uuid. Kept as an assertion.

## Verification

- `dotnet build Tims.Platform.slnx -c Release` — 0 warnings, 0 errors; regenerates
  `contracts/openapi/Tims.Api.json` (a DARK endpoint still changes the contract; `dotnet test` does not
  regenerate it and CI's "OpenAPI contract is up to date" check will fail the PR without it).
- `dotnet test Tims.Platform.slnx --no-build -c Release`
- `npx vitest run`, `pnpm --filter @tims/api exec tsc --noEmit`, `cd apps/web && npx tsc --noEmit`
- The mutation table above.
