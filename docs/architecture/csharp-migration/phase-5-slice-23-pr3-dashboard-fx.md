# Phase-5 Slice 23 — platform dashboard READ, the three FX-DERIVED procedures (#81, PR 3 of 3)

Ports `getDashboardKpis` (`routers/platform/dashboard.ts:13`), `getRevenueByCustomer` (`:200`) and
`getChurnRisk` (`routers/platform/dashboard-churn.ts:9`) to C#, dark behind the SAME
`Platform:PlatformDashboardReadEnabled` flag as PRs 1 and 2. That flag now covers **twelve** of the
cluster's thirteen reads.

What separates these three from the nine already shipped is one call each to `sumMoney`
(`packages/api/src/lib/currency.ts`). Everything else — the gate, the context, the darkness, the
platform-owner shape — is unchanged.

## What is left after this PR: ONE of thirteen

`getAiCostAnomalies`, and it is still the only read of the thirteen that needs **new ownership-ledger
entries**: `ai_agent_org_configs`, `ai_agent_usage_logs` and `ai_agents` are all genuinely unmapped,
so that sub-slice must touch `docs/architecture/table-ownership.md` for real rather than adding a
rationale note to tables already listed.

## The decision that took longer than the port: what parity can and cannot compare

**The two stacks do not read the same FX provider, and no fixture work can change that.**

|              | TS                                  | C#                                                                                     |
| ------------ | ----------------------------------- | -------------------------------------------------------------------------------------- |
| Source       | live Frankfurter (ECB), per request | `fx_rates` DB pin                                                                      |
| Provider     | `frankfurter`                       | `exchangerate-api`                                                                     |
| COP→USD      | direct quote, today                 | `1 / 3200.634052` (inverted cross-rate through the USD base)                           |
| Freshness    | 6h in-process cache                 | every production pin still carries `as_of 2026-07-31` — `FxRefreshJob` is not deployed |
| Missing rate | throws → 500                        | returns `null` → caller suppresses                                                     |

### The plausible plan that does not work

"Seed USD-only invoices into the parity fixture, so both stacks short-circuit to the identity path
(TS never calls the network, `FxRateProvider` never touches the DB) and the comparison is
deterministic."

That is true of the harness's own rows and irrelevant to these endpoints, because **all three are
platform-wide**: they sum every tenant's invoices, not the two organizations the harness owns.
Measured against the live database on 2026-08-15:

| org            | amount        | status  | due        |
| -------------- | ------------- | ------- | ---------- |
| Grupo Nutresa  | 5,300,000 COP | pending | 2026-06-28 |
| AgroVerde S.A. | 2,950,000 COP | pending | 2026-06-30 |
| Rappi          | 1,249 USD     | pending | 2026-06-26 |

All three are overdue, so all three land in `getDashboardKpis.outstandingAmount`. At the pinned rate
C# reports **3826.61**; TS converts the same rows at whatever COP has done in the fifteen days since
the pin was taken (a 1% move puts it at 3800.84). The same divergence reaches `getChurnRisk`'s
`overdueAmount` — and its `toLocaleString`-formatted risk STRING — and `getRevenueByCustomer`'s
outstanding bucket, for whichever organizations own those rows.

### What was decided (Federico, 2026-08-15)

The three are registered **C#-only** — no `tsProcedure`. Parity reports an explicit `[WEAK]`
did-not-run for them, while `checks/rbac.ts` (org_admin 403 / platform_owner 200 against the live C#
route) and the RLS disposition keep asserting. Same treatment as `dei.getPayEquity` and
compensation's three FX reads, for a stronger version of the same reason.

Deleting the entries instead would retire the RBAC deny assertions on three live-in-repo routes,
which is a security-coverage regression rather than a cleanup (`EndpointDef.tsProcedure`'s own
contract at the top of `surfaces.ts`).

**A first version of this decision was made on an incomplete premise** — that seeding USD-only
invoices would make the comparison deterministic — and was reversed when the platform-wide scope and
the COP rows were measured. Recorded because the premise, not the conclusion, is the reusable part.

### What replaces the parity diff

`PlatformDashboardFxEndpointAuthTests` seeds a known `USD→EUR` pin at `0.8` and asserts the exact
converted wire value: a 2000 EUR invoice cross-rates back through the USD base at `1/0.8 = 1.25` to
exactly 2500 (`0.8` chosen so the inverse is exact in IEEE-754 double, making the assertion an
equality rather than a tolerance), and the pin's `as_of` arrives on the wire as
`outstandingRatesAsOf`. That is the only cross-currency proof in the repository for these endpoints,
and it exists because parity cannot supply one.

### What the seeded invoices DO buy

