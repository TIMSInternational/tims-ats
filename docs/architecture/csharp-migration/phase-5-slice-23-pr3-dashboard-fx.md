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

> **Since landed (2026-08-16)** — see `phase-5-slice-23-final-ai-cost-anomalies.md`. The flag now
> covers all THIRTEEN reads; the "twelve" above is this document's frame, not the current state.

## The decision that took longer than the port: what parity can and cannot compare

**The two stacks do not read the same FX provider, and no fixture work can change that.**

|              | TS                                  | C#                                                                                     |
| ------------ | ----------------------------------- | -------------------------------------------------------------------------------------- |
| Source       | live Frankfurter (ECB), per request | `fx_rates` DB pin                                                                      |
| Provider     | `frankfurter`                       | `exchangerate-api`                                                                     |
| COP→USD      | direct quote, today                 | `1 / 3200.634052` (inverted cross-rate through the USD base)                           |
| Freshness    | 6h in-process cache                 | every production pin still carries `as_of 2026-07-31` — `FxRefreshJob` is not deployed |
| Missing rate | throws → 500                        | **503** (the FX plane returns `null`; these three refuse to suppress — see §(2))       |

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

`scripts/parity/seed.ts` now seeds six USD invoices across both harness orgs anyway — but the obvious
justification for them is **wrong**, and it is worth recording which one. "Until this PR the harness seeded
none, so `getAttentionItems` and `getCustomerHealth` were comparing two empty results" is false against the
live database: those two endpoints are platform-wide for exactly the same reason the FX three are, so they
were already reading the other tenants' three pending-and-overdue invoices.

What the seeded rows actually buy is narrower: the fixture becomes self-sufficient against a
locally-seeded database (which `cli.ts:191` explicitly contemplates, and where those branches genuinely
were empty), and the harness's own two orgs finally carry invoices of their own. The three FX reads do not
become comparable either way.

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

## Mutation results — RUN, not asserted

**Wave 1, 13 of 13 RED**: gate deleted from one handler; the 503 branch returning 200; the memo removed;
`prevMonthEnd` losing its millisecond; the outstanding bucket dropping `draft`; the paid bucket ignoring
the thirty-day window; the `NodeIso` converter removed; TRAP 10 (raw-SQL bound as a bare `DateTime`);
TRAP 11 (`ToNaive` passthrough); the flag guard inverted; churn swallowing an unresolvable rate; the churn
sort reversed; and a `tsProcedure` sneaking onto an FX read.

**Wave 2, 10 mutations against the tests written in RESPONSE to the panel — 9 RED, 1 GREEN.** The green one
is the point of running wave 2 at all.

## Tier-3 adversarial panel — RUN (cross-model was NOT available)

`/gate` check 15 exited **2**: Codex is quota-blocked and `OMNIROUTE_MODEL` is unset. Recorded as ⚠️ NOT
RUN, never a pass. The required substitute ran instead: a 3-lens same-model panel (security /
tenant-isolation, claim auditor, coverage), each prompted to refute rather than confirm and to re-read
source rather than trust a summary. **This is weaker than cross-model review — it shares the author's blind
spots — and must not be described as cross-model verification.**

One process note worth carrying: check 15 first exited **0** with "no changes vs origin/main", because the
work was uncommitted and the script diffs against `origin/main`. An exit 0 there is a vacuous pass. Run it
after committing.

### What the panel found

The security lens found **no authorization bypass, no tenant-isolation defect, no SQL injection and no
concurrency defect**, having tried each specifically. Its two substantiated findings and every finding from
the other two lenses were verified against source before being acted on.

| Finding                                                                | Verdict                                                                                                                | Action                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The models file still claimed parity payload-compares these three      | **True** — it carried the reversed first-decision premise                                                              | Rewritten; the same stale premise fixed in 3 more places                   |
| "Comparing two empty results" understated what the seeded invoices buy | **True** — `getAttentionItems`/`getCustomerHealth` are platform-wide too, so they already read other tenants' invoices | Justification rewritten honestly in 3 places                               |
| "Three of the 39" registrations are C#-only                            | **False — it is 14**                                                                                                   | Corrected, with the five surfaces enumerated                               |
| "Same treatment as `dei.getPayEquity`"                                 | **False** — those are not registered at all; registered-C#-only is the _stronger_ disposition                          | Corrected                                                                  |
| "the cluster's twelfth and thirteenth reads"                           | **False** — they are the tenth, eleventh and twelfth                                                                   | Corrected                                                                  |
| "two queries per non-identity pair"                                    | **False** — one, since the `to` leg is always the USD identity leg                                                     | Corrected                                                                  |
| "Identity pairs never reach the inner provider"                        | **False and self-refuting** — they reach it; it short-circuits before the DB                                           | Corrected                                                                  |
| `InnerCallCount` "exposed so a unit test can prove the memo bites"     | **True** — no test read it                                                                                             | Property deleted; the memo is proved through the injected provider instead |
| The doc's comparison table said C# suppresses the field                | **True** — contradicted its own §(2)                                                                                   | Corrected to 503                                                           |
| Caveat 4 mis-cited for the invoice ordering                            | **True** — the invoice query has an `orderBy`; caveat 4 is about the two that do not                                   | Corrected                                                                  |
| "the only writer remains the Workers FxRefreshJob"                     | **True** — `FxSeedOnce` is a second composition root                                                                   | Corrected                                                                  |
| The "no cache" divergence described as invisible                       | **True of the payload, misleading overall** — up to ~45× executions at ~9× round trips                                 | Qualified, with the consumer named                                         |
| `fx_rates` fixture omitted the unique index it claimed to mirror       | **True**                                                                                                               | Index added, with why it is load-bearing                                   |
| `docs/REMAINING-WORK.md` still said nine endpoints / four reads left   | **True**                                                                                                               | Updated to twelve / one                                                    |
| Eight behaviours with no killing test                                  | **True**                                                                                                               | Tests added, each mutation-proved                                          |

