# Phase-5 Slice 23 — platform dashboard READ, FX-free tier (#81, PR 1 of 3)

Ports THREE of the platform dashboard cluster's thirteen reads (nine live in
`packages/api/src/routers/platform/dashboard.ts`, four in its `dashboard-churn` / `dashboard-forecast` /
`dashboard-upsell` siblings, all merged flat into the platform router) —
`getPlanDistribution`, `getUserGrowth`, `getRecentActivity` — as dark GET endpoints under
`Platform:PlatformDashboardReadEnabled`. TS remains the live path; `PlatformOwnerGate` is the entire
authorization boundary (cross-org by design, never `TenantScope`d).

## #81 is THIRTEEN reads and this PR is THREE. The other ten, and why.

The split is by risk, not by size:

- **FX-dependent (port LAST):** `getDashboardKpis`, `getRevenueByCustomer`, `getChurnRisk` all call
  `sumMoney` (`packages/api/src/lib/currency.ts`; the churn call site is `dashboard-churn.ts:55`) → LIVE
  Frankfurter FX rates. They need the fx conversion machinery plus a parity strategy for a value that
  changes between the two stacks' calls. Hardest, last. _An earlier draft of this split (and the
  2026-08-14 session checkpoint it came from) swapped `getChurnRisk` with `getCustomerHealth`; the tier-3
  panel counted the `sumMoney` call sites — `dashboard.ts:98/:226/:233` + `dashboard-churn.ts:55` are all
  of them, and `getCustomerHealth` (`dashboard.ts:268-352`) has no currency math at all._
- **Unmapped tables:** `getAiCostAnomalies` needs EF maps AND new ledger entries for THREE genuinely
  unmapped tables — `ai_agent_org_configs`, `ai_agent_usage_logs`, and `ai_agents` (its `agent` join,
  `dashboard-upsell.ts:140`). _Two corrections from the panel here: an earlier draft counted two tables
  (missing the `ai_agents` join — no `ToTable` maps it anywhere in `services/Tims.Platform/src`), and it
  grouped `getUpsellOpportunities` under this blocker — falsely: that procedure
  (`dashboard-upsell.ts:31-128`) reads only organizations/subscriptions/users/`_count`s of
  feature_flags+vacancies, all already mapped and ledgered._ (`audit_logs` is already
  `efcoreAppendOnly`.)
- **FX-free remainder (follow-up sub-slices, same flag):** `getAttentionItems`, `getMrrTrend`,
  `getMrrForecast`, `getCustomerHealth`, `getUpsellOpportunities`, `search` — six procedures. Their MRR
  figures derive from `PLAN_PRICES` USD constants, not live FX. Absent from this PR only to keep it
  reviewable; they ride `PlatformDashboardReadEnabled` when they land.
  **Landmine for that sub-slice, found by the coverage lens:** `getMrrTrend`'s labels use
  `toLocaleDateString('es', { month: 'short', year: '2-digit' })` (`dashboard.ts:508`) — a DIFFERENT
  format from the bare short months `dashboard-kernels.json` covers, and exactly the ICU-divergence trap
  class this slice built the golden for. Node emits `"ene 26" … "sept 26"`. It needs its own golden array
  before porting; reusing `SpanishShortMonth` + a hand-rolled year suffix without one can silently
  diverge.

These three were chosen first because they are small but NOT trivial — all four of the cluster's parity
traps concentrate in them (below), so this PR establishes the dashboard pattern the rest will copy.

## The four parity traps, characterized and pinned

All four are pinned, but by DIFFERENT mechanisms, and an earlier draft of this line overstated the
golden's reach ("all four are pinned by the shared golden" — the panel read the fixture: it contains
exactly `spanishShortMonths` and `monthSeriesCases`). Trap 1 is the one pinned by
`contracts/dashboard-fixtures/dashboard-kernels.json` in BOTH stacks (2 of the 12 C# unit tests + the 2
TS tests in `tests/parity/dashboard-fixtures.test.ts` consume it). Traps 2–4 are pinned by the other C#
unit tests (`tests/Tims.UnitTests/PlatformDashboard/`) and by the integration suite over the real wire —
C#-side only, which is the honest maximum: their TS "pin" is the live implementation itself, and adding
golden cases for rounding/seeding/tiebreak is cheap follow-up work for the next sub-slice.

1. **`toLocaleDateString('es', { month: 'short' })` emits `"sept"`** — four characters — for September.
   .NET's `CultureInfo("es")` abbreviation does NOT match Node's ICU output. The C# hardcodes the twelve
   strings (`SpanishShortMonths`) and both stacks pin them byte-for-byte to the golden, so a Node/ICU
   upgrade fails both suites loudly instead of diverging silently.