`scripts/parity/seed.ts` now seeds six USD invoices across both harness orgs anyway. Until this PR it
seeded **none at all**, so the invoice-derived branches of the already-registered endpoints compared
two empty results — `getAttentionItems` never emitted an overdue item and `getCustomerHealth`
reported `overdueInvoices: 0` for both orgs whatever the code did. Those two get materially stronger
here. The three FX reads do not become comparable.

## Recorded divergences

### (1) `getDashboardKpis`' 45-second cache is NOT reproduced — deliberate

TS wraps this one procedure (alone of the thirteen) in `cacheGet`/`cacheSet` under the key
`tims:kpis:platform:global`, TTL 45s. The port does not cache. Federico's call, 2026-08-15, on three
grounds:

- Writing the **same key** from both stacks lets whichever answers first serve its payload to the
  other. During the dark period that means a C#-shaped body reaching live TS callers; in a parity run
  it means a payload compared against itself — a vacuous green.
- A **C#-only key** would reproduce the staleness while adding a stale-versus-fresh flake to every
  parity run, for no behavioural gain.
- The divergence that remains is **invisible on the wire**. It is freshness, not shape.

Pinned by `PlatformDashboardFxUseCaseTests.The_KPI_read_is_NOT_cached_unlike_its_TS_original`, which
calls the use case twice and asserts the repository was hit twice.

### (2) An unresolvable rate is a 503, not a suppressed field

TS's `getFxRate` **throws** (`fx_rate_unavailable:BASE:QUOTE:status`), so the whole tRPC procedure
fails; it never emits a partially-converted total. The C# FX plane is otherwise fail-soft — a missing
pin returns `null` and the caller suppresses the field — and that disposition is right for a
k-anonymised DEI rollup whose surrounding payload still means something. It is wrong here:
`outstandingAmount`, `paidLast30d` and `overdueAmount` are non-nullable numbers on the TS wire, so
suppressing one would require a response shape TS cannot produce.

So: `PlatformDashboardFxResultKind.FxUnavailable` → **503** with `{ "error": "fx_unavailable" }`,
following `SimulateAdjustmentResultKind.FxUnavailable`, which draws the same line for a REQUIRED
cross-rate. Federico's call, 2026-08-15.

This is a divergence in the ERROR path only, and only in the status code: TS renders its throw as
500, this renders 503. A 5xx either way; 503 is the honest one for a dependency that is temporarily
unresolvable. It is proven at the ENDPOINT (not just the use case) by stubbing `IFxRateProvider` to
the cold-start shape through `ConfigureTestServices`, so the gate, the repository, the real SQL and
the response mapping are all the real pipeline. A companion test asserts an ordinary org-user still
gets **403** with the rate source dead — FX availability must not become an authorization oracle.

### (3) `getDashboardKpis` derives its month bounds in the HOST timezone — the `getMrrForecast` assumption again

TS writes `new Date(now.getFullYear(), now.getMonth(), 1)` — the LOCAL-time constructor, not
`Date.UTC` — so both "this month" deltas and the previous-month MRR snapshot move with the deployed
Node process's zone. The port uses UTC. Mirroring TS's local arithmetic would import the **C# host's**
zone instead, which is strictly worse; the two agree exactly while both hosts run UTC, which is how
this platform deploys.

This is the same assumption PR 2 recorded for `getMrrForecast` (§Recorded divergences there), now
carried by a second procedure. `PlatformDashboardReadUseCase.MonthBucketKeys` states it at length.

### (4) Query-shape changes that are output-identical

- **Plan sums come from a `GROUP BY plan` aggregate**, not from materialising one row per active
  subscription. `Σ PLAN_PRICES[planᵢ]` over rows equals `Σ count(plan) × PLAN_PRICES[plan]` over
  groups. Same justification as PR 2's aggregates.
- **`getRevenueByCustomer` narrows in SQL** to rows that can land in either bucket
  (`paid AND paid_at >= 30d ago`, or `pending`, or `draft`). TS selects every invoice of every
  organization and filters twice in JavaScript; a `void` invoice and a `paid` one outside the window
  contribute to neither bucket, so excluding them changes no output.
- **Money is never summed in SQL.** `sumMoney` rounds each row to two decimals BEFORE summing and
  once more at the end, so a `SUM(amount)` would disagree by cents on any tenant with more than one
  invoice. Counts and user statistics ARE aggregated, because those reductions are exact.
- **The nine KPI queries run sequentially**, where TS issues them inside a `Promise.all`. A DbContext
  is not thread-safe. That is a latency difference, not an output one: no query here reads a value
  another writes, and every bound is captured once by the use case before the first round trip.

### (5) A per-request rate memo, which is fidelity rather than optimization

