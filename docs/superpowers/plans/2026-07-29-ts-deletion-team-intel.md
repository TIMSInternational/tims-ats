# TS Deletion: team-intel `getDashboardKpis` Implementation Plan

> ## ⚠️ SUPERSEDED IN PART — 2026-08-06 (#55). READ THIS BEFORE THE PLAN BELOW.
>
> This plan EXECUTED as written (commit `381f0a2b`, 2026-07-28) and its outcome stands. What is now
> stale is its **scope fence**, stated twice below and reproduced here so it is not followed by
> mistake:
>
> - _"Do NOT delete `packages/api/src/routers/teamIntel.ts` itself (6 other procedures still live there)"_
> - _"Do NOT touch `getTeamProfile`, `getMembers`, `getBalanceScore`, `getBalanceAlerts`,
>   `getRecommendedHires`, `compareTeams`"_
>
> **Both are obsolete.** Issue #55 deleted all six and removed `teamIntel.ts` outright (unregistered
> from `root.ts`). The router named throughout this document no longer exists.
>
> ### What #55 verified before deleting, per procedure
>
> Zero FE consumers for all six — `grep -rnE "getTeamProfile|getMembers|getBalanceScore|getBalanceAlerts|getRecommendedHires|compareTeams"`
> over `apps/web` returned exactly one hit, a stale TODO comment in `team-intel-kpis`' sibling
> `team-members-table.tsx:6` (since retargeted at the C# route). `apps/web/lib/platform-api/team-intel.ts`
> exposes only `useTeamIntelDashboardKpis`, and `talent/team-intelligence/page.tsx:16` is its only caller.
>
> C# replacement guard confirmed at `file:line` BEFORE each deletion, all in
> `services/Tims.Platform/src/Tims.Api/TeamIntel/TeamIntelReadEndpoints.cs`:
>
> | Procedure             | C# route                                       | Gate | Scope guard                     |
> | --------------------- | ---------------------------------------------- | ---- | ------------------------------- |
> | `getTeamProfile`      | `/team-intel/teams/{teamId}/profile`           | :53  | :60 → `AssertTeamScopeAsync` :314 |
> | `getMembers`          | `/team-intel/teams/{teamId}/members`           | :89  | :96 → same helper                |
> | `getBalanceScore`     | `/team-intel/teams/{teamId}/balance-score`     | :125 | :132 → same helper               |
> | `getBalanceAlerts`    | `/team-intel/teams/{teamId}/balance-alerts`    | :296 | :303, then 501 at :309           |
> | `getRecommendedHires` | `/team-intel/teams/{teamId}/recommended-hires` | :296 | :303, then 501 at :309           |
> | `compareTeams`        | `/team-intel/compare`                          | :204 | `ScopeWhereFor.BuildAsync` :222   |
>
> Each is covered by a REAL HTTP integration test, not a source grep:
> `TeamIntelReadEndpointAuthTests.cs:126-142` (`TeamScope_OutOfScopeTeam_Is404_IdorProbe`, a `[Theory]`
> over all five id-keyed leaves), `:183` (`OrgScope_Stubs_Are501`), `:193`/`:207`
> (`OrgScope_Compare_ReturnsBothTeams` / `TeamScope_Compare_DropsOutOfScopeTeam`), with `:145`
> (`OrgScope_OutOfTeamProfile_Is200`) as the control proving the 404 is scope and not RLS.
>
> ### What this plan got RIGHT and #55 upheld
>
> Its instruction to keep `team-intel-metrics.ts` and the `@tims/shared` helpers was correct and was
> NOT reversed. Those are not dead code: `packages/shared/src/team-intel.ts` is the executable
> specification the C# port is asserted against via `contracts/team-intel-fixtures/*`, and
> `team-intel-metrics.ts` is still imported by `tests/tier2/s-c-team-intel.test.ts`. Deleting either
> "because nothing calls it" would silently retire the C# port's only oracle. Both files now say so
> in their own headers.
>
> ### One claim in issue #55 that did NOT survive verification
>
> #55 asserted the six each had a "live, parity-verified C# equivalent". **"Parity-verified" is wrong.**
> The `team-intel` parity surface — removed by THIS plan, Step 4 — registered exactly one endpoint,
> `dashboard-kpis`. The other six were never TS-vs-C# diffed by the harness. `scripts/deploy/cutover.sh`'s
> note ("were never part of the C# cutover") was the accurate record; the issue was the wrong one.
>
> ### Gap #55 opened nothing new on, but did not close
>
> Because Step 4 removed the surface before `EndpointDef.tsProcedure` became optional (#57), those six
> deployed C# endpoints get no RLS Mode-A IDOR probe and no RBAC deny assertion from the parity harness.
> `checks/rls.ts` and `checks/rbac.ts` need only `callCsharp`, so a C#-only surface would restore them.
> Not done in #55; tracked separately.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-dead TS fallback for team-intel's `getDashboardKpis` read (its C# cutover flag, `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP`, is confirmed live in prod), and truth-up the parity/cutover tooling that still references the TS side.

**Architecture:** Same "router + wrapper only" scope established by the reporting/evaluation360 TS deletions (merged to `main` at `bd44f1f`): delete the dead procedure and its FE fallback branch, keep any shared helper modules as an orphaned-but-harmless rollback safety net, and update the parity-harness/cutover-doc registries that assumed a live TS side existed. Unlike reporting/evaluation360, this is a **single-procedure deletion inside a router that stays alive** — `packages/api/src/routers/teamIntel.ts` has 6 other procedures with zero FE consumers that are explicitly OUT OF SCOPE (pre-existing dead code unrelated to this migration) and must not be touched.

**Tech Stack:** tRPC (`packages/api`), Next.js/React Query (`apps/web`), TypeScript strict mode.

## Global Constraints

- Do NOT delete `packages/api/src/routers/teamIntel.ts` itself (6 other procedures still live there) or `packages/api/src/routers/team-intel-metrics.ts` / any `@tims/shared` helper (rollback safety net, matches reporting/evaluation360 precedent).
- Do NOT touch `getTeamProfile`, `getMembers`, `getBalanceScore`, `getBalanceAlerts`, `getRecommendedHires`, `compareTeams` — confirmed zero FE call sites, unrelated pre-existing dead code, out of scope for this migration work.
- `tsc --noEmit` must pass on both `@tims/api` and `@tims/web` after this change.
- Full `npx vitest run` (repo root) must pass, not just `tsc` (this project's established lesson: CI alone doesn't catch regressions).
- `.env.example`'s `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP` comment ("Anything other than 'true' ... keeps the tRPC path") becomes stale after this change (same known gap hit on reporting/evaluation360) — this repo's `.claude/settings.json` denies editing `.env.*` files for AI agents, so this task hands Federico the exact patch to apply himself rather than editing it directly.

---

### Task 1: Delete the dead TS code + truth-up parity/cutover tooling

**Files:**

- Modify: `apps/web/lib/platform-api/team-intel.ts` (rewrite: C#-only, no tRPC fallback)
- Modify: `packages/api/src/routers/teamIntel.ts` (delete the `getDashboardKpis` procedure + its now-unused imports)
- Modify: `scripts/parity/surfaces.ts` (remove the `'team-intel'` entry — no TS side left to diff)
- Modify: `scripts/deploy/cutover.sh` (team-intel's `case` branch: `verify`/`CONFIRMED_LIVE` → `NONE`/`TS_DELETED`)
- Modify: `scripts/deploy/README-cutover.md` (team-intel's table row: same status change)
- Test: none exist for this procedure/wrapper today (verified — no `.test.ts` file references `getDashboardKpis` or `teamIntelRouter`); this task relies on `tsc` + the full `vitest run` suite catching any regression, matching how this is a pure deletion with no new behavior to unit-test.

**Interfaces:**

- Consumes: nothing from earlier tasks (first and only task).
- Produces: `useTeamIntelDashboardKpis()` in `apps/web/lib/platform-api/team-intel.ts` — same exported name, same return shape (`UseQueryResult<DashboardKpis>`), same `DashboardKpis` interface fields, same React Query `queryKey` (`['platform-api', 'team-intel', 'dashboard-kpis']`) — so `apps/web/app/(admin)/talent/team-intelligence/page.tsx:16`'s call site (`const kpis = useTeamIntelDashboardKpis();`) needs zero changes.

- [ ] **Step 1: Rewrite the FE wrapper to call the C# service unconditionally**

Replace the entire contents of `apps/web/lib/platform-api/team-intel.ts` with:

```typescript
'use client';

// C#-only team-intelligence dashboard-KPIs read. The TS tRPC procedure
// (packages/api/src/routers/teamIntel.ts's getDashboardKpis) has been deleted — there is
// no TS fallback path left. NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP is confirmed live in
// prod (2026-07-27) and local dev's .env.local mirrors production values directly, so
// this file calls the C# service unconditionally rather than gating on the flag.

import { useQuery } from '@tanstack/react-query';
import { platformGet } from './client';

// The KPI data shape — identical field-for-field to the deleted tRPC getDashboardKpis
// output AND to the C# DashboardKpiView (all camelCase).
export interface DashboardKpis {
  totalTeams: number;
  totalMembers: number;
  teamsWithLeader: number;
  teamsWithoutLeader: number;
  avgTeamSize: number;
  avgTenureYears: number;
  diversityIndex: number;
}

/**
 * Returns the team-intel dashboard KPIs with a React Query result API
 * (`{ data, isLoading, isError, ... }`). GET /team-intel/dashboard-kpis.
 */
export function useTeamIntelDashboardKpis() {
  return useQuery<DashboardKpis>({
    queryKey: ['platform-api', 'team-intel', 'dashboard-kpis'],
    queryFn: async () => {
      const raw = await platformGet('/team-intel/dashboard-kpis');
      // Contract types the numeric fields as number|string (a minimal-API OpenAPI
      // number-as-string read artifact); coerce to number so the returned shape is
      // byte-identical to the old tRPC output.
      return {
        totalTeams: Number(raw.totalTeams),
        totalMembers: Number(raw.totalMembers),
        teamsWithLeader: Number(raw.teamsWithLeader),
        teamsWithoutLeader: Number(raw.teamsWithoutLeader),
        avgTeamSize: Number(raw.avgTeamSize),
        avgTenureYears: Number(raw.avgTenureYears),
        diversityIndex: Number(raw.diversityIndex),
      };
    },
  });
}
```

- [ ] **Step 2: Delete the `getDashboardKpis` procedure from the router**

In `packages/api/src/routers/teamIntel.ts`, delete the entire block from the `// ── Dashboard KPIs ──` comment through the end of the procedure — lines 189–246 (everything between `compareTeams`'s closing `}),` and the router's final closing `});`):

```typescript
  // ── Dashboard KPIs ───────────────────────────────────────────────────

  getDashboardKpis: permissionProcedure('team_intel', 'read')
    .query(async ({ ctx }) => {
      // Org-rollup dashboard aggregate → interim org-gate (slice-6 follow-up).
      requireOrgScope(ctx.access);

      const orgId = ctx.user.organizationId;

      type KpiResult = {
        totalTeams: number;
        totalMembers: number;
        teamsWithLeader: number;
        teamsWithoutLeader: number;
        avgTeamSize: number;
        avgTenureYears: number;
        diversityIndex: number;
      };

      // Safe to key on orgId alone: requireOrgScope() above gates this to org/company
      // callers only (no sub-org scope reaches here), so all callers see the identical
      // org rollup. If scope-aware aggregation is ever added, the key MUST include scope
      // identity (see vacancy/stats.ts).
      const cacheKey = `tims:kpis:teamintel:${orgId}`;
      const cached = await cacheGet<KpiResult>(cacheKey);
      if (cached) return cached;

      // NOTE on populations: `totalMembers` (the "Team Size" KPI) counts userTeam
      // membership rows, whereas `members` (used for tenure + diversity below) is the
      // org's active headcount. Different sets by design — each KPI is labeled independently.
      const [totalTeams, totalMembers, teamsWithLeader, members] = await Promise.all([
        db.team.count({ where: { organizationId: orgId, isActive: true } }),
        db.userTeam.count({
          where: { team: { organizationId: orgId, isActive: true } },
        }),
        db.team.count({
          where: { organizationId: orgId, isActive: true, leaderId: { not: null } },
        }),
        db.user.findMany({
          where: { organizationId: orgId, isActive: true },
          select: { createdAt: true, jobTitle: true },
        }),
      ]);

      const avgTeamSize = totalTeams > 0 ? Math.round((totalMembers / totalTeams) * 10) / 10 : 0;

      const result: KpiResult = {
        totalTeams,
        totalMembers,
        teamsWithLeader,
        teamsWithoutLeader: totalTeams - teamsWithLeader,
        avgTeamSize,
        avgTenureYears: computeAvgTenureYears(members, Date.now()),
        diversityIndex: computeRoleDiversity(members),
      };
      await cacheSet(cacheKey, result, 45);
      return result;
    }),
```

So the router now ends with `compareTeams`'s procedure followed directly by the closing `});` of `teamIntelRouter`.

- [ ] **Step 3: Remove the now-unused imports from the router**

`getDashboardKpis` was the only consumer of 3 imports. In `packages/api/src/routers/teamIntel.ts`, change:

```typescript
import { scopeWhereFor, assertScoped, requireOrgScope } from '../access';
import { computeAvgTenureYears, computeRoleDiversity } from './team-intel-metrics';
import { buildBalanceScore, buildTeamComparison } from '@tims/shared';
import { cacheGet, cacheSet } from '../lib/cache';
```

to:

```typescript
import { scopeWhereFor, assertScoped } from '../access';
import { buildBalanceScore, buildTeamComparison } from '@tims/shared';
```

(`scopeWhereFor` is still used by `compareTeams`, `assertScoped` by `getTeamProfile`/`getMembers`/`getBalanceScore`/`getBalanceAlerts`/`getRecommendedHires`, `buildBalanceScore`/`buildTeamComparison` by `getBalanceScore`/`compareTeams` — all confirmed still in use. `requireOrgScope`, `computeAvgTenureYears`, `computeRoleDiversity`, `cacheGet`, `cacheSet` had zero other call sites in this file.)

Leave `packages/api/src/routers/team-intel-metrics.ts` and its exports (`computeAvgTenureYears`, `computeRoleDiversity`) in place, unmodified — orphaned-but-harmless rollback safety net, matching the reporting/evaluation360 precedent of keeping service/repository layers around after deleting only the router-level dead code that called them.

- [ ] **Step 4: Remove the `team-intel` parity-harness surface entry**

In `scripts/parity/surfaces.ts`, delete the entire `'team-intel'` entry (its `tsProcedure: 'teamIntel.getDashboardKpis'` field now points at deleted code, so there is no TS side left to diff — same reason reporting/evaluation360's entries were removed):

```typescript
  'team-intel': {
    key: 'team-intel',
    flag: 'Platform__TeamIntelReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    // org-scoped (OrgGate) role that returns 200 for parity/RLS identity — chosen
    // explicitly, not by roles[] position; RLS/parity probes should use an
    // org-scoped role.
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'dashboard-kpis',
        csharpPath: '/team-intel/dashboard-kpis',
        tsProcedure: 'teamIntel.getDashboardKpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // tRPC superjson omits null-valued keys; the C# JSON response may still emit them
        // explicitly (e.g. a nullable KPI field with no data yet) — drop nullish on both
        // sides before diffing so that difference doesn't register as a false-positive parity break.
        normalize: { dropNullish: true },
      },
    ],
  },
```

Also delete the surface-registry doc-comment block directly above it (the `* ── team-intel ──...` JSDoc block, roughly 10 lines ending right before the `'audit-log'` section's comment starts) — it documents the now-deleted entry and would otherwise mislead a future reader into thinking the surface still exists.

- [ ] **Step 5: Update `scripts/deploy/cutover.sh`'s team-intel case branch**

Change (around line 64-66):

```bash
    team-intel)
      echo "read|TeamIntelReadEnabled|verify|team-intel|NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP|CONFIRMED_LIVE|Flipped + confirmed live in prod 2026-07-27 (Federico) — runbook intro + §6 Phase A #1. Reference/proof case for this whole script."
      ;;
```

to:

```bash
    team-intel)
      echo "read|TeamIntelReadEnabled|NONE|NONE|NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP|TS_DELETED|Runbook intro + §6 Phase A #1. UPDATE 2026-07-29: the TS getDashboardKpis procedure (packages/api/src/routers/teamIntel.ts) and its FE tRPC fallback (apps/web/lib/platform-api/team-intel.ts) have been deleted — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'team-intel' entry was removed too and there is no TS side left to diff against. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check. NOTE: teamIntel.ts's other 6 procedures (getTeamProfile, getMembers, getBalanceScore, getBalanceAlerts, getRecommendedHires, compareTeams) are untouched — they have zero FE consumers and were never part of the C# cutover."
      ;;
```

(mirrors the exact pattern already used for `reporting`/`evaluation360` in this same file.)

- [ ] **Step 6: Update `scripts/deploy/README-cutover.md`'s team-intel table row**

Change the `team-intel` row in the "Full flag-name mapping" table from:

```
| `team-intel`          | read  | `TeamIntelReadEnabled`      | `verify team-intel`          | `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP`      | CONFIRMED LIVE |
```

to:

```
| `team-intel`          | read  | `TeamIntelReadEnabled`      | `NONE` (TS router deleted)   | `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP`      | TS DELETED     |
```

(matches the `reporting`/`evaluation360` rows' exact format in the same table.)

- [ ] **Step 7: Verify — type-check both packages**

Run:

```bash
cd packages/api && npx tsc --noEmit
```

Expected: PASS, no errors (confirms no other file references the deleted `getDashboardKpis` procedure or the removed imports).

Run:

```bash
cd apps/web && npx tsc --noEmit
```

Expected: PASS, no errors (confirms `page.tsx`'s call site still type-checks against the rewritten wrapper, and no other file imports the removed `isPlatformApiEnabled`/`trpc` dependency from `team-intel.ts`).

- [ ] **Step 8: Verify — full test suite**

Run from repo root:

```bash
npx vitest run
```

Expected: PASS, same pass count as before this change (no test exercised the deleted procedure or wrapper branch, confirmed in the investigation above — this run is to catch any indirect regression, e.g. a snapshot or integration test that happens to exercise the teamIntel router as a whole).

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/platform-api/team-intel.ts packages/api/src/routers/teamIntel.ts scripts/parity/surfaces.ts scripts/deploy/cutover.sh scripts/deploy/README-cutover.md
git commit -m "refactor(team-intel): delete dead TS getDashboardKpis + truth-up cutover tooling

NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP has been live in prod since
2026-07-27; the TS procedure and its FE fallback branch were the only
remaining consumer of the tRPC path. Router stays alive for its other
6 (unrelated, zero-FE-consumer) procedures.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Hand Federico the `.env.example` patch (do not apply directly — this repo denies AI edits to `.env.*` files)**

Tell Federico the following patch is ready to apply to `.env.example` (around the `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP` line), and to change:

```
# Per-surface flag: route the team-intelligence dashboard KPIs read to the C# service.
# Requires NEXT_PUBLIC_TIMS_PLATFORM_API_URL to also be set. Anything other than the
# exact string 'true' (including unset) keeps the tRPC path. Default off.
NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP=false
```

to:

```
# Per-surface flag: was route the team-intelligence dashboard KPIs read to the C#
# service — NOW MOOT. The TS tRPC procedure has been deleted (2026-07-29); the C#
# read path is the sole implementation regardless of this flag's value.
NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP=true
```

## Self-Review

**Spec coverage:** Wrapper rewrite (Step 1), router procedure + import deletion (Steps 2-3), parity-harness truth-up (Step 4), cutover.sh + README-cutover.md truth-up (Steps 5-6), full verification (Steps 7-8), commit (Step 9), and the `.env.example` hand-off (Step 10, the one item this repo's own tooling won't let an AI apply directly) — every constraint listed at the top has a corresponding step.

**Placeholder scan:** No TBD/TODO/"add appropriate X" language — every step shows the exact before/after code or exact command + expected output.

**Type consistency:** `DashboardKpis` interface fields are identical between the old wrapper (read from the file) and the new one; `useTeamIntelDashboardKpis`'s name, return type, and `queryKey` are unchanged from the original, so the one FE call site (`talent/team-intelligence/page.tsx:16`) needs no changes.
