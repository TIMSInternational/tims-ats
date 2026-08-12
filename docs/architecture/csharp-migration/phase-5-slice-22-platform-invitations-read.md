# Phase-5 Slice 22 — platform invitations READ (#75)

Ports the **three read procedures** of `packages/api/src/routers/platform/invitations.ts` to C#, dark
behind `Platform:PlatformInvitationsReadEnabled`. Steps 1–4 of the strangler recipe; steps 5–7 are
Federico's.

`GET /platform/invitations/kpis` · `GET /platform/invitations` · `GET /platform/invitations/export`

## #75 is TEN procedures and this slice is THREE. The other seven, and why.

The issue title says "10 procedures, 421 LOC". The file is **456 LOC** (`wc -l`), and the ten procedures
split into four groups that are four genuinely different problems. Splitting them is not scope
reduction — three of the seven **cannot be ported at all today**, for a reason the issue does not
mention.

| Group            | Procedures                                                        | Ported | Why not                                                        |
| ---------------- | ----------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| Reads            | `getInvitationKpis`, `listInvitations`, `exportInvitationsCsv`    | **3**  | — shipped here                                                 |
| Writes, no email | `revokeInvitation`, `bulkInviteUsers`                             | 0      | need their own one-active-writer flag, not a read flag         |
| Unauthenticated  | `getInvitationByToken`, `acceptInvitation`                        | 0      | NEW auth shape — own slice, own flag, own threat model (below) |
| Email-dependent  | `createOrgInvitation`, `createUserInvitation`, `resendInvitation` | 0      | **this service cannot send email at all**                      |

3 + 2 + 2 + 3 = 10.

### The email blocker is real, and it is measured rather than assumed

`services/Tims.Platform` has **no email capability of any kind**. Not a missing wrapper — a missing
dependency:

```bash
grep -rh "PackageReference" services/Tims.Platform/src/*/*.csproj | grep -iE "aws|mail|smtp|sendgrid|email"   # no output
grep -rn "interface I.*Email|class .*EmailSender|SendEmailAsync" services/Tims.Platform/src --include="*.cs"   # no output
```

Three procedures call `sendEmail` (`invitations.ts:156`, `:209`, `:242` — three call sites, confirmed by
`grep -c "await sendEmail"`). Porting them without email would produce endpoints that write the
invitation row, mark it `status: sent`, and silently never deliver anything — a failure invisible until
after a flip, at which point tenant onboarding stops working with no error anywhere.

The interface needed is small, because `sendEmail` is already **fail-soft and result-discarding**:
`packages/api/src/lib/ses.ts:37-43` catches everything and returns `false`, and all three call sites
ignore the return value. So the contract is "best-effort, never throws, never blocks the mutation" —
easy to reproduce once a sender exists. What it needs is an infrastructure decision that is not AI-doable:
an `AWSSDK.SimpleEmailV2` dependency, an SES IAM grant on the App Runner instance role, and the
`AWS_REGION` / `PLATFORM_EMAIL_FROM` configuration. Filed separately; **`#75` cannot close until it is
resolved.**

### Two TS defects found while characterizing, both filed, neither fixed here

1. **`bulkInviteUsers` sends no email at all.** There are exactly three `await sendEmail` call sites and
   none is in `bulkInviteUsers`, which nonetheless writes `status: sent` for up to 200 rows. Every one of
   those invitees is recorded as invited and never contacted.
2. **The CSV export had no formula-injection defence.** FIXED in both stacks on 2026-08-12 — see
   divergence (1) below for what changed and what is still outstanding in the four sibling exports.

## Threat characterization for the two `publicProcedure` endpoints (slice 23 groundwork)

This is the part of #75 with no precedent in this service: **every surface ported so far has been
authenticated.** Recorded now, while the TS is in front of us, so slice 23 starts from a written model.

**The credential is the token, and nothing else.** `token` defaults to `randomUUID()` (v4, ~122 bits) and
is `@unique`. Zod validates `z.string().uuid()`, so a malformed token is a 400 before any query. Brute
force is not a practical concern at that entropy; the practical concerns are all about handling.