2. **JS `Math.round` rounds a `.5` toward +∞; .NET `Math.Round` defaults to banker's (to-even).**
   `Math.Round(2.5)` is 2 in C# and 3 in JS. `JsRound` spells out `MidpointRounding.AwayFromZero` (equal
   to toward-+∞ for the non-negative percentages here). The integration fixture seeds 8 subscriptions
   split 1/3/3/1 so that 1/8 = 12.5% must serialise as **13** — the single digit that separates the two
   roundings over the real wire.
3. **`getPlanDistribution` seeds `{trial, starter, professional, enterprise}` in order and appends an
   unknown plan AFTER them** (JS object insertion order), with `total = subs.length || 1` avoiding
   divide-by-zero. Reproduced exactly — including the unknown-plan append, which is DEAD CODE against
   prod (the column is the 4-label `OrgPlan` native enum) but is part of the observable contract if the
   enum ever grows.
4. **`getRecentActivity` builds orgs-then-users and STABLE-sorts descending**, so a timestamp tie keeps
   orgs before users (`Array.prototype.sort` is stable since ES2019; `OrderByDescending` is stable in
   .NET; the C# builds the list in the same order). The integration fixture seeds an org and a user at
   the SAME millisecond and asserts the org first — and asserts both wire timestamps are byte-equal, so
   the assertion is provably about the tiebreak.

## Recorded divergences

### (1) `getRecentActivity`'s `recentAudit` fetch is NOT reproduced

TS fetches 10 audit rows in its `Promise.all` (`dashboard.ts:358`) and never uses them — a dead query
with zero payload effect. Reproducing it would mean mapping `audit_logs` into this context for nothing.
The C# fetches orgs and users only. Invisible on the wire; recorded here because a load-profile
comparison would see one fewer query.

### (2) The month group-by SQL is spelled session-TZ-independent

TS: `date_trunc('month', "created_at" AT TIME ZONE 'UTC')` + `to_char(...)`. Both `date_trunc` and
`to_char` on a `timestamptz` render in the SESSION's `TimeZone`, so the TS labels are UTC months only
because the Prisma connection runs at the server default (UTC in prod/Supabase). The C# applies
`date_trunc('month', "created_at")` directly to the naive column — the same UTC month under prod
conditions, with no session-TZ dependence at all. Reproducing the TS text verbatim would have IMPORTED
the dependence (Npgsql's session TZ is not guaranteed UTC on every machine), making C# diverge from TS
exactly when the session differs. The integration fixture seeds a row 30 minutes after a month boundary
to pin this. Aliases are `"Month"`/`"Count"` because EF's `SqlQuery<T>` matches property names exactly —
an alias changes no grouping and no value.

### (3) Sequential reads where TS uses `Promise.all`

`getRecentActivity`'s two queries run sequentially on one `DbContext` (EF forbids concurrent ops per
context). The reads are independent; only simultaneity is lost. Same note as slice 22's KPIs — neither
stack wraps them in a snapshot transaction, so this is parity, not a regression.

### (4) No caching, faithfully

`getDashboardKpis` has a 45s cache; these three procedures have NONE in TS — every call hits the
database. No cache added, because an improvement makes step-5 parity uninterpretable.

## NEW TRAP — a `DateTime` hole in `SqlQuery<T>` binds as `timestamptz`, and Unspecified is REJECTED

The first raw SQL in any C# read slice found the third member of the native-type trap family (after
TRAP 3 materialisation and TRAP 8 enum parameters):

- EF's default type mapping for a `DateTime` parameter is `timestamp with time zone`.
- Passing a UTC-kind value "works" but makes Postgres lift the naive COLUMN to the session TZ for the
  comparison — the same session-TZ hazard as divergence (2), relocated into the WHERE bound.
- Re-kinding to `Unspecified` (the trick that works for MAPPED `timestamp` columns) is rejected outright
  by Npgsql at the parameter layer: `Cannot write DateTime with Kind=Unspecified to PostgreSQL type
'timestamp with time zone'`. The first attempt here did exactly that; the endpoint 500d and the
  repository-level integration test surfaced the real exception.

**Fix:** an explicit `NpgsqlParameter("from", NpgsqlDbType.Timestamp)` in the interpolation hole —
`SqlQuery` passes a `DbParameter` through as-is, giving the direct naive comparison. Pinned by
`UserGrowth_raw_sql_respects_the_inclusive_window_and_groups_by_utc_month`, which seeds rows at exactly
the window bound (counted) and 1s before it (excluded).

