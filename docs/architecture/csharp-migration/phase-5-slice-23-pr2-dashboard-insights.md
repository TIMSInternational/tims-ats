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
`floor(x + 0.5)` — the two rules disagree only on negative midpoints, and JS rounds half toward +∞ — but
the honest reason is that the argument for why no caller can reach it is subtle and depends on a property
of a different file, not that a caller reaches it today.

### (5) Reproduced, not fixed, in the smaller print

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

`platform_invitations` is now mapped by two read contexts (slice 22's, with a wider column set, and this
one). That is the documented convention for a shared table, not a conflict, and neither writes.

## Parity — nine endpoints registered, with three new caveats

`SURFACES['dashboard']` gains six endpoints, all `globalScope` platform-owner reads keeping a real
`tsProcedure`. The registry's `globalScope` count pin moves 15 → 21.

**No normalize rule on any of the nine**, and each absence is a decision, asserted by `surfaces.test.ts`.
The sharpest is `customer-health`: a `sortArraysBy: 'orgId'` rule would cure a real tie-flake by deleting
the only thing that endpoint computes which a diff can see.

Three caveats added for whoever runs `verify dashboard` (full text in `scripts/parity/surfaces.ts`):

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
   by C# tests instead. `users` is the **weakest leg in the surface**: `seed.ts` gives every seeded role
   user the literal first name `'Parity'`, so with `orderBy firstName asc` + `take: 5` over ~15 matching
   users the tie is total and both the selection and the order are unspecified. A diff confined to
   `users[*]` should be re-run before it is believed. The durable fix is a search-specific fixture, which
   belongs with the grant-fixture work #195 tracks.

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