### The fix that did not bite

`TheFxFailurePath_RunsAFTERTheGate` asserted that an org-user still gets 403 with the FX plane dead. Wave 2
mutated the churn handler to run the gate AFTER the use-case call — and the test stayed **GREEN**, because
the gate's failure still wins the response whenever it runs. It proved the status code, not the ordering.

Replaced by `ADeniedCaller_IsRefusedWithoutAnyDataAccess`, which counts REPOSITORY calls through a spy that
delegates to the real repository, and asserts zero for the denied caller **and non-zero for an allowed
one** — without that second half, a spy that was never wired would "prove" the same thing. The same
mutation is now RED. The property it defends is real: these are unfiltered cross-tenant reads, so running
them for someone about to be refused is both wasted work and a larger blast radius than a 403 suggests.

### One operational trap the panel surfaced, now recorded as caveat 9

These three are the only registered endpoints that can legitimately answer **503**, and both the RBAC leg
(`verdictForRole` requires `actual === expected`, pinned at 200) and the parity leg
(`checks/parity.ts:26` fails a C#-only endpoint on any non-200) will call that a FAILURE. The trigger is a
missing `fx_rates` pin for any currency in ANY tenant's invoices. Today's database satisfies it — but the
refresh job is not deployed, so the pin set is frozen and the first tenant invoiced in a new currency arms
it. The check to run before believing a red run is in caveat 9.

## Observed against production, 2026-08-15 — read-only, endpoints still dark

The endpoints cannot be called (the flag is off, and flipping it is Federico's), so this is not a
substitute for `verify dashboard`. What it IS: the exact queries the C# repository issues, run read-only
against the production database, with both stacks' FX arithmetic computed from the same rows. It turns
"they will diverge" into a measured number.

### `getDashboardKpis`, computed from production data

`totalOrgs` 15 · `totalOrgsChange` 0 · `totalUsers` 32 · `totalUsersChange` 0 · `mrr` 12990 ·
`mrrPrevMonth` 12990 · `activeTrials` 2 · `trialsExpiringThisWeek` 0 · `overdueInvoices` 3.

Every one of those is **identical on both stacks** — they are counts and `PLAN_PRICES` sums, no FX. The
divergence is confined to two keys:

|                        | C#           | TS           |
| ---------------------- | ------------ | ------------ |
| `outstandingAmount`    | **3826.61**  | **3889**     |
| `outstandingRatesAsOf` | `2026-07-31` | `2026-08-14` |

**62.39 USD apart, 1.63% of the total.**

### Blast radius: 2 of 15 organizations

Only `Grupo Nutresa` (5,300,000 COP) and `AgroVerde S.A.` (2,950,000 COP) diverge on
`getChurnRisk.overdueAmount` and `getRevenueByCustomer.outstandingAmount`. `Rappi`'s invoice is USD, so
it is byte-identical on both stacks, and the other twelve organizations hold no open invoice at all.

The gap surfaces as PROSE as well as a number, exactly as §"A THIRD locale dependency" predicted:

```
C#: "1 overdue invoice (USD 1,655.92)"
TS: "1 overdue invoice (USD 1,696)"
```

### The finding that inverts the obvious fix

There are **two independent divergences**, and they run in opposite directions:

| rate for COP→USD, today           | value            | property                                          |
| --------------------------------- | ---------------- | ------------------------------------------------- |
| C# — the pin, inverted            | `0.000312438093` | precise, but **stale** (`as_of 2026-07-31`)       |
| TS — Frankfurter, quoted directly | `0.000320000000` | fresh, but **two significant figures**            |
| Frankfurter `USD→COP` inverted    | `0.000320139325` | fresh **and** precise — **neither stack uses it** |

Decomposing the 62.39 USD: **≈ 63.54 USD is the pin's staleness**, and **≈ −1.15 USD is TS being LESS
precise**, because Frankfurter quotes a small-magnitude pair at two significant figures while the
large-magnitude reverse quote carries ten.

**So "make C# call Frankfurter live" — the obvious unification — would make it fresher and LESS accurate
for COP.** The C# architecture is already the better one: store `base = USD`, the direction that carries
precision, and cross-rate. What is missing is not the design but the DEPLOYMENT — `FxRefreshJob` is not
running, which is the entire source of the 63.54.

That reframes the follow-up. It is not "unify the FX source"; it is "deploy the refresh job, then decide
whether TS should read the pin too."