## Operational posture — checked, and two deliberate deferrals

- **Rate limiting:** the three GETs land in `RateLimitMiddleware`'s default Query bucket (100/min,
  trusted-IP keyed) — `/platform/dashboard/*` is on no exemption list, which is parity with the TS
  `platformProcedure`s and the same free-by-default outcome slice 22 documented. Nothing to wire.
- **Terraform:** `Platform__PlatformDashboardReadEnabled` is deliberately NOT added to
  `services/Tims.Platform/deploy/terraform/main.tf` `base_env` in this PR. Absence keeps the surface dark
  (fail-safe), and the invitations read flag shares this state; wiring belongs with the flip preparation,
  not with a dark PR-1. Recorded so the omission reads as a decision, not the #100 gap class that file's
  own comments describe.
- **`scripts/deploy/cutover.sh`'s flag manifest** has no row for this flag — but also none for any flag
  since slice 18 (Monitoring, PlatformOrganizations read/write/create, PlatformInvitations are all
  absent). Pre-existing drift, not introduced here; tracked as a follow-up rather than patched in a
  read-slice PR.

## Ownership ledger — nothing moved

All three mapped tables were already registered: `users` in `efcoreReadOnly[]`, `organizations` and
`subscriptions` in `efcoreStranglerWrite[]` (slices 20/21 own their writes; this context adds SELECTs
and no writer, so the one-active-writer discipline is untouched). Rationale note
`platform_dashboard_read_slice23` added to `docs/architecture/table-ownership.md` — "already listed" and
"listed for this reason" are different records. The ai-agent sub-slice is the one that must add NEW
entries.

## Parity — registered, with a real diff

`SURFACES['dashboard']` (`scripts/parity/surfaces.ts`): three endpoints, all with live `tsProcedure`
refs, `probeRole: 'platform_owner'`, `globalScope: true` on all three (platform-owner cross-org reads;
RBAC org_admin 403 is the boundary proof). Registered in the same PR that deploys the routes, so the
#195 allowlist is UNCHANGED at 84 — the gap did not grow. Route-coverage pins: deployed 138 → 141,
registry 54 → 57.

Three operational caveats are written into the surface header (worth restating): `user-growth` diffs
spuriously across a month boundary between the two stacks' calls; `recent-activity` can flake on a
`created_at` tie at the per-source take-5 boundary (different row SETS, which no normalize absorbs —
deliberately NO `sortArraysBy`, because the merged order IS the kernel under test); and an empty
`organizations`/`users` table makes `recent-activity`'s PASS vacuous, while the other two legs still
compare real structure on empty tables.

`verify dashboard` has NOT been run — running parity verification against prod is Federico's call (#211:
`verify organization` has never been run either, so no surface's parity is OBSERVED yet). One stale
sub-claim corrected by the panel: prior checkpoints said `scripts/parity/.env` "does not exist here" —
the file DOES exist on this machine (mtime 2026-07-31; contents unread and completeness unverified).
Every parity claim above is derived from source and pinned by tests, not observed against prod.

## Mutation results — RUN, not asserted

See the PR body for the exact commands and outputs. Summary:

| #   | Mutation                                                      | Expected killer                          | Result                                                                 |
| --- | ------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Delete `PlatformOwnerGate` from ONE handler (recent-activity) | `OrdinaryOrgUser_Is403` for that route   | KILLED — 200 ≠ 403                                                     |
| 2   | Map endpoints unconditionally (drop the flag guard)           | `Route_Is404_WhenFlagDefaultsOff`        | KILLED — 200 ≠ 404                                                     |
| 3   | `JsRound` → banker's default `Math.Round(value)`              | unit golden + wire `PlanDistribution` 13 | KILLED — both suites                                                   |
| 4   | Recent-activity merge order users-then-orgs                   | tie test (org must precede user)         | KILLED                                                                 |
| 5   | Data source without `EnableUnmappedTypes`                     | (live negative test, not a mutation)     | `Fails_on_a_plain_connection_string…` asserts the throw on BOTH tables |

## Tier-3 adversarial panel

Codex (tier 1) remains quota-blocked — `codex-review.sh` exit 2, NOT a pass. OmniRoute (tier 2) is not
configured on this machine. The tier-3 same-model 3-lens panel (security / claim-auditor / coverage) ran
against this branch; findings and dispositions are recorded in the PR body. **This is same-model review,
weaker than cross-model — it shares the author's blind spots — and is recorded as tier 3, not as
"cross-model verified".**
