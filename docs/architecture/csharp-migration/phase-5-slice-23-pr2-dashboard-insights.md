# Phase-5 Slice 23 — platform dashboard READ, the six remaining FX-free procedures (#81, PR 2 of 3)

Companion to `phase-5-slice-23-platform-dashboard-read.md`, which shipped the first three. Same issue,
same flag (`Platform:PlatformDashboardReadEnabled`), same gate, same read context — this PR completes the
FX-free tier.

Ported: `getAttentionItems`, `getMrrTrend`, `getMrrForecast`, `getCustomerHealth`,
`getUpsellOpportunities`, `search`. Dark endpoints under `/platform/dashboard/…`; TS remains the live
reader until Federico flips the flag at canary.

**One flag now covers NINE endpoints.** That is deliberate — they are one console page and one gate, and a
canary lighting three of nine panels would be harder to judge than one lighting the whole tier — but it
means the flip is all-or-nothing across nine reads, and the parity surface has to be green on all nine
before it is taken.

## What is left after this PR: FOUR of thirteen

| Procedure                                                  | Why not here                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `getDashboardKpis`, `getRevenueByCustomer`, `getChurnRisk` | Call `sumMoney` → live Frankfurter FX. Need the conversion machinery plus a live-rate parity strategy. **PR 3.**                      |
| `getAiCostAnomalies`                                       | Needs EF maps and NEW ledger entries for three genuinely unmapped tables: `ai_agent_org_configs`, `ai_agent_usage_logs`, `ai_agents`. |

The FX split was wrong in two earlier checkpoints (`getCustomerHealth` and `getChurnRisk` were swapped).
The `sumMoney` call sites are `dashboard.ts:98`, `:226`, `:233` and `dashboard-churn.ts:55` — counted, not
recalled. `getCustomerHealth` does no currency arithmetic at all and is in this PR.

## The landmine handled first: a SECOND ICU format, and a THIRD locale dependency

PR 1 pinned `toLocaleDateString('es', { month: 'short' })` because Node emits `"sept"` (four characters)
where a .NET `CultureInfo("es")` lookup does not. This PR found two more, both pinned in the same shared
golden (`contracts/dashboard-fixtures/dashboard-kernels.json`, read by both stacks):

1. **`{ month: 'short', year: '2-digit' }`** — the MRR pair's label. A _different_ format string, composed
   as short month + one ASCII space + the year modulo 100 **zero-padded** (`"ene 00"` for 2000, not
   `"ene 0"`). Pinned case-by-case, including the year-boundary cases.
2. **`Number.prototype.toLocaleString()` with NO locale argument** — `dashboard.helpers.ts` formats an
   overdue invoice's amount into a _description string_, so a locale-formatted number ships on the wire.
   ICU resolves the process default, which is `en-US` in the runtime this platform ships: `1234.5` renders
   `"1,234.5"`. Under an `es` default the same number is `"1234,5"` and every overdue-invoice description
   would differ between the stacks.

(2) is the sharpest of the three because it is **environmental, not versioned** — no golden can fully
defend it. The mitigation is to make it loud: the golden pins the en-US rule, and
`tests/parity/dashboard-fixtures.test.ts` additionally asserts that the runtime's resolved default locale
_is_ `en-US`, with a failure message saying what a change means. The parity registry carries it as
caveat 6, so a diff confined to description strings points at `LANG`/`LC_ALL` before it points at the port.

Two duplicated constants are pinned to the same golden for the same reason: `PLAN_PRICES` (six procedures
derive every MRR figure from it) and `SEARCH_PAGES`. Neither can drift from a runtime upgrade — only from
a human editing one stack — which is precisely the risk.

## Recorded divergences and reproduced defects

### (1) `getMrrTrend` counts FUTURE-dated subscriptions in every month — reproduced

The trend folds every aggregate row whose month is **not one of the twelve buckets** into a baseline
present in all twelve. For rows older than the window that is the intent. But `!bucketSet.has(month)` is a
set-membership test, not an ordering test, so a subscription with a **future** `created_at` (clock skew, a
backdated import, a seeded fixture) also fails it and is likewise added to all twelve months — including
months that precede its own creation.

That is a defect in the TS procedure. It is ported as written: a C# side that "correctly" excluded future
rows would diverge from production on exactly the data that triggers it, and the fix belongs in the TS
procedure, not smuggled in through a port. Pinned by
`Trend_ALSO_folds_a_FUTURE_dated_row_into_the_baseline_which_is_a_TS_defect_reproduced`.

