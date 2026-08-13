# Phase-5 Slice 22 — platform invitations READ (#75)

Ports the **three read procedures** of `packages/api/src/routers/platform/invitations.ts` to C#, dark
behind `Platform:PlatformInvitationsReadEnabled`. Steps 1–4 of the strangler recipe; steps 5–7 are
Federico's.

`GET /platform/invitations/kpis` · `GET /platform/invitations` · `GET /platform/invitations/export`

## #75 is TEN procedures and this slice is THREE. The other seven, and why.

The issue title says "10 procedures, 421 LOC". The file is **463 LOC** (`wc -l` on this branch; it was 456 at `origin/main` — the CSV fix below adds 7), and the ten procedures
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
grep -rnE "interface I.*Email|class .*EmailSender|SendEmailAsync" services/Tims.Platform/src --include="*.cs"  # no output
# NOTE the -E. Without it `|` is a LITERAL and the command can never match, whatever the tree contains —
# an adversarial review caught that this evidence command was vacuous as first written. The CONCLUSION
# held on re-run: no match with -E, and no AWS/mail/SMTP/SendGrid/MailKit PackageReference in any csproj.
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

1. **`bulkInviteUsers` sends no email at all.** There are exactly three `await sendEmail` call sites
   **in `invitations.ts`** (repo-wide there are five — `platform/invoices.ts` has two) and
   none is in `bulkInviteUsers`, which nonetheless writes `status: sent` for up to 200 rows. Every one of
   those invitees is recorded as invited and never contacted.