`FxRateProvider` has no cache and issues two queries per non-identity pair, so an unmemoized
`getChurnRisk` would re-read the pin table once per invoice per organization — and a refresh landing
mid-request could hand two rows of the SAME payload two different rates. TS's `getFxRate` keeps a
process-wide cache, so within one procedure call every row sharing a pair converts at one rate.
`MemoizingFxRateProvider` reproduces that, per CALL rather than per process: a longer-lived instance
would be a second cache layer with its own staleness, and reproducing TS's six-hour TTL would mean
reproducing its expiry too. Both directions are pinned (one lookup for three same-pair rows; two
lookups across two requests).

## Reproduced defects and asymmetries

- **`getChurnRisk` pluralizes two different ways.** The invoice string uses `count > 1 ? 's' : ''`
  and the trial string uses `days !== 1 ? 's' : ''`. They agree everywhere except at zero and below —
  unreachable for invoices (guarded by `> 0`), perfectly reachable for an expired trial, where `0`
  and `-3` both take the plural. Collapsing them to one rule would change output.
- **An expired trial reports a negative countdown.** `Math.ceil` of a negative remainder rounds
  toward zero and the `<= 7` guard still passes, so a long-dead trial keeps emitting
  "Trial expires in -40 days".
- **The 999-day sentinel collapses two states.** An organization whose active users have never logged
  in scores 999 (worst recency band) and reports `daysSinceLastLogin: null` — and so does one whose
  last login really was 999 days ago.
- **`thirtyDaysAgo` in `getChurnRisk` and `prevMonthStart` in `getDashboardKpis` are computed and
  never read.** Not reproduced: local variables with no observable effect, the same disposition as
  `getCustomerHealth`'s unused `fourteenDaysAgo`.
- **`getChurnRisk`'s invoice signal scores the COUNT, not the amount.** One enormous overdue invoice
  costs 15 points; two trivial ones cost 25.
- **The tenure signal's floor is 2, not 0.** A brand-new organization is never scored as having no
  tenure at all.

## A THIRD locale dependency on the wire

`getChurnRisk` interpolates the CONVERTED overdue total into its risk description with
`toLocaleString()` and no locale argument — so the deployed Node process's default ICU locale is part
of that string, exactly as PR 2 recorded for `getAttentionItems`. `JsToLocaleString` carries the
en-US rule. What is new here is that the number being formatted is itself FX-derived, so this string
is where a rate divergence would surface as text rather than as a number.

## Ownership ledger — nothing moved, no new tables, one new column

`PlatformDashboardReadDbContext` gains exactly one column, `invoices.paid_at`. The table has been
mapped since PR 2 and sits in `efcoreReadOnly[]`.

What IS new is a **dependency rather than a mapping**: these three reads resolve rates through the
Slice-11c FX plane, so this surface now reads `fx_rates` — via `FxRateDbContext`, not via its own
map. `fx_rates` is the one table here that efcore owns outright (`efcore[]`), and it is deliberately
RLS-exempt: FX pins are shared reference data, so its migration GRANTs SELECT where every other
efcore-owned table calls `EnableTenantRls`. This PR adds a READER, not a writer.

Recorded as note `platform_dashboard_read_slice23_pr3` because a reader crossing from the
Prisma-owned dashboard tables into an efcore-OWNED table is exactly the edge the ledger exists to
make visible — and the `ToTable` check would never have flagged it, since no new `ToTable` was added.

## Parity — twelve endpoints registered, three of them C#-only, one new caveat

`SURFACES['dashboard']` goes 9 → 12; the `globalScope` pin goes 21 → 24; deployed operations 147 →
150; read registrations 36 → 39; the unregistered allowlist is UNCHANGED at 84.

Caveat 8 (new) states the bound on a green run: three of the twelve are not payload-compared at all.
`surfaces.test.ts` now asserts the split in **both** directions — the nine keep a `tsProcedure` and
exactly these three do not — because both mistakes are silent and they are opposite mistakes.

## Test posture

| Layer                                  | What it proves                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChurnRiskKernelTests`                 | every signal band and boundary, both pluralization rules, the sentinel's scoring-vs-wire asymmetry, ordering, the summary — all with an injected clock                                   |
| `PlatformDashboardFxUseCaseTests`      | month-bound derivation, the plan-price fold, both invoice buckets, the FX-unavailable path on all three, the memo in both directions, the no-cache pin                                   |
| `PlatformDashboardFxEndpointAuthTests` | the real HTTP pipeline: owner 200 / org-user 403 / 401 / flag-dark 404 per route, the 503 path, and EXACT wire values including the cross-rated 2500 and the `outstandingRatesAsOf` date |

The integration fixture's exact `healthScore` values are deliberately NOT asserted: every
organization's tenure band depends on how far into the month the suite runs. The BANDS are stable (no
organization is within that margin of an edge), so the summary and ordering are pinned there, and the
exact scoring boundaries are pinned in the unit tests with an injected clock. `healthScore == Σ
signals` is asserted at the endpoint as an assembly invariant that holds whatever the day.