| Property                  | Finding                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token in the URL          | The email links to `/accept-invitation?token=…`, so the credential lands in browser history, `Referer` headers and access logs. Pre-existing; **reproduce, do not fix, in a port**                                                           |
| PII exposed               | `getInvitationByToken` returns the invitee's **email address** to any token bearer. Deliberate (the accept page renders it), but it means a leaked token leaks an email                                                                      |
| A GET that WRITES         | `getInvitationByToken` is a `query` that UPDATEs `status → expired` when past `expiresAt`. So the "read" slice-23 endpoint needs a **write-capable** context                                                                                 |
| Not idempotent            | `acceptInvitation` answers 400 (`ya fue aceptada`) on a second call — a retried request after a dropped response is an error, not a no-op                                                                                                    |
| Race condition            | No transaction and no conditional UPDATE: two concurrent accepts both read `sent`, both pass the checks, both write `accepted`. Reproducing this faithfully is the default; a `WHERE status = 'sent'` guard would be a deliberate divergence |
| Acceptance grants nothing | It flips the status and returns `{accepted, organizationId, type}`. It creates **no user** and grants **no role** — account creation happens in the web auth callback. A port must not "helpfully" provision anything                        |
| No audit trail            | Neither procedure writes a security event. An unauthenticated state transition with no audit row; worth filing, out of scope for a port                                                                                                      |

### Two mapping traps slice 23 will hit, both concrete

1. **In this service a public endpoint and a platform-owner endpoint are SYNTACTICALLY IDENTICAL at the
   `Map*` call.** `PlatformOrganizationsReadEndpoints` maps every route `.AllowAnonymous()` and does auth
   _inside_ the handler via `PlatformOwnerGate`. So "unauthenticated by design" and "gate accidentally
   omitted" look the same in a diff. This slice deliberately uses **`.RequireAuthorization()`** on all
   three routes (the `AuditReadEndpoints` / `AccessReviewEndpoints` idiom) — framework-level auth _plus_
   the gate. That makes the contrast load-bearing: when slice 23 writes `.AllowAnonymous()`, it will mean
   something, and a reviewer can see it. Slice 23 should additionally add an explicit inventory test of
   intentionally-unauthenticated routes, since the compiler cannot express this.
2. **Do NOT copy the rate-limit exemption from the existing anonymous routes.** There are **two**
   genuinely-unauthenticated PRODUCT routes today — `POST /billing/webhooks/stripe` (authenticated by the
   Stripe signature) and `GET /internal/alert-metrics` (authenticated by a cron secret) — and **both** sit on
   `RateLimitMiddleware.ExemptExactPaths`, each for a documented reason: a shared-IP delivery pool, and a
   single nightly caller that would otherwise throttle itself partway through. Neither reason applies to a
   browser-facing token endpoint, and copying the precedent would strip the _only_ throttle in front of an
   unauthenticated surface.

   Stated precisely, because the loose version of this sentence was wrong when first written: that exempt
   list holds **seven exact paths and three prefixes** — the other five exact entries are infra and
   auth-probe routes (`/`, `/health`, `/ready`, `/whoami`, `/external-whoami`), plus the `/openapi`,
   `/require-permission` and `/require-org-scope` prefixes. Separately, `.AllowAnonymous()` appears on
   **nine** route registrations, of which **six** are `PlatformOrganizations*` endpoints that are not
   unauthenticated at all — they gate inside the handler. That six-versus-two split is trap (1) again, seen
   from the rate limiter's side: counting `.AllowAnonymous()` does NOT count public endpoints.

   Left alone the middleware is a denylist and does the right thing automatically: `CategoryFor` maps
   GET → `query` (100/min) and POST → `mutation` (30/min), keyed on the trusted IP for an anonymous caller —
   the same categories TS derives from `path`+`type`, so it is parity by default.

## Recorded divergences and deliberately reproduced defects

### (1) The CSV was hand-rolled and unhardened — FIXED IN BOTH STACKS, 2026-08-12

**Status: resolved.** The history is kept because it explains why the pinning tests exist and why they read
the way they do.

Until 2026-08-12 `exportInvitationsCsv` did **not** use `csvCell`/`csvRow` from `packages/shared/src/csv.ts`;
it hand-rolled the row and quoted exactly one field, `organizationName`. Two consequences:

- **No formula-injection defence (CWE-1236).** A leading `=`/`+`/`-`/`@` was emitted raw and executes when
  the file is opened in Excel or Sheets. Reachable: `organizationName` is validated by
  `z.string().min(2).max(100)` with no character restriction.
- **Only `organizationName` was quoted**, so a comma in `email`, `roleSlug`, `type` or `status` shifted every
  later column of that row.

The port **originally reproduced both**, because `CsvCell.Row` emits `"a@b.com","user",…` where TS emitted
`a@b.com,user,…` — byte-different on every row, i.e. a guaranteed parity FAIL that reads as "the port is
wrong" rather than "the port is deliberately better". The two tests that pinned the vulnerable output were
the forcing function, and they worked: the fix then landed in **both stacks in one commit** (Federico's
call). `invitations.ts` now imports `csvRow`; `PlatformInvitationsReadUseCase.BuildCsv` now calls
`CsvCell.Row`. The pinning assertions were **inverted in the same commit** and renamed
(`Export_CsvMatchesTsByteForByte_WithEveryCellHardened`, `BuildCsv_neutralises_a_formula_injection`), and a
new `BuildCsv_neutralises_every_formula_trigger_character` Theory covers `=`/`+`/`-`/`@` — the old test only
ever exercised `=`, so a partial hardening would have looked complete.