`getMrrForecast` does **not** share the bug — its per-bucket filter is `createdAt < end`, an ordering
test — so the two procedures genuinely disagree on that input. Both behaviours are reproduced; the
adjacent unit test says so, so nobody "unifies" them.

### (2) Twelve queries collapsed to one aggregate — output-identical

`getMrrForecast` issues twelve `findMany` calls, one per month boundary, each re-reading every active
subscription created before it. One `(month, plan, count)` aggregate answers all twelve, because "active
subscriptions created before the first instant of month M+1" is exactly "all rows whose creation month is
≤ M". The values are identical; this is not a narrowing.

The one behavioural difference, stated rather than buried: TS's twelve queries run at twelve different
instants, so a subscription created mid-loop lands in the later buckets only. One aggregate is a single
snapshot — more self-consistent, not less faithful in output, and the affected window is milliseconds
during which TS's own result is unspecified.

### (3) Nested relation reads replaced by flat `GROUP BY` aggregates — same values

`getCustomerHealth` and `getUpsellOpportunities` ask Prisma for nested `users` relations and reduce them
in JavaScript, which materialises **every active user of every tenant** into the Node process. The port
uses one `GROUP BY organization_id` per roll-up instead and merges dictionaries. `COUNT(*)` over
`is_active` is the same set as `users.length` after Prisma's `where`, and `MAX(last_login_at)` is the same
instant as the `reduce` that keeps the latest — a query-shape change, not a semantic one, and it keeps a
cross-tenant read bounded by the number of organizations rather than the number of users.

### (4) The `-0.2` growth floor is dead code in both stacks

