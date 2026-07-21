# Phase 5 Slice 6 — Team-Intel READ surface → C# (strangler domain #4, dark)

**Status:** design (build pending) · **Branch:** `feat/csharp-phase5-team-intel-read`
**Flag:** `Platform:TeamIntelReadEnabled` (default `false`) · **Cutover:** deferred (Federico, at deploy)
**Ledger:** `efcoreReadOnly` (reads over Prisma-owned tables; NO ownership flip, NO new tables)

## Why this slice
The FOURTH strangler domain and the **first READ domain to wire the by-id `team` scope probe**
(`assertScoped('team', …)`), building directly on the `offer` probe root shipped in #151 and the
`requireOrgScope` org-gate shipped in the reporting slice (#150). It is a **pure-read, zero-write**
domain (no ownership-flip entanglement) and reuses the Phase-2 scope infrastructure wholesale
(`ScopedProbe`, `ScopeWhereFor`, `EfAnchorLoader` team anchors, `OrgGate`) — no re-port.

## Source surface (spec = live TS)
`packages/api/src/routers/teamIntel.ts` (7 `permissionProcedure('team_intel','read')` procedures) +
`packages/api/src/routers/team-intel-metrics.ts` (2 pure helpers). All reads; 2 are 501 stubs.

| # | Procedure | Scope mechanic | Body |
|---|-----------|----------------|------|
| 1 | `getTeamProfile({teamId})` | `assertScoped('team', teamId)` → then org-filtered fetch | team + leader(select incl. email) + businessUnit + members(user select) + `_count{vacancies,okrs}` |
| 2 | `getMembers({teamId})` | `assertScoped('team', teamId)` | `userTeam.findMany` where teamId, user select incl. email+createdAt, `orderBy joinedAt asc` |
| 3 | `getBalanceScore({teamId})` | `assertScoped('team', teamId)` | balance-score math (KERNEL) over members(jobTitle,createdAt) |
| 4 | `getBalanceAlerts({teamId})` | `assertScoped('team', teamId)` | **501 NOT_IMPLEMENTED** (Spanish msg) |
| 5 | `getRecommendedHires({teamId})` | `assertScoped('team', teamId)` | **501 NOT_IMPLEMENTED** (Spanish msg) |
| 6 | `compareTeams({teamIds[2..5]})` | `scopeWhereFor('team')` composed into `AND` | multi-team comparison math (KERNEL); out-of-scope ids drop |
| 7 | `getDashboardKpis()` | `requireOrgScope(ctx.access)` (narrow→403, **F3**) | org-rollup counts + `computeAvgTenureYears`/`computeRoleDiversity` (KERNEL); cached 45s in TS |

## Pure kernels — extract to `@tims/shared`, port to `Tims.Domain/TeamIntel/`, golden BOTH stacks
Per the honest-fixture rule (#141): extract into `@tims/shared`, make the TS router **return** the shared
function (behavior-preserving), and fixture against the REAL export — never a hand-rolled mirror.

1. **`computeAvgTenureYears(members: {createdAt}[], nowMs)`** — already pure in `team-intel-metrics.ts`,
   already takes `nowMs`. Move to `@tims/shared/team-intel.ts`. Formula: mean of
   `(nowMs - createdAt)/(365d ms)`, then `round(years*10)/10`. **365-day years.**
2. **`computeRoleDiversity(members: {jobTitle}[])`** — pure. `round((uniqueNonEmptyTitles/count)*100)/100`
   → **2-decimal ratio** (e.g. 0.67). Empty→0.
3. **`buildBalanceScore(members: {jobTitle,createdAt}[], nowMs)`** — extract from `getBalanceScore`. Returns
   `{memberCount, uniqueRoles, roleDiversity, avgTenureMonths, sizeScore, balanceScore}`.
   - tenureMonths = `(nowMs - createdAt)/(30d ms)` — **30-day months** (≠ the 365-day years above).
   - `avgTenureMonths = round(avgTenure*10)/10`.
   - `roleDiversity = count>0 ? round((uniqueRoles/count)*100) : 0` — **INTEGER percent** (⚠️ a DIFFERENT
     formula from kernel #2's 2-decimal ratio — both must be preserved verbatim; do NOT unify).
   - `sizeScore = count>=3 && count<=10 ? 100 : max(0, 100 - abs(count-7)*10)`.
   - `balanceScore = round((sizeScore + roleDiversity)/2)`.
4. **`buildTeamComparison(teams: {id,name,leader,members:{jobTitle,createdAt}[],openVacancies,activeOkrs}[], nowMs)`**
   — extract from `compareTeams`. Per team: `{teamId, teamName, leader, memberCount, uniqueRoles,
   avgTenureMonths(30-day, round*10/10), openVacancies, activeOkrs}`. Returns `{teams: [...]}`.

**Parity pins (each red-if-regressed):**
- All `Math.round` → JS half-up. Reuse `Tims.Domain.Reporting.ReportingMath.JsRound` (`Floor(x+0.5)`)
  — promote to a shared `Tims.Domain` math helper if cleaner, but do NOT use banker's rounding.
- 30-day months vs 365-day years divisors are intentional and different — pin both.
- Two roleDiversity formulas (integer-% in balanceScore vs 2-dec ratio in the KPI) — pin both.
- `nowMs` MUST be injected (TS `getBalanceScore`/`compareTeams` use inline `new Date()`; the C# use-case
  passes a single ms-truncated `now`, matching JS `Date.getTime()`, as reporting slice #150 did).
- `uniqueRoles` counts DISTINCT non-empty jobTitles (`.filter(Boolean)` → drop null/empty).

## Data plane (EF, read-only)
`Tims.Infrastructure/TeamIntel/TeamIntelReadDbContext` + entities + repository. Read-only (`AsNoTracking`)
over Prisma-owned tables under `TenantScope`/RLS. Most reads also carry an explicit `organizationId` filter
(defense-in-depth) over `teams`, `users`/leader, `business_units`, `vacancies`, `okrs`; the exception is the
`user_teams` membership join (`getMembers` + profile members), which filters by `teamId` only and relies on
TenantScope/RLS + the upstream `assertScoped('team')` probe — `user_teams` has no `organization_id` column
(matches TS).
No native enums here → NO `NpgsqlDataSource` holder (unlike billing). Timestamps `createdAt`/`joinedAt`
carried as UTC → epoch-ms client-side for the kernels. Ledger: add `teams`, `user_teams`, `business_units`,
`okrs` to `efcoreReadOnly` (users already present; verify). No flip, no new tables.

**Shapes = RAW model shape, no `schemaVersion`** (INTERNAL staff read — #141 lesson). `getTeamProfile`/
`getMembers` return leader/member details incl. email exactly as TS (team_intel:read is the authorized
reader; no k-anon in this surface — confirmed against live TS).

## Auth / endpoints (7 `GET`s, staff-JWT + `team_intel:read`)
New `Tims.Api/TeamIntel/TeamIntelStaffGate` — analog of `ReportingStaffGate` but grant = `team_intel:read`
and it RETURNS the resolved `decision.Scope` + principal context (it does NOT itself force the org-gate;
per-endpoint mechanics differ). 401 unresolved · 403 denied/null-scope · 400 privileged org-less.
- Endpoints 1–5 (`/team-intel/teams/{teamId}/…`): gate → `ScopedProbe.AssertScopedAsync('team', teamId,
  decision.Scope, anchorLoaderFactory)` (404-not-403, never confirms id) → fetch (endpoints 4/5 return
  501 after the probe). FIRST live `AssertScoped` wiring on a READ path (mirrors #151's write wiring).
- Endpoint 6 (`/team-intel/compare?teamIds=…`): gate → `ScopeWhereFor('team', decision.Scope, anchors)` →
  translate to SQL filter (reuse `ScopePredicateSqlTranslator`) → fetch teams in `teamIds ∩ scope ∩ org`.
- Endpoint 7 (`/team-intel/dashboard-kpis`): gate → **`OrgGate.RequireOrgScopeSatisfied(scope)` → 403 if
  narrow (F3)** → org-rollup counts. (No Redis cache in C#; the golden anti-drift is on the pure kernels.)
Dark `Platform:TeamIntelReadEnabled` (off ⇒ all 404 via `GetDocument.Insider` build-only OpenAPI).
Input validation AFTER auth (tRPC parity): `teamId` uuid; `compareTeams` 2..5 uuids.

## Regression corpus (bite-proven, Testcontainers on real RLS)
- `assertScoped('team')` IDOR: a `team`-scope caller reading a team they don't lead → **404** (all 5
  id-keyed endpoints); neutralize the probe → the out-of-scope test flips to pass (bite).
- `scopeWhereFor('team')` in `compareTeams`: out-of-scope teamIds silently drop from the result.
- `requireOrgScope` on `getDashboardKpis`: narrow team/unit/own `team_intel:read` → **403** (F3);
  use VALID staff roles so the gate bites the org-check, not a missing grant (the #150 lesson —
  team_lead/regional_manager slugs get DROPPED by the principal resolver → false-green).
- Kernel math parity: both roleDiversity formulas, 30-day vs 365-day divisors, JsRound half-up,
  avgTeamSize 1-dec, sizeScore piecewise. Empty team through `buildBalanceScore` is NOT all-zeros:
  `sizeScore = max(0, 100 - |0-7|*10) = 30`, `roleDiversity = 0`, `balanceScore = round((30+0)/2) = 15`
  (only `memberCount`/`uniqueRoles`/`avgTenureMonths` are 0). Just the STANDALONE metrics
  (`computeAvgTenureYears`/`computeRoleDiversity`) return `0` on an empty team.
- Honest 501 stubs: `getBalanceAlerts`/`getRecommendedHires` return NOT_IMPLEMENTED **after** the scope
  probe (no leak when implemented later).
- `getMembers` ordering: `joinedAt asc`.
- Endpoint auth matrix (WebApplicationFactory): grant→403, narrow-scope IDOR→404, JWT→401, dark→404.

## Gate (agent-driven SDD)
Fresh whole-branch reviewer GO + Codex adversarial (full-file; poll via codex-companion) → fix all
Crit/High/Med in-branch bite-proven → Codex RECHECK to PASS → opus whole-branch GO → PR →
`gh pr merge --squash --admin` past the CI billing trap. Local gate from `services/Tims.Platform`:
`dotnet build Tims.Platform.slnx -c Release` 0-warn · `dotnet format --verify-no-changes` · unit +
integration (Docker up) · from root `node scripts/table-ownership.mjs`; TS touched (shared kernel
extraction) → `pnpm --filter @tims/api exec tsc --noEmit` + `cd apps/web && npx tsc --noEmit` +
`npx vitest run`.

## Cutover (Federico, deferred — no traffic today)
Flip `Platform:TeamIntelReadEnabled` at canary → route FE team-intel reads → prod-verify → delete the TS
`teamIntel` router + `team-intel-metrics` (kernel stays shared until FE moves off tRPC). No table flip.