2. **The CSV export had no formula-injection defence.** FIXED in both stacks on 2026-08-12 — see
   divergence (1) below for what changed, and for the SIX other hand-rolled CSV builders that are still
   outstanding (four platform routers plus two frontend ones — an adversarial review found the two FE
   builders, which the "tracks #39's service-layer bypass" framing had missed entirely).

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
   **eight** route registrations: **six** `PlatformOrganizations*` endpoints that are not unauthenticated
   at all (they gate inside the handler), plus `AlertMetricsEndpoints` and `BillingWebhookEndpoints`.
   That six-versus-two split is trap (1) again, seen from the rate limiter's side: counting
   `.AllowAnonymous()` does NOT count public endpoints. (This line said **nine** until an adversarial
   review counted them; the ninth grep hit is a doc comment in `AlertMetrics/CronCallerGate.cs`. Note
   the arithmetic was self-refuting — 6 + 2 is not 9 — and it appeared in the very commit that existed
   to correct a different miscounted superlative. Count the set, then check the sum.)

   Left alone the middleware is a denylist and does the right thing automatically: `CategoryFor` keyed on
   the trusted IP for an anonymous caller, deriving the same categories TS derives from `path`+`type`, so
   it is parity by default. The mapping is ordered and this line used to state only its last step:
   `auth.` prefix → Auth, then `portal.applytovacancy` → Ai, then the AI keyword list → Ai, then an
   `export` substring → **Export**, and only then the GET → `query` (100/min) / POST → `mutation`
   (30/min) default. Worth knowing for THIS slice too: `/platform/invitations/export` normalises to
   `platform.invitations.export` and therefore lands in the **Export** tier — `RateLimits.cs` gives that
   5 tokens per 300_000 ms window, i.e. **5 requests / 5 minutes**, the strictest tier there is and an
   exact match for the TS `export: { requests: 5, window: '5m' }`. (An adversarial review read the
   300_000 as a rate and reported the export as effectively unthrottled; it is the WINDOW in
   milliseconds. Verified in `RateLimits.cs` — `Tokens()` and `WindowMs()` are separate switches.)

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
| `CsvCell.Row` → raw `string.Join` (C#-only un-hardening)        | FAIL — 11 unit cases, plus the integration byte-for-byte pin        |
| Bind `page`/`limit` as `int` again (binding precedes the gate)  | FAIL — 3 `OrdinaryOrgUser_WithInvalidInput_Is403_Not400` cases      |
| Revert the TS CSV hunk only (both stacks must move together)    | FAIL — 2 `exportInvitationsCsv is wired through…` source guards     |

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

## Tier-3 adversarial panel — what it found, and what it got wrong

Cross-model verification (`scripts/verification/codex-review.sh`) exited **2** for the 26th consecutive
time — Codex quota, now reading "Sep 9th, 2026", not the `2026-08-15` still written in
`.claude/rules/verification.md`. Per the rule, exit 2 is not a pass, so the declared tier-3 substitute ran:
three independent same-model lenses (security/tenant-isolation, claim auditor, coverage), each prompted to
**refute** and to re-read the source rather than trust this document.

It was worth running. Two findings were real defects in code, not prose:

1. **Binding ran before the gate.** `page`/`limit` were `int`, and Minimal-API binding precedes the handler
   delegate — so `?page=abc` from an ordinary org user returned **400 where it should return 403**, leaking
   that the endpoint exists and takes an integer `page`. The class docblock claimed the opposite invariant.
   Proved by running the real host. Fixed by binding both as `string?` and parsing after the gate; the
   existing guard test used `?limit=9999`, which BINDS, so it read as covering this and did not.
2. **The TS half of the CSV fix had no test at all.** The C# side pinned the hardened bytes; a `git revert`
   of the TS hunk left vitest, dotnet and tsc green while reopening CWE-1236 on the live path. Closed with a
   shared golden (`contracts/invitation-fixtures/`) plus **source guards** on the router — the golden alone
   only exercises `csvRow`, which is exactly the weakness that let this ship.

Plus `Guid.Parse` → `TryParse` outside the fail-soft boundary, the audit write bound to `RequestAborted`
against the #181 precedent, and untested pagination-multiplier / combined-filter / empty-result paths.

**Claims it falsified in this document and the commit messages** — the highest-value class, again:
`organizations` is in `efcoreStranglerWrite[]` not `efcoreReadOnly[]` (asserted in four places);
`.AllowAnonymous()` is on **8** registrations not 9 (in the very commit written to correct a different
miscount, and self-refuting — 6 + 2 ≠ 9); "unlike every other `efcoreReadOnly` context" is wrong (at least
four are); the mutation table said 7 failures where the re-run gives 11; `seed.ts` seeds the platform owner
**with** an org, so the "normally org-less" rationale was inverted; the `#217` evidence grep lacked `-E` and
could never have matched (**the conclusion survived a corrected re-run; the cited command did not**).

**And one the panel itself got wrong, kept as the standing lesson.** It reported the export as landing in a
300,000-per-minute rate-limit tier, i.e. effectively unthrottled. `RateLimits.cs` has two separate switches:
`Tokens()` gives Export **5**, `WindowMs()` gives Export **300_000 ms**. It is 5 requests / 5 minutes — the
strictest tier, and an exact match for TS. **Agent output is evidence, not verdict; the same
read-it-yourself rule that caught these claims applies to the review that caught them.**

## Ownership ledger — nothing moved

All three mapped tables were **already** registered, so nothing moved — but not all three in the same
array, and an earlier version of this line said they were. **`platform_invitations` and `users` are in
`efcoreReadOnly[]`** (32 entries); **`organizations` is in `efcoreStranglerWrite[]`** (13 entries), where
slice 21 put it when C# took write ownership. `platform_invitations` arrived in slice 19, which mapped it
for a three-column COUNT. The conclusion is unchanged — this slice adds no writer and moves nothing —
but "all three were already in `efcoreReadOnly[]`" was simply false, and it was asserted in four places. So unlike slice 19 this slice was not caught by the ownership check on its first full-suite run —
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
payload diff. Among the checks that cover THIS surface it is the only automated one capable of catching
the two defect classes that cost #211/#216 nine divergences — a mis-serialised `DateTime` and a dropped
or renamed key. (Scoped deliberately: repo-wide it is not unique. `surfaces.ts` carries 16 `tsProcedure`
refs across five surfaces, and every one of those yields a real payload diff.)

No grant fixture and no seed change was needed: `PlatformOwnerGate` decides on `users.is_platform_owner`
_before_ any permission lookup, so `org_admin` is refused holding no `role_permissions` row.

**Not yet run.** The flag is dark, so `verify invitation` cannot pass against production until Federico
flips it; and `scripts/parity/.env` does not exist in the agent environment. Everything in this document is
**derived from source, never observed at run time** — the same standing caveat #216 carries, and the reason
#211 is still open.

⚠️ **`verify invitation` egresses cross-tenant PII** to the machine running it: the list returns up to 20
invitations across every org and the export returns **every** row with no cap, each carrying an invitee
email address. Recorded in the registry beside the entry.

## Known gaps NOT closed here, stated rather than implied absent

All four are faithful ports of live TS behaviour, so closing any of them means changing both stacks — the
same shape as the CSV fix, and the same reason it needs a deliberate decision rather than a drive-by.

1. **The export is uncapped, in both stacks.** No `take`, no cap, no `truncated` flag
   (`invitations.ts:293-306`; `PlatformInvitationsReadRepository.cs:135-155`). One platform-owner call
   returns every invitee email address across every tenant, and the whole set is materialised into a `List`
   and then a `StringBuilder`. The sibling `audit.service.ts` enforces `EXPORT_LIMIT` and reports
   `truncated` — that is the pattern to adopt, in both stacks at once.
2. **That export can leave NO audit trail.** `logPlatformExport` resolve-or-skips, and `platformProcedure`
   is built from `protectedProcedure`, not `auditedProcedure` — so for an org-less owner TS writes no row
   either, and C#'s `SecurityDenialAuditMiddleware` records only denials. The highest-privilege, widest-
   scope, uncapped read on the platform is the one that can go unlogged.
3. **`IsValidType`/`IsValidStatus` are available to callers, not enforced by the layer that owns the
   invariant.** `EF.Constant` inlines its value as a SQL literal, and the repository's safety comment rests
   on validation that happens in the endpoint. The panel could not construct a reaching path (the three
   handlers are the only production callers, and `EF.Constant` escapes anyway — a hostile value comes back
   as `22P02 invalid input value for enum`, one escaped literal, not injected SQL), so this is
   defence-in-depth, not a live hole. Re-checking inside `ListAsync`/`ExportAsync`, or making the query
   records validate in their constructors, would make the guarantee structural.
4. **`StaffGateResult` is a struct whose `default` reads as "authorized, no context".** `Failure == null`
   is treated as allow by every call site including this slice's three. Only `Ok`/`Fail` are constructed
   today so it is unreachable, but the fail-open shape lives in shared code. Pre-existing; noted because
   this slice depends on it.

## Verification

| Check                                           | Result                                                         |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `pnpm --filter @tims/api exec tsc --noEmit`     | pass                                                           |
| `cd apps/web && npx tsc --noEmit`               | pass                                                           |
| `npx vitest run`                                | pass — see the PR body for the anchor                          |
| `dotnet test` (unit + integration)              | pass — 44 new unit, 71 new integration                         |
| `dotnet build -c Release` → `contracts/openapi` | regenerated; **131 insertions, 0 deletions** (purely additive) |
| gitleaks                                        | clean                                                          |
| Cross-model verification                        | ⚠️ **NOT RUN** — Codex quota-blocked (see the PR body)         |

The OpenAPI regeneration is TRAP 2: routes map under `isOpenApiDocGeneration` even when the flag is false,
so the contract goes stale the moment the slice lands and only a `-c Release` build regenerates it.
`dotnet test` does not catch it.