Three things worth knowing about the fix:

- **The header goes through the helper too**, matching `audit.service.ts`, the established precedent.
  `CsvHeader` is now `static readonly` derived from `CsvCell.Row` rather than a `const` literal, so it cannot
  drift from the escaping the data rows use — a header/row quoting mismatch is the obvious way to
  reintroduce a one-sided diff.
- **The `-` placeholders now emit as `'-`**, because `-` is itself one of `csvCell`'s trigger characters.
  This was **verified against the real TS module, not inferred** — `csvRow(['-'])` returns `"'-"`. Both
  stacks agree, so parity holds, but it is a visible change to the downloaded file.
- **No caller broke.** The only consumer is `apps/web/app/(admin)/platform/invitations/page.tsx`, which
  wraps the string in a `Blob` and triggers a download; nothing parses it.

**Not fixed here, and not claimed as safe:** the same omission appears in the other four platform exports —
`users.ts`, `invoices.ts`, `subscriptions.ts`, `ai-agents.ts` all build CSV inline with zero `csvCell`/
`csvRow` references. The helper is used only in the **service layer** (`audit.service.ts`,
`candidate-pool.service.ts`), so the defect tracks the service-layer bypass that issue #39 covers. Those four
are out of scope for this slice and some have their own parity fixtures that a change would move; they are
listed here so the omission is on the record rather than implied to be absent.

### (2) An inexpressible OFFSET answers with an empty page

Zod bounds `limit` at 50 but puts **no** upper bound on `page`, so TS accepts `page: 2_000_000_000` and
hands Prisma a `skip` of 10¹¹ — legal, because Postgres OFFSET is a bigint. EF Core's `Skip` takes an
`int` and would overflow to a negative argument and throw. The port returns an empty page with the true
`total` instead, which is the same answer Postgres gives for an OFFSET past the end. Exact unless the table
ever exceeds `int.MaxValue` rows. Pinned by `List_InexpressibleOffset_IsEmptyPageNot500`.

### (3) A missing `invitedBy` row yields empty strings where TS would yield `null`

