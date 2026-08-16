# Phase-5 Slice 23 — the final read: `getAiCostAnomalies` (issue #81)

> **Status**: shipped DARK, 2026-08-16. The thirteenth and last read of the platform dashboard
> cluster — with it, **all thirteen of #81's reads are ported** and one flag
> (`Platform:PlatformDashboardReadEnabled`) exposes the complete cluster.
> **What #81 still needs, counted honestly (the panel corrected an earlier "steps 1–4 done"):**
> the BACKEND half of steps 1–4 is done, but #81's own step-4 wording also requires an
> `apps/web/lib/platform-api/dashboard.ts` FE wrapper behind `NEXT_PUBLIC_…_VIA_CSHARP`, which does
> not exist for ANY of the thirteen reads (no slice-23 doc waived it — this sentence is the closest
> thing); step 5 (`verify dashboard`) has NEVER run (#211) and the flip is Federico's; and step 7
> (delete the TS) is open regardless.

## What shipped

The C# port of `getAiCostAnomalies` (`routers/platform/dashboard-upsell.ts:130`) in the slice-23
four-layer shape:

| Layer          | File                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Api            | `Tims.Api/PlatformDashboard/PlatformDashboardAiReadEndpoints.cs` (sibling file, PR-3 precedent)          |
| Application    | `PlatformDashboardAiModels.cs` · `IPlatformDashboardAiRepository.cs` · `PlatformDashboardAiUseCase.cs`   |
| Infrastructure | `PlatformDashboardAiRepository.cs` + three new entities on the EXISTING `PlatformDashboardReadDbContext` |
| Route          | `GET /platform/dashboard/ai-cost-anomalies`, gate-first, no input, dark                                  |

**Ledger: the slice's first REAL array change.** `ai_agents`, `ai_agent_org_configs` and
`ai_agent_usage_logs` are NEW `efcoreReadOnly[]` entries — nothing had ever `ToTable`-mapped them, so
unlike PRs 1–3's notes these entries are _enforced_ by `scripts/table-ownership.mjs`, not merely
recorded. Note key: `platform_dashboard_read_slice23_ai`.

## The semantics that were easy to get wrong (each is pinned)

1. **`monthlyBudget` truthiness** — TS guards the over-budget branch with
   `config.monthlyBudget && …`: `null` **and `0`** are falsy (a zero budget can never be exceeded),
   a **negative** budget is truthy (and `0 > −5` holds). Ported as
   `is { } budget && budget != 0 && monthlyCost > budget`.
2. **The two anomaly branches are independent `if`s, not `else if`** — reachable: a config with no
   usage and a negative budget emits BOTH `zero_usage` and `over_budget`.
3. **`toFixed(2)` is not `ToString("F2")`.** ECMAScript rounds the exact-expansion tie UP
   (`(0.125).toFixed(2) === "0.13"`); .NET Core 3.0+ `"F2"` rounds it to EVEN (`"0.12"`). And both
   differ from decimal intuition: `(1.005).toFixed(2) === "1.00"` because the double is
   `1.00499999999999989…`. `PlatformDashboardAiUseCase.JsToFixed2` reads the **exact** expansion
   (`"F99"` — a small precision like `F4` ROUNDS and misreads the double just below the half,
   `0.00499999999999999924… → "0.0050"`) and carries by string. Every doubtful case is pinned against
   values captured from Node on 2026-08-16.
4. **`totalPotentialSavings` accumulates in CONFIG SCAN order, before the sort.** Double addition is
   not associative; wastes `0.1 + 0.2 + 0.3` in scan order give `0.6000000000000001` while summing
   the sorted-desc list gives `0.6`. Summed in the loop, pinned by unit test.
5. **The sort is stable savings-DESC over an unordered `findMany`** — ties keep config row order,
   which the two stacks need not share (parity caveat 10).
6. **`'high_cost'` is declared and never produced** — the TS union has a third member no code path
   pushes. Reproduced as the same absence.
7. **The stub skip is `=== 'stub'`, not `!== 'active'`** — a `'beta'` agent participates.
8. **No datetime on the wire** — TRAP 6 (NodeIso converter) does not arise on this payload. (An
   earlier draft said "uniquely in this cluster"; the panel counted — plan-distribution, user-growth,
   customer-health and upsell are datetime-free too.) TRAPs 3/8 don't arise either:
   `ai_agents.status` is plain `text`, no native enum in any of the three tables. TRAP 11 still does:
   the 30-day bound re-kinds through `PlatformDashboardTimestamps.ToNaive`.

## Parity

Registered as the dashboard surface's 13th endpoint **WITH a `tsProcedure`** —
`platform.getAiCostAnomalies`. Unlike the three FX reads (caveat 8) both stacks read the SAME three
tables from the same database; no rate provider is involved, so the payload diff is real. New caveat
10 records what a green run does not cover: the per-stack rolling 30-day window (re-run, not
normalize), tie order = config scan order, and vacuous-green on a database with no enabled configs.
`seedDashboardAiAgents` (scripts/parity/seed.ts) makes a locally-seeded database non-vacuous: one
active agent producing BOTH anomaly types across the two orgs (savings 5.5 vs 0.5 — distinct, so the
harness's own rows never tie) plus a stub agent whose enabled config both kernels must skip.

Pins moved: `SURFACES.dashboard` 12 → 13 endpoints; globalScope 24 → 25; registry 66 → 67; deployed
operations 150 → 151 (header prose updated with the pins — the slice-22 lesson); allowlist gap HELD
at 84.

## Test evidence

- **Unit** (`PlatformDashboardAiUseCaseTests`, 32 passing): kernel branches, truthiness table,
  scan-order total, stable sort, `JsToFixed2` vs Node (16 cases incl. both carry paths and NaN), the
  kernel-level tie-value detail string, and `JsToFixed2_is_not_ToStringF2` (the guard for the guard).
- **Integration** (`PlatformDashboardAiEndpointAuthTests`, 7 passing): owner 200 / org-user 403 /
  missing+tampered JWT 401 / flag-default 404, the window-boundary inclusivity pin (added after the
  panel), and one exact-wire payload test over the full response — order, all nine keys per item,
  both detail strings, the literal `monthlyBudget: null`, totals, and the five decoys asserted
  absent (four assertions — the `job-matcher` slug covers both of that agent's decoy configs).
- **Anchors on this branch**: 1288 C# unit / **1453** C# integration (1447 + the 6 new endpoint
  tests; a first draft wrote "1449 (+2)" — the claim-auditor lens measured it) / 3185 vitest/319.
  The panel's window-boundary finding then added a seventh integration test (below), so the final
  branch anchor is **1454**.

## Mutation proofs — run 2026-08-16, results verbatim

Nine source mutations; each applied to a clean tree, rebuilt by `dotnet test` (Debug — the
configuration then executed), run, REVERTED, and the tree verified byte-clean (`git diff` empty)
before the next. All nine went RED; the failing test is named:

| #   | Mutation                                                                      | Result                                                   |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| M1  | Endpoint: gate result ignored (`_ = await PlatformOwnerGate…`, guard deleted) | RED — `OrdinaryOrgUser_Is403`                            |
| M2  | Repository: `where config.Enabled` deleted                                    | RED — `AiCostAnomalies_ClassifiedSortedAndSummed`        |
| M3  | Repository: `.Where(l => l.CreatedAt >= since)` deleted                       | RED — `AiCostAnomalies_ClassifiedSortedAndSummed`        |
| M4  | Kernel: over-budget `if` → `else if`                                          | RED — `A_negative_budget_…_yields_BOTH_anomalies`        |
| M5  | Kernel: `budget != 0` guard deleted                                           | RED — `A_null_or_zero_budget_is_never_exceeded…`         |
| M6  | Kernel: detail via `ToString("F2")` instead of `JsToFixed2`                   | RED — `The_detail_string_goes_through_JsToFixed2_not_F2` |
| M7  | Kernel: `OrderByDescending` → `OrderBy`                                       | RED — 2 tests (tie test + negative-budget order)         |
| M8  | Kernel: total recomputed as `sorted.Sum(…)`                                   | RED — `The_total_accumulates_in_CONFIG_SCAN_order…`      |
| M9  | Program.cs: AI mapping moved OUTSIDE the flag guard                           | RED — `Route_Is404_WhenFlagDefaultsOff`                  |

A tenth mutation followed from the panel's coverage lens: **M11 — window `>=` → `>`** survived every
prior test (the payload rows sit whole days from the bound), and is now killed by
`TheUsageWindow_IsInclusiveAtItsExactBoundary`, which drives the repository with `since` equal to the
exact `created_at` of the newest usage row — deterministic, no wall clock. Applied → RED
(`[FAIL] TheUsageWindow_IsInclusiveAtItsExactBoundary`) → reverted. The panel's other surviving
mutation — `JsNow()` → raw `DateTime.UtcNow` at the endpoint — is recorded as NOT pinned: its only
effect is sub-millisecond ticks in the window bound, unobservable on a `timestamp(3)` column.

M6 and M8 are worth a sentence each: both survived the ORIGINAL test set and were only killable
after two tests were added for exactly them (the fixture's values format identically under F2, and
its savings sum exactly) — the mutation question asked before the mutation run, per
[[feedback-audit-the-fixes-not-just-the-code]].

## The tier-3 panel (check 15's substitute) — what it found, and what was done

Codex is quota-blocked (gate check 15 = exit 2, NOT RUN), so the required substitute ran: a 3-lens
same-model adversarial panel (security/tenant-isolation, claim auditor, coverage), each lens prompted
to refute and re-reading source. **This is same-model review, not cross-model.** Findings and
dispositions:

- **MED (coverage)** — the parity seed is the first to write a GLOBAL catalog, and the app's own
  `seedAiAgents` bootstrap is count-guarded, so on an empty database the parity rows make it a
  permanent no-op; the fixture agents also join the live platform console's agent counts and its
  real anomalies panel. **Fixed**: seed docblock states both consequences + ordering guidance, and a
  runtime `console.warn` fires when no real agents exist.
- **LOW (security)** — fixture `updated_at` carried a `DEFAULT CURRENT_TIMESTAMP` prod does not
  have, and the fixture seed depended on it. **Fixed**: default removed, inserts supply the value —
  the same constraint the parity seed already documented.
- **LOW (security)** — fixture grants are SELECT-only vs prod's full DML. **Recorded, not changed**:
  it is the whole fixture's read-path convention, now stated in the schema comment.
- **LOW (coverage ×2)** — stale "twelve" in surfaces.ts caveat 8 and a surfaces.test.ts comment;
  the dormancy of the seeded over-budget leg. **Fixed**: counts corrected; dormancy added to caveat
  10 and the seed docblock — and the second pass then corrected the FIX itself: the panel's "~25
  days" was imprecise (the −5d row ages out at seed+25d, shrinking the overage; the flip to
  zero_usage happens at seed+28d when the −2d row follows).
- **LOW (coverage)** — two mutations survived all tests. **One fixed** (M11, the window boundary —
  new deterministic repository test), **one recorded** (JsNow → UtcNow, sub-millisecond only).
- **3 FALSE/OVERSTATED claims (claim auditor)** — the integration anchor ("1449/+2" vs measured
  1453/+6), "uniquely no datetime in this cluster", and "code-complete at steps 1–4" (the issue's
  step-4 FE wrapper does not exist; step 7 is open regardless). **All three corrected in this doc
  and REMAINING-WORK.md.** Every other audited claim — counts, pins, line refs, JS/.NET semantics —
  verified true, mostly by execution.

## What is deliberately NOT here

- **No cache** — the TS procedure has none (same fidelity argument as PR 2's six).
- **No `ORDER BY`** on either query — TS sends none; adding one would change tie behaviour parity
  compares.
- **No 503 path** — this read touches no `fx_rates` pin; caveat 9 stays scoped to the FX three.
- **Prod verification** — nothing on this surface has ever been observed against production beyond
  read-only SQL; `verify dashboard` has never run, by anyone (#211). The flip and the verify remain
  Federico's.