`getMrrForecast` caps growth to `[-0.2, +0.3]`. The lower bound is **unreachable**: each historical bucket
counts active subscriptions created before that month's end, so widening the window can only add rows —
the series is monotone non-decreasing, every month-over-month rate is ≥ 0, and so is their mean. Ported as
written (it is TS's constant), and pinned by
`Forecast_historical_is_monotone_nonDecreasing_so_the_negative_growth_cap_is_dead_code`, which is a
property test rather than a comment because the premise lives in a query somewhere else.

**A claim was corrected here.** An earlier draft of this port justified changing `JsRound` on the grounds
that "getMrrForecast's growth rate is capped at −0.2, so `Math.round` is routinely negative". That is
false, for the reason above. `JsRound` was still changed from `MidpointRounding.AwayFromZero` to
`floor(x + 0.5)` — they disagree on negative midpoints, and JS rounds half toward +∞ — but the honest
reason is that the argument for why no caller can reach it is subtle and depends on a property of a
different file, not that a caller reaches it today. `floor(x + 0.5)` is also the pre-existing repo
convention (`Tims.Domain/Reporting/ReportingMath.cs`), not a new idea introduced here.

**And `floor(x + 0.5)` is an approximation of the spec, not the spec.** ECMA-262 defines `Math.round` as
the nearest integer with ties toward +∞ and explicitly notes it is not always `floor(x + 0.5)`. Measured,
the two differ at exactly one double below 2^52 — `0.49999999999999994`, where `x + 0.5 == 1` exactly, so
C# returns 1 and JS returns 0. Brute force over every shape a caller here produces found zero
divergences, so it is unreachable on this surface. `MidpointRounding.ToPositiveInfinity` is **not** the
fix despite its name: it is _directed_ rounding applied to every value, and
`Math.Round(33.33333333333333, ToPositiveInfinity)` measures 34 on .NET 10.0.302 — substituting it would
corrupt every percentage this code computes.

### (5) `getMrrForecast` depends on the Node PROCESS TIMEZONE — a fourth environment dependency, and the only unpinned one

Added after the adversarial panel found this assumption asserted in a code comment that cited _this
document_ as the place it was recorded, when it was not written down anywhere. The citation was circular,
and that comment was the assumption's only occurrence in the repo.

`getMrrForecast` alone among the nine builds its buckets and labels in the **host's** zone:
`new Date()` → `setMonth(...)` → `setHours(0, 0, 0, 0)` for each of the twelve `createdAt < end` bounds,
and `toLocaleDateString('es', { month: 'short', year: '2-digit' })` with **no** `timeZone` for all 24
labels. Contrast its sibling `getMrrTrend`, which passes `timeZone: 'UTC'` and uses
`getUTCFullYear`/`getUTCMonth` — **the two TS procedures disagree with each other off UTC.**

The C# is UTC end to end and that is the only implementable choice: mirroring TS's local arithmetic
would import the _C# host's_ zone instead, which is strictly worse. So the port is correct **on the
premise that the deployed Node process runs UTC**, which it does today. Measured under
`TZ=America/Bogota` at `2026-09-01T02:00:00Z`, the TS forecast's newest label is `ago 26` where C# says
`sept 26`: all 24 labels shift a month and every bucket bound moves five hours, so subscriptions created
in the last five hours of a month land in a different bucket than C# puts them in.

This is a **different** assumption from the one PR 1 recorded. That one was the Postgres _session_
`TimeZone` for `date_trunc`, and PR 1's resolution was to **eliminate** the dependence by applying
`date_trunc` to the naive column. This one cannot be eliminated from the C# side; it can only be named.

Nothing pins it, either — `tests/parity/dashboard-fixtures.test.ts` asserts the resolved _locale_ is
`en-US`, and there is no `Intl.DateTimeFormat().resolvedOptions().timeZone` equivalent anywhere in the
repo. Recorded instead as an exemption inside parity caveat 1: caveat 1's reassurance that "within a
month the two clocks agree on every bucket, so this is a minutes-per-month exposure" is **false for this
one endpoint** off UTC, where the divergence is systematic. Caveat 6 tells an operator to check
`LANG`/`LC_ALL`; for this one the variable is `TZ`.

### (6) Reproduced, not fixed, in the smaller print

- `getUpsellOpportunities`' `_count.users` counts **every** user row — inactive and soft-deleted included
  — while its sibling active-user selection filters. The same organization contributes different numbers
  to `totalUsers` and `activeUsers`, for two different reasons.
- Its `totalPotentialMrr` / `highConfidence` / `mediumConfidence` do **not** reconcile with
  `opportunities.length`: `'low'` is a reachable confidence (a score of exactly 40) and is counted in
  neither band.
- `search` lower-cases the query and the page NAME but not the stored KEYWORDS. Invisible today because
  every keyword string is already lowercase; a keyword that gained a capital would become unmatchable.
- `getCustomerHealth` computes a `fourteenDaysAgo` it never uses. Not reproduced — unlike PR 1's dead
  `recentAudit` **query**, this is a local variable with no observable effect and no round trip.
- Neither `contains` filter escapes LIKE wildcards, so a `%` query matches everything — Prisma does not
  escape either, and escaping here would be a silent behaviour change and a parity FAIL.

## Two traps that are 500s, not wrong answers

### `DateTime` kind, on a MAPPED column

Every datetime column this context maps is declared `HasColumnType("timestamp")`, so EF sends query bounds
as `NpgsqlDbType.Timestamp` — and Npgsql **refuses** a `DateTimeKind.Utc` value against that type:
`Cannot write DateTime with Kind=UTC to PostgreSQL type 'timestamp without time zone'`. The application
layer works in UTC-kind instants, so the conversion has to happen at the repository boundary
(`PlatformDashboardTimestamps.ToNaive`).

This is the mapped-column sibling of PR 1's TRAP 10, which was the same naive-versus-aware clash on a raw
`SqlQuery` hole — where the failure ran the _other_ way (a bare `DateTime` defaulted to `timestamptz`, and
an Unspecified value was rejected). Same root cause, opposite symptom, both silent until a real Postgres
is involved. Pinned by
`A_UtcKind_bound_against_a_timestamp_column_is_rejected_which_is_why_the_repository_re_kinds`, which
asserts both directions.

### Native-enum predicates must be LITERALS (TRAP 8, on three more columns)

`invoices.status`, `subscriptions.status` and `platform_invitations.status` are native Postgres enums. A
captured variable is parameterised as `text`, and `"InvoiceStatus" = text` has no operator — a 500. Every
predicate in these repositories is a literal, which Postgres coerces to the column's enum type. No
`EF.Constant` is needed because none of these filters is caller-controlled; if one ever becomes a
parameter, it is. Pinned by
`A_parameterised_enum_comparison_fails_which_is_why_the_repositories_use_literals`.

## `search` is the only endpoint with an input — and the only 400

`z.object({ query: z.string().min(1).max(100) })`, applied to the **raw** input before trimming: a
101-character query is a 400, but a query of three spaces is valid and returns three empty arrays.

**TRAP 9 applies and is handled at the binder.** The parameter is bound as `string?`, not `string`,
because minimal-API model binding runs _before_ the handler: a non-nullable parameter would make a missing
query string 400 during binding, before `PlatformOwnerGate` ever ran, handing an anonymous caller a 400
where tRPC gives 401 (tRPC runs middleware, then Zod). Asserted at the HTTP layer by
`Search_withNoQueryAndNoToken_Is401_NOT_400` and `Search_withAnInvalidQueryAndAnOrgUserToken_Is403_NOT_400`
— the only two tests that can tell the orderings apart.

The emitted OpenAPI contract said the parameter was **optional**, because the generator reads that same
nullable annotation. Corrected with an operation transformer (`required: true`, `minLength`, `maxLength`),
matching the precedent set by the `SubmitValidationBody` schema transformer: state what the endpoint
actually enforces. The contract diff is otherwise purely additive.

`String.prototype.trim()` is ported explicitly rather than delegated to `string.Trim()`. The two
whitespace sets differ in **both** directions: .NET strips `U+0085` (NEXT LINE), which ECMA-262 does not;
ECMA-262 strips `U+FEFF`, which .NET does not consider whitespace at all. Either difference turns a query
one stack treats as empty — the early return, no database work — into one the other runs.

## `getAttentionItems` needs a custom JSON converter, and why nothing else does

`buildAttentionItems` builds five different object literals, and **which optional keys appear is a
function of the item type**: `expiring_trial` writes no `amount` key at all, `failed_payment` writes no
`daysUntil` key, and `pending_invitation` writes `orgId: inv.organization?.id` — a _present_ key whose
value is `undefined` when the invitation has no organization.

A written-but-undefined key is not the same as an absent one on this wire. The response goes through
superjson, and superjson's `json` payload — the half `scripts/parity/trpc.ts` hands to the differ —
encodes `undefined` as `null` (measured against superjson 2.2.6: `{a: undefined}` → `json: {"a": null}`).
So the org-less invitation must emit `"orgId": null` while the expiring trial must emit no `amount` key
whatsoever. `[JsonIgnore(WhenWritingNull)]` gets the first wrong; plain nullable properties get the second
wrong. `AttentionItemJsonConverter` derives the key set from `Type` and is pinned per item type by unit
tests and again on the wire.

The alternative was a `dropNullish` normalize rule in the parity registry, which would make both shapes
compare equal — and would equally hide a C# side that stopped emitting `orgId` at all.

**This corrects a claim in PR 1's registry comment**, which said `dropNullish` "would mask a C# `meta:
null` where TS omits the key". The mechanism is wrong for the reason above (TS would emit `null`, not omit
the key). The conclusion — no normalize rule — is unchanged, and `getRecentActivity`'s `meta` is written
unconditionally anyway, so nothing was ever at risk.

## Ownership ledger — nothing moved, four tables newly mapped

`invoices`, `platform_invitations`, `feature_flags` and `vacancies` gain `ToTable` maps; all four were
already in `efcoreReadOnly[]`, so no array changed. CI would have stayed green either way —
`scripts/table-ownership.mjs` fails only a `ToTable` present in **none** of the four EF lists — which is
exactly why the note (`platform_dashboard_read_slice23_pr2`) exists: the check is a floor, not a record.
SELECTs only, no writer added, Prisma still owns every DDL.

`platform_invitations` is now mapped by THREE read contexts: slice 22's `PlatformInvitationsReadDbContext`
(the widest column set), slice 19's `PlatformOrganizationsReadDbContext` (`id`/`organization_id`/`status`
only), and this one. That is the documented convention for a shared table, not a conflict, and none of the
three writes. (An earlier draft said two — the ledger note's whole stated reason for existing is that the
automated checker is "a floor, not a record", so an undercount there fails at the one job it claims.)

## Parity — nine endpoints registered, with four new caveats

`SURFACES['dashboard']` gains six endpoints, all `globalScope` platform-owner reads keeping a real
`tsProcedure`. The registry's `globalScope` count pin moves 15 → 21.

**No normalize rule on any of the nine**, and each absence is a decision, asserted by `surfaces.test.ts`.
The sharpest is `customer-health`: a `sortArraysBy: 'orgId'` rule would cure a real tie-flake by deleting
the only thing that endpoint computes which a diff can see.

Four caveats added for whoever runs `verify dashboard` (full text in `scripts/parity/surfaces.ts`), plus
an exemption noted inside the existing caveat 1:

4. **`attention-items` can flake on row SELECTION.** Two of its five sources — past-due subscriptions and
   suspended organizations — have no `orderBy` at all, only `take: 20`. Above 20 rows in either, _which_
   twenty come back is unspecified in both stacks, and no normalize rule reconciles different row sets.
5. **`customer-health` and `upsell-opportunities` order ties by database row order.** Both read
   `organizations` unordered, then stable-sort by a coarse key. Organizations sharing a band (or a plan)
   come back in whatever order Postgres returned them. Stable in practice between two calls seconds apart;
   a real risk on a large, recently-updated table. Re-run rather than normalize.
6. The `toLocaleString` locale dependency described above.
7. **`search` is unevenly covered by the current seed**, and the weak leg is named rather than left to be
   discovered by a failed run. `organizations` is strong (two rows, distinct names, no tie). `pages` is
   **vacuous** for the chosen term — no `SEARCH_PAGES` entry contains "parity" — so that kernel is covered
   by C# tests instead. `users` is the **weakest leg in the surface**, though not for the reason first
   written: ~31 seeded users match (every seeded email is `parity+…@tims.test`), and `orderBy firstName
asc` + `take: 5` sorts them `'Comp'`(2) < `'Dei'`(10) < `'Enps'`(10) < `'Parity'`(9) — so the window is
   deterministically the two `'Comp'` rows plus **three of the ten `'Dei'` rows**, and the `'Parity'`-named
   role users an earlier draft blamed sort 22nd–31st and can never appear at all. Two ties remain: WHICH
   three `'Dei'` rows (a row-SET difference, unfixable by normalization) and the ORDER of the two `'Comp'`
   rows, which share a first name and are compared positionally. A diff confined to `users[*]` should be
   re-run before it is believed. The durable fix is a search-specific fixture whose first names are
   distinct **and sort ahead of `'Comp'`** — distinct-but-later names would land outside the window and
   change nothing — which belongs with the grant-fixture work #195 tracks.

The registry term is `parity` because that is what the harness's seed actually contains. An earlier draft
used `acme`, which appears nowhere in `scripts/parity/seed.ts` — it would have made both stacks return
three empty arrays and compared equal: a PASS proving nothing. `surfaces.test.ts` now also asserts that
`search`'s `csharpPath` query string agrees with its `input`, because the two are sent to different stacks
and nothing else cross-checked them.

## Test posture

- **Unit** — the five kernels, against the shared golden and with the exact wire strings: the two number
  formats that sit four lines apart in the attention helper (`1,234.5` from `toLocaleString`, `2499`
  without a separator from a bare interpolation), the pluralisation rule that is singular only at exactly
  1, the health bands and their precedence, the upsell score thresholds including
  `Math.ceil(3 × 0.7) === 3` (IEEE-754, so the expression is reproduced rather than the number tabulated),
  and the per-item-type JSON key sets.
- **Integration** — Testcontainers Postgres with native enums and `timestamp(3)` columns, the full auth
  matrix on all six routes, and payload tests asserting **exact wire values**. The forecast's expected
  numbers were produced by running the TS expression in Node, not re-derived in C# — a test that recomputes
  what it checks agrees with any implementation, including a wrong one. (Two of them caught arithmetic
  errors in the expected values while the port was right both times.)
- The fixture gains a **second time anchor**. PR 1 hung everything off the start of the month; these six
  reads have rolling 5/7/14-day windows, so their rows hang off `SeedNowUtc` instead. Every added user is
  created at `m0 − 7 months`, which keeps them outside `getUserGrowth`'s window and below the five newest
  users, so **every PR-1 expectation is untouched**.
- The PR-1 seed made all eight subscriptions `trialing` by default. Both MRR endpoints filter
  `status = 'active'`, so they would have returned twelve zeroes — a green suite proving nothing. The seed
  now sets an explicit status and creation month on every row.
## Mutation results — RUN, not asserted

Twelve controls this PR adds were each broken at exactly one site, rebuilt, and run against the named
test. **All twelve went RED.** Every mutation compiled first (a mutation that does not compile is not a
mutation — it would run the previous binary and report a meaningless green), and each was applied with a
`count == 1` assertion and confirmed by re-reading the file.

| Mutation                                                    | Result | Evidence                                                                                                                                              |
| ----------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete `PlatformOwnerGate` from the attention-items handler | RED    | 1 failed / 45 — `OrdinaryOrgUser_Is403`: expected Forbidden, got **OK**                                                                               |
| Delete `PlatformOwnerGate` from the search handler          | RED    | 2 failed / 45 — org-user token returned **200 with cross-org results**, and `Search_withAnInvalidQueryAndAnOrgUserToken_Is403_NOT_400` flipped to 400 |
| Comment out the `MapFxFreeInsightEndpoints(app)` call       | RED    | 39 failed / 45 — all six `PlatformOwner_Is200` became 404                                                                                             |
| `PlatformDashboardTimestamps.ToNaive` → identity            | RED    | 6 failed / 45 — all six assert **500**, the Npgsql `Kind=UTC` rejection                                                                               |
| `AttentionItemJsonConverter`: always write amount/currency  | RED    | 3 failed / 19 — the per-type key-set assertions                                                                                                       |
| `JsRound` → .NET default (banker's)                         | RED    | 5 failed / 110 — incl. the 12.5 % → 13 wire assertion                                                                                                 |
| `JsToLocaleString` → plain `ToString`                       | RED    | 2 failed / 110 — the `$1,234.5` description                                                                                                           |
| `SpanishShortMonthYear2` → no zero-padding                  | RED    | 1 failed / 27 — the year-2000 golden case                                                                                                             |
| `JsTrim` → `string.Trim()`                                  | RED    | 2 failed / 13 — the U+FEFF and U+0085 cases                                                                                                           |
| `search` validates the TRIMMED value instead of the raw one | RED    | 1 failed / 45 — a three-space query became a 400                                                                                                      |
| Enum predicate → captured variable (TRAP 8)                 | RED    | 2 failed / 45 — `"InvoiceStatus" = text` has no operator                                                                                              |
| `ActiveUserThreshold` → `Math.Floor`                        | RED    | 2 failed / 36 — `minUsers` 3 → 2 and 8 → 5                                                                                                            |

### Two corrections the mutation run produced, and one it forced

**1. Deleting the gate does NOT break the 401 tests, and my expectation that it would was wrong.**
`RejectedCredential_Is401` kept passing under both gate deletions. That is not a hollow test:
`.RequireAuthorization()` sits on the route, so ASP.NET's authorization middleware returns 401 _before_
the handler lambda runs, and the in-handler gate never sees an unauthenticated request. The 401 and the
403 are enforced by **two different controls**, and only the 403 is attributable to `PlatformOwnerGate`.
Worth stating because it means a reviewer cannot read the 401 rows as gate coverage.

**2. The 404-when-dark tests cannot tell "dark" from "never wired".** Under the wiring mutation, the six
`Route_Is404_WhenFlagDefaultsOff` cases were the _only_ six passes. The flag guard and the mapping call
are separately load-bearing, and only the `PlatformOwner_Is200` rows distinguish them.

**3. One mutation initially came back inconclusive, and was not written off.** `upsell-threshold-floor`
reported `COULD_NOT_RUN`: its worktree had been provisioned at `82bc5826`, which predates slice 23
entirely, so the target file did not exist. An adjudicating agent confirmed the cause was provisioning
rather than a hollow control — and explicitly refused to upgrade "unknown" to "fine". It was re-run in a
worktree at `ac529caf` and went RED on the two discriminating rows (`minUsers` 3 and 8; the 20 → 14 row is
invariant under ceil/floor because `20 * 0.7` is exactly 14 in IEEE-754). That adjudication also
surfaced a genuine coverage fact: **`ActiveUserThreshold_is_ceil_of_seventy_percent…` is the only test in
the suite that discriminates ceil from floor** — every other threshold-adjacent case is invariant.

## Tier-3 adversarial panel — RUN (cross-model was NOT available)

`/gate` check 15 exited **2**: Codex is quota-blocked and `OMNIROUTE_MODEL` is unset, so no
different-vendor reviewer ran. Per `.claude/rules/verification.md` that is **NOT a pass**, and the
required substitute is a same-model 3-lens adversarial panel. It ran: security/tenant-isolation,
claim-auditor, and coverage, each prompted to refute rather than confirm, then **every** candidate
finding was put to three independent refuters with distinct angles (re-read the source; is it a defect
under the parity rules; is it already handled) and killed unless at least two failed to refute it.
19 candidates → **13 survived** → 11 distinct after merging duplicates. A separate completeness critic
looked for what all three lenses missed.

**Verdict: no live parity defect.** The six ported procedures match the TypeScript key-for-key. Every
surviving finding was either a mutation-coverage gap or a claim/documentation inaccuracy.

A SECOND pass then audited the fixes themselves — nothing had reviewed the text written in response to
the panel — and found that two of them did not do what they claimed. Both are corrected, and the
corrections are the interesting part:

- The `take: 20` fix asserted the five call sites through a **fake** repository, so the very mutation its
  docblock quoted (delete all five `.Take(take)`) stayed green. Its claim that asserting the argument was
  "the only cheap option" was false too: it ruled out exceeding the cap and overlooked `take: 0`, which
  needs no fixture change. Now pinned against a real Postgres as well.
- The `is_active` gap was recorded as untestable. True at the ENDPOINT — the status guard drops the only
  inactive organization before scoring — and false at the REPOSITORY, where that guard does not exist
  yet. It is now tested, with PR 1's 8-organization seed untouched.

With those corrected, the resolutions are:

| Finding                                                          | Class    | Resolution                                    |
| ---------------------------------------------------------------- | -------- | ---------------------------------------------- |
| The five `take: 20` caps were unprotected by any test             | coverage | a unit test pinning all five call-site arguments, AND a repository-level `take: 0` test that pins the application |
| The `is_active` filter on `getUpsellOpportunities` was unpinned    | coverage | repository-level test (the endpoint-level one is masked by the status guard) |
| Three of `search`'s six ILIKE legs unpinned                       | coverage | slug / domain / lastName isolation tests       |
| `take: 5` truncation asserted by count only, never by identity    | coverage | the `%` query now pins the five organizations in name order |
| `subscription.plan` vs `organization.plan` precedence unpinned    | coverage | one unit case where the two disagree           |
| **The fixture enabled RLS on 1 of 7 mapped tables**               | coverage | ENABLE + FORCE + fail-closed policy on all four new tables |
| **A docblock cited this document for a TZ assumption not in it**  | claim    | §(5) written; the citation is now true         |
| Caveat 1's "minutes-per-month" reassurance is false for `mrr-forecast` | claim | exemption added to caveat 1                  |
| Caveat 7 blamed rows that can never enter the result window       | claim    | rewritten around `'Comp'`/`'Dei'`              |
| Two docblocks re-asserted the claim this commit retracts          | claim    | both rewritten                                 |
| Coverage-guard header left at pre-PR figures (8 lines, 2 files)   | claim    | re-derived and corrected                       |
| "THREE new caveats" — four were added; "TWO read contexts" — three | claim   | corrected in both files                        |
| "`floor(x+0.5)` is JS's actual rule" — it approximates it         | claim    | narrowed, with the one divergent double named  |

The panel was **wrong once**, and it is worth recording which time: its completeness critic proposed
`MidpointRounding.ToPositiveInfinity` as "the exact rule [that] costs the same". Measured on .NET
10.0.302, that is *directed* rounding — `Math.Round(33.33333333333333, ToPositiveInfinity)` is **34** —
so taking the advice would have corrupted every percentage on the surface. The panel's own report lens
had flagged the same thing correctly. Verify before acting, including on the verifier.

**One finding was recorded rather than tested, and that call was wrong.** `getUpsellOpportunities`'
`is_active` filter is masked at the ENDPOINT: the fixture's only inactive organization is also `past_due`,
so the use case's status guard drops it before scoring and deleting `.Where(o => o.IsActive)` leaves every
endpoint assertion green. The conclusion drawn from that — that closing it would need a ninth organization,
colliding with the 8-organization seed PR 1's 12.5% → 13 rounding pin depends on — held only for an
endpoint test. At the REPOSITORY the status guard does not exist yet, so the filter is directly
observable: `The_upsell_read_excludes_inactive_organizations_and_customer_health_does_not` pins it with
the seed untouched. Kept here as the history of a wrong call, because "recorded rather than tested" is a
conclusion worth re-testing whenever it appears.