Unreachable while the FK exists (`invited_by_id` is NOT NULL with Prisma's default `Restrict`), and written
that way so one corrupt row cannot 500 the whole console. Recorded rather than discovered.

### (4) Four KPI counts run sequentially where TS uses `Promise.all`

EF Core forbids concurrent operations on one `DbContext`. The results are identical — four independent
COUNTs — and neither stack wraps them in a snapshot transaction, so both can disagree with `total` under
concurrent writes. Parity, not a regression.

## NEW TRAP — a native enum column cannot be compared to a PARAMETER

**Found by this slice's own integration tests: both filter-bearing endpoints returned 500.** No prior slice
had ever filtered a native Postgres enum by a variable, so nothing in the repo covered it.

`type` and `status` are native enums (`public."InvitationType"`, `public."InvitationStatus"` — confirmed in
`packages/db/baseline/prod-public-schema.sql`). EF Core parameterises a captured variable, Npgsql types
that parameter `text`, and Postgres has no `"InvitationStatus" = text` operator. The fix is
**`EF.Constant(value)`**, which forces the literal form that Postgres coerces to the enum type.

Three things worth carrying forward:

- **`EnableUnmappedTypes` does not solve this.** That setting governs _reading_ an unmapped enum into a CLR
  string (TRAP 3). This is _binding_ a value into one. Both are needed, and this slice has both.
- **A KPI-only test suite would have called this surface healthy.** `GetKpisAsync` writes
  `i.Status == "pending"` — a literal in the expression tree — and works. The slice-19/20 data-source
  docblock predicted exactly this and left it open: _"whether its `status == 'trialing'` predicate against
  an enum column also fails is a DIFFERENT failure mode and is untested either way."_ It fails.
- **Declaring the store type does not help.** `HasColumnType("\"InvitationStatus\"")` was tried first and
  the 500 persisted.

Inlining is safe here only because both values are validated against a closed allowlist before the
repository is reached. `search` deliberately stays a parameter — it is free text, and `email` is plain
`text` so no cast is involved. Regression-pinned by the paired tests
`A_parameterised_enum_comparison_fails_which_is_why_the_repository_uses_EF_Constant` and
`An_EF_Constant_enum_comparison_succeeds`.

## Mutation results — RUN, not asserted

Each mutation was applied to the real tree, built, the suite run, and then reverted. The EF.Constant one
was not a mutation at all: it was the original code, and the tests caught it before the fix existed.

| Mutation                                                        | Result                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Delete `PlatformOwnerGate` from the `/kpis` handler **only**    | FAIL — `OrdinaryOrgUser_Is403(path: "/platform/invitations/kpis")`  |
| Replace the flag guard in `Program.cs` with `if (true)`         | FAIL — all three `Route_Is404_WhenFlagDefaultsOff` cases            |
| Remove `NodeIsoNullableDateTimeConverter` from `SentAt` only    | FAIL — `List_SerialisesDatesAsNodeIso`                              |
| Use the captured variable instead of `EF.Constant` (as written) | FAIL — `List_FiltersByTypeAndStatus`, `Export_AppliesFilters` (500) |
| Remove the export's audit call site                             | FAIL — `Export_ByOwnerWithAnOrg_WritesOneAuditRow`                  |

The last one needed two attempts, and the first attempt is worth recording. Mutating the resolve-or-skip
guard to `if (true)` produced **2 compiler errors** (unreachable code), so `dotnet test --no-build` ran the
PREVIOUS binary and reported all 54 tests passing — a green that meant nothing. Always read the build's
error count before believing a `--no-build` result; a mutation that does not compile is not a mutation.
Removing the call site instead compiles cleanly and fails the test.

That test exists because of the coverage lens: the first version of this slice tested only the SKIP branch.
`ISecurityEventWriter` is deliberately fail-soft, so a throwing `Guid.Parse`, a wrong `entity` string or
malformed metadata would all have shipped green — **fail-soft code needs a positive test precisely because
it cannot fail loudly.**

The first is why the deny assertion is a per-route `[Theory]` rather than one test for the surface: the
gate is copied into each handler, deleting it from **one** is the realistic mistake, and a
surface-level test passes through it. Note also that the 401 cases survive that mutation — they come from
`.RequireAuthorization()`, not the gate — so the gate's unique contribution is the **403**, and that is the
assertion that must exist per route.

## Ownership ledger — nothing moved

All three mapped tables (`platform_invitations`, `organizations`, `users`) were **already** in
`efcoreReadOnly[]`; `platform_invitations` arrived there in slice 19, which mapped it for a three-column
COUNT. So unlike slice 19 this slice was not caught by the ownership check on its first full-suite run —
registration was verified present rather than discovered missing. A rationale note is added anyway
(`platform_invitations_read_slice22`), because "already listed" and "listed for this reason" are different
records.

Prisma still owns the DDL and the TS procedures remain the single writers. **This can never become a full
flip on this domain's strength alone:** `apps/web/app/auth/callback/route.ts` and
`platform/organizations.ts` both write rows this table references.

## Parity — registered, with a real diff

Registered as `SURFACES['invitation']` in the **same PR that deploys the routes**, so the #195 gap does not
grow: the route-coverage guard would otherwise have demanded three allowlist entries, and an allowlist entry
is a documented _absence_ of a probe.

Unlike `audit-log`/`access-review` (C#-only, `[WEAK]`, because their TS was deleted), all three endpoints
carry a real `tsProcedure` — the TS side is the live path — so `verify invitation` produces an actual
payload diff. That makes it the only automated check capable of catching the two defect classes that cost
#211/#216 nine divergences: a mis-serialised `DateTime` and a dropped or renamed key.

No grant fixture and no seed change was needed: `PlatformOwnerGate` decides on `users.is_platform_owner`
_before_ any permission lookup, so `org_admin` is refused holding no `role_permissions` row.

**Not yet run.** The flag is dark, so `verify invitation` cannot pass against production until Federico
flips it; and `scripts/parity/.env` does not exist in the agent environment. Everything in this document is
**derived from source, never observed at run time** — the same standing caveat #216 carries, and the reason
#211 is still open.

⚠️ **`verify invitation` egresses cross-tenant PII** to the machine running it: the list returns up to 20
invitations across every org and the export returns **every** row with no cap, each carrying an invitee
email address. Recorded in the registry beside the entry.

## Verification

| Check                                           | Result                                                         |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `pnpm --filter @tims/api exec tsc --noEmit`     | pass                                                           |
| `cd apps/web && npx tsc --noEmit`               | pass                                                           |
| `npx vitest run`                                | pass — see the PR body for the anchor                          |
| `dotnet test` (unit + integration)              | pass — 37 new unit, 53 new integration                         |
| `dotnet build -c Release` → `contracts/openapi` | regenerated; **131 insertions, 0 deletions** (purely additive) |
| gitleaks                                        | clean                                                          |
| Cross-model verification                        | ⚠️ **NOT RUN** — Codex quota-blocked (see the PR body)         |

The OpenAPI regeneration is TRAP 2: routes map under `isOpenApiDocGeneration` even when the flag is false,
so the contract goes stale the moment the slice lands and only a `-c Release` build regenerates it.
`dotnet test` does not catch it.
