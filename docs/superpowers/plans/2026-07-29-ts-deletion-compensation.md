# Compensation TS-Deletion Implementation Plan (7 of 14 procedures)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-dead TS tRPC fallback for compensation's 7 flag-live, FE-consumed procedures (5 reads behind `NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP`, 2 writes behind `NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP` — both confirmed live in prod), leave the 3 FX-gated procedures and the 4 zero-consumer procedures completely untouched, and truth up every doc/tooling reference that assumed a live TS side existed. This is the 7th domain through this pattern (after reporting, evaluation360, team-intel, billing-usage, succession, nine-box).

**Architecture:** `packages/api/src/routers/compensation.ts` has 14 procedures in three categories and the DELETE/KEEP procedures **alternate** through the file, so this is a surgical per-procedure excision plus a careful import-prune pass (7 of ~20 imported symbols die). The router itself survives. `apps/web/lib/platform-api/compensation.ts` is the **first partial-rewrite wrapper in this migration**: 7 of its 10 hooks become C#-only with hand-declared types, while 3 hooks keep their exact current dual-path (tRPC + C# behind a flag) implementation _and_ keep the file's `inferRouterOutputs<AppRouter>` import for their 3 type aliases. Nine-box's "full C#-only rewrite, delete the AppRouter import" pattern does **not** apply here.

**Tech Stack:** tRPC (`packages/api`), Next.js 15 App Router + TanStack React Query (`apps/web`), TypeScript strict mode, Prisma (`@tims/db`), pure shaping kernels (`@tims/shared`), vitest (repo root).

## Global Constraints

- **DO NOT touch `getBandDistribution`, `getTotalCompBreakdown`, or `getDashboardKpis`** (router lines 40–104, 537–656, 705–771) or their three wrapper hooks (`useCompensationBandDistribution`, `useCompensationTotalCompBreakdown`, `useCompensationDashboardKpis`, wrapper lines 327–445). They are gated by `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP`, which was **independently re-verified absent from Vercel production on 2026-07-29** (`vercel env ls production | grep -i compensation` returns only `READ_VIA_CSHARP` and `WRITE_VIA_CSHARP`). Their tRPC implementations are the **live production path** for those 3 reads today. Deleting or modifying them breaks live prod traffic.
- **DO NOT touch `getPayEquity`, `simulateAdjustment`, `getMarketComparison`, `getEmployeeComp`** (router lines 139–181, 410–507, 509–535, 658–680). Zero FE call sites, pre-existing dead code unrelated to this migration, out of scope — same precedent as succession's `getCriticalRole` and nine-box's 6 survivors.
- **DO NOT delete `packages/api/src/routers/compensation.ts`** — 7 procedures survive, so `packages/api/src/root.ts:19,71` needs no change.
- **DO NOT delete `packages/api/src/services/compensation.service.ts`** — `getEmployeeCompForSubject` is still called by the surviving `getEmployeeComp`.
- **DO NOT delete the `@tims/shared` kernels** `buildCompaRatioDistribution` / `buildBenefitsUtilization` (`packages/shared/src/compensation.ts:53,194`) or their types. They are golden-fixtured against the C# port (`contracts/compensation-fixtures/` + `tests/compensation/*-fixtures.test.ts`) — deleting them would delete a live cross-stack contract test. Router+wrapper-only scope, same as all 6 prior domains.
- **`tsc --noEmit` on `@tims/api` is the AUTHORITY on which router imports actually went unused.** The import table in Step 8 is a prediction; verify it with a real tsc run (Step 9), do not trust it blindly.
- Full `npx vitest run` (repo root) must pass — `tsc` alone is not sufficient, because 6 of the 7 affected test files are runtime-caller or source-string tests that `tsc` will never see. Record the REAL before/after counts by actually running it (Steps 1 and 42). Predicted delta is −31 tests / 0 files, but **assert the number you measured, never the predicted one** (this migration has been burned twice by unverified numbers).
- **`scripts/parity/surfaces.ts`'s `compensation` entry must be SHRUNK (7 → 2 endpoints), not removed.** `market-comparison` and `employee` map to zero-FE-consumer procedures that stay live, so `verify compensation` keeps running a REAL (smaller) check.
- **Because the read-side parity check stays real, the `cutover.sh` / `README-cutover.md` read status must be `CONFIRMED_LIVE`, NOT `TS_DELETED`,** and `parity_command` stays `verify` (not `NONE`). Do NOT add `compensation` to `README-cutover.md`'s "no parity command left" list.
- **`compensation-write` keeps status `COEXISTENCE`** (it describes table ownership, which is _more_ true after this change — `employee_compensations` is still read in TS by `getTotalCompBreakdown`/`getDashboardKpis`/`getPayEquity`/`simulateAdjustment`), with an appended UPDATE clause noting the TS mutations are deleted and the flag is confirmed live. Do NOT change it to `CONFIRMED_LIVE`.
- **SECURITY REVIEW NOTE (mandatory, per CLAUDE.md "Security changes require explicit review note").** Deleting `createAdjustment`/`approveAdjustment` removes 11 TS-side tests that are the **only TypeScript tripwires** for two §21 guarantees: (a) the _minimal-select_ invariant (a write response must never echo an unselected `SalaryAdjustment` row — 7 tests in `tests/access/scope-wiring-sensitive-data.test.ts:461–516`), and (b) the _atomic conditional state transition_ on approve (`$transaction` + `updateMany where status:'pending'` + `count === 0` → `CONFLICT` + in-transaction `employee_compensations` propagation — 4 tests at `:518–546`). After this change those guarantees live **only** in the C# implementation plus `scripts/parity/write-surfaces.ts`'s `readbackMutated`/`readbackNoMutation` raw-SQL readbacks (which do assert both the transaction side-effect and the no-leak case). This is an **accepted, deliberate tradeoff**, identical in kind to every other completed domain in this migration (the TS side is being retired, not weakened), not an oversight. This note MUST appear in the task description, in the final commit message, and in any PR body.
- **`scripts/parity/README.md:3` is explicitly OUT OF SCOPE** (see Step 40). Its claim that `verify compensation` covers "Candidate, Team, Intel, and premium assessments" is **already factually wrong today** and is not caused by this change. Same precedent as `0901624` deferring `docs/API-SPEC.md` drift on the nine-box branch. Do not fix it here.
- No `any`, no `@ts-ignore`, no unbounded inputs, no new dependencies. Every hook name, parameter list, and return shape must stay byte-stable so FE call sites need zero changes (the only call-site edits in this plan are the two modals' dead `invalidate()` lines).
- Branch: `refactor/ts-deletion-compensation`, forked from `main` at `ba623cf` (nine-box already merged, so `apps/web/lib/platform-api/compensation.ts:11` is already in its post-nine-box-review-fix state — every "Before" quote below was taken from that state).

---

### Task 1: Delete compensation's 7 dead TS procedures + their wrapper fallbacks, and truth up parity/cutover/doc tooling

> **SECURITY REVIEW NOTE (repeat — do not drop this from the commit message):** this task deletes the TS `createAdjustment`/`approveAdjustment` procedures and with them 11 tests that were the only TS-side assertions of the §21 minimal-select and atomic-conditional-transition guarantees. Those guarantees now live exclusively in the C# implementation + `scripts/parity/write-surfaces.ts`'s SQL readbacks. Accepted, deliberate tradeoff — consistent with every other completed domain in this migration.

**Files:**

- Modify: `packages/api/src/routers/compensation.ts:1-19` (prune 4 dead imports), `:22-39`, `:106-138`, `:183-218`, `:219-409`, `:682-704` (delete 7 procedures)
- Modify: `apps/web/lib/platform-api/compensation.ts:1-43` (header), `:45-69` (imports/types/flags), `:82-325` (5 read hooks → C#-only), `:447-461` (writes header + flag), `:491-529` (2 write hooks → C#-only)
- Modify: `apps/web/app/(admin)/compensation/approve-adjustment-modal.tsx:28-36`
- Modify: `apps/web/app/(admin)/talent/succession/request-adjustment-modal.tsx:25-33`, `:50-56`
- Modify: `tests/access/scope-wiring-compensation.test.ts:8-25`, `:38-43`, `:52-58`, `:60-64`, `:116-120`
- Modify: `tests/access/scope-wiring-sensitive-data.test.ts:16-26`, `:307-310`, `:436-441`, `:449-452`, `:455-546`
- Modify: `tests/access/scope-wiring-employee-self-service.test.ts:5-6`, `:14-17`, `:24`, `:73-105`
- Modify: `tests/dei/comp-field-auth.test.ts:4-9`, `:17`, `:23`, `:57`, `:163-205`
- Modify: `tests/dei/comp-distribution-suppression.test.ts:4-9`, `:40-44`, `:72-73`, `:79-145`
- Modify: `tests/dei/sub-floor-aggregate-leaks.test.ts:8`, `:100`, `:114-115`, `:121-157`
- Modify: `tests/tier1/s3-compensation-wiring.test.ts:13-20`, `:30-39`
- Modify: `scripts/parity/surfaces.ts:60-142` (shrink 7 → 2 endpoints, rewrite header comment)
- Modify: `scripts/parity/surfaces.test.ts:5-15`
- Modify: `scripts/parity/write-surfaces.ts:193-198` (append an UPDATE clause — comment only, no code change)
- Modify: `scripts/deploy/cutover.sh:82-84` (read row → `CONFIRMED_LIVE`), `:109-110` (write row note)
- Modify: `scripts/deploy/README-cutover.md:31-62` (retarget worked example to `dei`), `:122`, `:131`
- Modify: `.env.example:112-117`, `:119-120`
- Modify: `docs/REMAINING-WORK.md:81-87`, `:104-106`, `:120-122`, `:153-161`, `:256`
- Modify: `tools/test-apis.sh:138`
- Modify: `apps/web/lib/platform-api/dei.ts:11-12`, `apps/web/lib/platform-api/engagement.ts:10`, `apps/web/lib/platform-api/billing.ts:302`
- Modify: `packages/api/src/services/compensation.service.ts:12-14`
- Modify: `packages/shared/src/compensation.ts:5-7`
- Modify: `tests/compensation/compa-ratio-distribution-fixtures.test.ts:4-5`, `tests/compensation/benefits-utilization-fixtures.test.ts:4-5`
- Modify: `apps/web/app/(admin)/compensation/comp-right-column.tsx:14`
- Confirm-only (no change expected): `packages/api/src/root.ts`, `apps/web/lib/trpc-types.ts`, `scripts/parity/seed.ts`, `scripts/parity/write-surfaces.test.ts`, `scripts/parity/checks/rls.ts:54`, `scripts/parity/surfaces.ts`'s DEI FX back-reference (~`:443`), `tests/compensation/comp-fx-shaping-fixtures.test.ts:6`, `apps/web/lib/platform-api/schema.d.ts`, `apps/web/lib/nav/manifest.ts`, `contracts/compensation-fixtures/`, `services/Tims.Platform/**`
- Explicitly OUT OF SCOPE: `scripts/parity/README.md:3` (pre-existing wrong description, see Step 40), `docs/API-SPEC.md` (deferred by the nine-box precedent `0901624`)

**Interfaces:**

- Consumes: nothing from earlier tasks (first and only task).
- Produces: these 10 exported hook names, params, and return shapes stay **stable** so every FE call site is unchanged apart from the two modals' dead `invalidate()` lines:
  - `useCompensationSalaryBands(filters?: { companyId?: string })` → `UseQueryResult<SalaryBandsOutput>` _(now C#-only)_
  - `useCompensationBenefitsUtilization()` → `UseQueryResult<BenefitsUtilizationOutput>` _(now C#-only)_
  - `useCompensationCompaRatioDistribution(filters?: { companyId?: string; businessUnitId?: string })` → `UseQueryResult<CompaRatioDistributionOutput>` _(now C#-only)_
  - `useCompensationListPendingAdjustments()` → `UseQueryResult<PendingAdjustmentsOutput>` _(now C#-only)_
  - `useCompensationMyCompensation()` → `UseQueryResult<MyCompensationOutput>` _(now C#-only)_
  - `useCompensationBandDistribution()` → **unchanged dual-path**
  - `useCompensationTotalCompBreakdown()` → **unchanged dual-path**
  - `useCompensationDashboardKpis()` → **unchanged dual-path**
  - `useCompensationCreateAdjustment(options?: MutationOptions)` → `UseMutationResult` _(now C#-only)_
  - `useCompensationApproveAdjustment(options?: MutationOptions)` → `UseMutationResult` _(now C#-only)_
- New/changed type names inside `apps/web/lib/platform-api/compensation.ts` (all module-local, none exported): `SalaryBandRow`, `SalaryBandsOutput`, `BenefitsUtilizationOutput` (= `BenefitUtilizationItem[]`, imported from `@tims/shared`), `CompaRatioDistributionOutput` (= `CompaRatioDistribution`, imported from `@tims/shared`), `PendingAdjustmentRow`, `PendingAdjustmentsOutput`, `MyCompensationDto`, `MyCompensationOutput`, `AdjustmentMutationResult`, `CreateAdjustmentOutput`, `ApproveAdjustmentOutput`. Unchanged and still inferred from `AppRouter`: `RouterOutput`, `BandDistributionOutput`, `TotalCompBreakdownOutput`, `CompDashboardKpisOutput`.

---

- [ ] **Step 1: Record the pre-change baseline (REQUIRED before any edit)**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
git branch --show-current   # must print: refactor/ts-deletion-compensation
git log --oneline -1        # should be the plan-doc commit on top of ba623cf

pnpm --filter @tims/api exec tsc --noEmit
(cd apps/web && npx tsc --noEmit)
npx vitest run 2>&1 | tail -20
```

Write the exact numbers down — you will assert the delta against them in Step 48:

```
BASELINE (fill in from the run above):
  vitest tests   : ____ passed
  vitest files   : ____ passed
  tsc @tims/api  : clean / not clean
  tsc apps/web   : clean / not clean
```

If either `tsc` is already dirty on a clean checkout, STOP and report — do not start deleting on top of a broken baseline.

---

- [ ] **Step 2: Re-verify the router line numbers before editing**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
grep -n "^  getSalaryBands:\|^  getBandDistribution:\|^  getCompaRatioDistribution:\|^  getPayEquity:\|^  getBenefitsUtilization:\|^  listPendingAdjustments:\|^  createAdjustment:\|^  approveAdjustment:\|^  simulateAdjustment:\|^  getMarketComparison:\|^  getTotalCompBreakdown:\|^  getEmployeeComp:\|^  myCompensation:\|^  getDashboardKpis:" packages/api/src/routers/compensation.ts
wc -l packages/api/src/routers/compensation.ts
```

Expected (as of `ba623cf`): file is **773 lines**; procedure starts at `25, 55, 109, 142, 188, 222, 276, 338, 410, 512, 551, 662, 690, 717` respectively. If these have drifted, re-anchor every deletion below on the quoted text rather than the line numbers.

---

- [ ] **Step 3: Delete `myCompensation` from the router (bottom-up, so earlier line numbers stay stable)**

In `packages/api/src/routers/compensation.ts`, delete lines **682–704** — the whole block below plus the blank line that follows it (the next surviving line must be `  // ── Dashboard KPIs ─────...`):

Before (delete exactly this):

```ts
  // ── My Compensation (Slice 5B) ─────────────────────────────────────
  // OWN-scoped self-service read. No input → the subject is HARD-PINNED to
  // ctx.user.id (never a client-supplied userId, which would widen). Routes
  // through the SAME getEmployeeCompForSubject service as getEmployeeComp, so
  // the field-level selectFor gating AND the restricted-data audit are
  // preserved identically. assertSubjectInScope(own scope, subject == actor)
  // passes trivially. No requireOrgScope — this is own, not an org rollup. A
  // missing comp row returns null gracefully (not an error) for the landing UI.
  myCompensation: permissionProcedure('compensation', 'read').query(async ({ ctx }) => {
    return getEmployeeCompForSubject(
      ctx.access,
      ctx.user.organizationId,
      ctx.user.id,
      ctx.user.id, // subject hard-pinned to the caller — own-only, no widening
      {
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
        ipAddress: ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
        userAgent: ctx.headers.get('user-agent'),
      },
      'No puedes ver esta compensacion',
    );
  }),

```

After: nothing (the `getEmployeeComp` procedure's closing `  }),` is now immediately followed by a blank line and then `  // ── Dashboard KPIs ─────...`).

---

- [ ] **Step 4: Delete `listPendingAdjustments` + `createAdjustment` + `approveAdjustment` from the router**

Delete lines **219–409** — the contiguous block starting at the `  // ── Adjustments ───...` section header and ending with `approveAdjustment`'s closing `    }),` plus the blank line after it. The next surviving line must be `  simulateAdjustment: permissionProcedure('compensation', 'read')`.

The block to delete starts with:

```ts
  // ── Adjustments ────────────────────────────────────────────────────
  // Row-level: each SalaryAdjustment is anchored on userId (the employee being
  // adjusted). Compose the salaryAdjustment scope fragment via AND.
  listPendingAdjustments: permissionProcedure('compensation', 'read').query(async ({ ctx }) => {
```

…and ends with:

```ts
      return { id: input.id, status: newStatus };
    }),

```

Verify after the edit:

```bash
grep -n "listPendingAdjustments\|createAdjustment\|approveAdjustment" packages/api/src/routers/compensation.ts
# expected: no output
```

---

- [ ] **Step 5: Delete `getBenefitsUtilization` from the router**

Delete lines **183–218** — the `  // ── Benefits Utilization ───...` header through the procedure's closing `    }),` plus the trailing blank line. Because Step 4 already removed the `// ── Adjustments ──` block that used to follow it, the next surviving line after this deletion is `  simulateAdjustment: permissionProcedure('compensation', 'read')`.

Before (delete exactly this):

```ts
  // ── Benefits Utilization ───────────────────────────────────────────
  // Org-scope gate only. Per-plan `enrolled` is a head-count that could be <5 in a
  // small org — benefits enrollment is NOT in the §21 sensitive-data matrix, so
  // min-5 suppression for it is a deliberate follow-on (recorded in REMAINING-WORK),
  // not silently assumed here.
  getBenefitsUtilization: permissionProcedure('compensation', 'read')
    .input(
      z.object({ companyId: z.string().uuid().optional() }).optional(),
    )
    .query(async ({ ctx }) => {
      requireOrgScope(ctx.access);
      const benefits = await db.benefitPlan.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        include: {
          _count: { select: { enrollments: true } },
        },
        orderBy: { name: 'asc' },
      });

      const totalUsers = await db.user.count({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
        },
      });

      // Per-plan utilization is now the pure buildBenefitsUtilization kernel (@tims/shared, golden-fixtured
      // both stacks). The router returns it verbatim — honest-fixture rule. NO min-5 (deliberate).
      return buildBenefitsUtilization(
        benefits.map((b) => ({ id: b.id, name: b.name, category: b.type, enrolled: b._count.enrollments })),
        totalUsers,
      );
    }),

```

---

- [ ] **Step 6: Delete `getCompaRatioDistribution` from the router**

Delete lines **106–138** — the `  // ── Compa-Ratio Distribution ───...` header through the procedure's closing `    }),` plus the trailing blank line. The next surviving line must be `  // ── Pay Equity ─────...`.

Before (delete exactly this):

```ts
  // ── Compa-Ratio Distribution ───────────────────────────────────────
  // Org-scope gated; min-5 suppression applied to bucket counts below (defense-in-
  // depth on top of requireOrgScope, NOT a replacement — the gate stays).
  getCompaRatioDistribution: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      requireOrgScope(ctx.access);
      const compensations = await db.employeeCompensation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        select: {
          id: true,
          currentSalary: true,
          compaRatio: true,
          userId: true,
        },
      });

      // The six-bucket min-5 compa-ratio distribution is now the SINGLE pure kernel the C# port mirrors
      // (buildCompaRatioDistribution in @tims/shared, golden-fixtured both stacks). The router returns it
      // verbatim — honest-fixture rule — preserving every anonymity guard (positive-salary bucketing,
      // contributor-count avg floor, all-or-nothing empty distribution, totalEmployees == positiveCount).
      return buildCompaRatioDistribution(
        compensations.map((c) => ({ currentSalary: Number(c.currentSalary) || 0, compaRatio: c.compaRatio })),
      );
    }),

```

---

- [ ] **Step 7: Delete `getSalaryBands` from the router**

Delete lines **22–39** — the `  // ── Salary Bands ───...` header through the procedure's closing `    }),` plus the trailing blank line. `export const compensationRouter = router({` (line 21) must now be immediately followed by `  // ── Band Distribution (employees plotted within their band) ────────`.

Before (delete exactly this):

```ts
  // ── Salary Bands ───────────────────────────────────────────────────
  // Org-level catalog: band definitions contain no per-person salary data.
  // Scoping is unnecessary and would break HR-admin band management.
  getSalaryBands: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      return db.salaryBand.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        orderBy: [{ level: 'asc' }],
      });
    }),

```

---

- [ ] **Step 8: Prune the router's now-dead imports**

Four symbols become unused: `TRPCError` (was only used at old `:309` and `:394`), `type { Prisma }` (only old `:223`), `scopeWhereFor` (only old `:223`), `assertScoped` (only old `:349`).

`packages/api/src/routers/compensation.ts` lines 1–19, before:

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import {
  scopeWhereFor,
  assertScoped,
  assertSubjectInScope,
  requireOrgScope,
  suppressBelowMin5,
  logDataAccess,
  selectFor,
} from '../access';
import { getEmployeeCompForSubject } from '../services/compensation.service';
import { convertMoney, sumMoney } from '../lib/currency';
import {
  normalizeCurrencyCode,
  buildCompaRatioDistribution,
  buildBenefitsUtilization,
  buildBandDistribution,
  buildCompPayEquity,
  buildTotalCompBreakdown,
  buildCompDashboardKpis,
  buildSimulateAdjustment,
  type BandDistributionRowInput,
} from '@tims/shared';
```

After:

```ts
import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { assertSubjectInScope, requireOrgScope, suppressBelowMin5, logDataAccess, selectFor } from '../access';
import { getEmployeeCompForSubject } from '../services/compensation.service';
import { convertMoney, sumMoney } from '../lib/currency';
import {
  normalizeCurrencyCode,
  buildBandDistribution,
  buildCompPayEquity,
  buildTotalCompBreakdown,
  buildCompDashboardKpis,
  buildSimulateAdjustment,
  type BandDistributionRowInput,
} from '@tims/shared';
```

Every surviving symbol is still referenced by a surviving procedure: `z` (getPayEquity/getMarketComparison/getTotalCompBreakdown/getEmployeeComp/simulateAdjustment inputs), `db`, `assertSubjectInScope` (simulateAdjustment), `requireOrgScope` (getBandDistribution/getPayEquity/getTotalCompBreakdown/getDashboardKpis — 4 calls), `suppressBelowMin5` (getTotalCompBreakdown ×4, getDashboardKpis ×1), `logDataAccess` (simulateAdjustment), `selectFor` (simulateAdjustment), `getEmployeeCompForSubject` (getEmployeeComp), `convertMoney`/`sumMoney`, `normalizeCurrencyCode`, the 5 surviving kernels, `BandDistributionRowInput`.

---

- [ ] **Step 9: Verify the import prune with a real tsc run (this is the authority, not the table above)**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
pnpm --filter @tims/api exec tsc --noEmit
```

Must be clean. If tsc reports an unused-import or unresolved-symbol error, the table in Step 8 was wrong for that symbol — fix from the tsc output, not from the table. Also sanity-check no orphaned references survive:

```bash
grep -n "TRPCError\|Prisma\.\|scopeWhereFor\|assertScoped\|buildCompaRatioDistribution\|buildBenefitsUtilization" packages/api/src/routers/compensation.ts
# expected: no output
```

---

- [ ] **Step 10: Rewrite the FE wrapper's file header**

`apps/web/lib/platform-api/compensation.ts` lines **3–43** (everything between `'use client';` and the `import` block). Replace the whole comment block.

Before (lines 3–43 — the "FIVE FE-consumed FX-FREE… DARK by default", "Mirrors lib/platform-api/{access-review,audit-log,billing,dei,engagement}.ts exactly", "SCOPE — FX-FREE subset (Slice-9)", "FIELD-AUTH NUANCE", "All five live behind…", and "FX-DEPENDENT SUBSET (Slice 11c…)" paragraphs).

After:

```ts
// Compensation FE data layer — a SPLIT file, unlike every other platform-api wrapper.
//
// C#-ONLY (7 of the 10 hooks below). Their TS tRPC procedures were DELETED on 2026-07-29:
// getSalaryBands / getBenefitsUtilization / getCompaRatioDistribution / listPendingAdjustments /
// myCompensation (reads) and createAdjustment / approveAdjustment (writes). Both
// NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP and NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP were
// confirmed live in prod on 2026-07-28, so these hooks call the C# service unconditionally and no
// longer read either flag — both flags are now DEAD (see .env.example). Their output types are
// hand-declared below, or re-sourced from the @tims/shared kernels the C# port is golden-fixtured
// against, because no tRPC procedure remains to infer them from.
//
// STILL DUAL-PATH (3 hooks): useCompensationBandDistribution / useCompensationTotalCompBreakdown /
// useCompensationDashboardKpis. These are the FX-DEPENDENT reads (getBandDistribution /
// getTotalCompBreakdown / getDashboardKpis), gated by a DIFFERENT backend flag
// (`Platform:FxReadsEnabled`, shared cross-domain with `dei.getPayEquity` — see platform-api/dei.ts's
// header) and by their OWN FE flag, NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP, which does NOT exist
// in Vercel yet (blocked on seeding `fx_rates` via the first FxRefreshJob run — see
// docs/architecture/csharp-migration/fx-seed-once-runbook.md). Their tRPC procedures are the LIVE
// PRODUCTION PATH for those 3 reads today and are DELIBERATELY RETAINED in
// packages/api/src/routers/compensation.ts. ONLY these 3 hooks still mirror the
// lib/platform-api/{access-review,audit-log,billing,dei,engagement}.ts pattern (each calls BOTH the
// tRPC hook, enabled when NOT viaCSharp, and a C# useQuery, enabled when viaCSharp, then returns the
// active one), and only they keep an inferRouterOutputs<AppRouter> type alias — compile-time-locked
// to the still-live contract.
//
// NOT WRAPPED AT ALL: getPayEquity (compensation's own — distinct from the DEI domain's
// `dei.getPayEquity`, wrapped in platform-api/dei.ts), simulateAdjustment, getMarketComparison and
// getEmployeeComp have zero FE call sites and get no hook here; their TS procedures stay live and
// untouched.
//
// FIELD-AUTH NUANCE (my-compensation + pending-adjustments): the C# OpenAPI types these 200 bodies as
// free-form `object` (JsonObject / oneOf[null,object]) — the field-authed shape is dynamic (restricted
// keys ABSENT for lower tiers, not null), so platformGet returns a loosely typed object. Each wrapper
// reads the raw object through a lens, maps it to the hand-declared shape PRESERVING key absence (no
// null injected for an absent restricted key), then casts. The field-auth guarantees are enforced
// server-side by the C# implementation + its integration tests; the FE wrapper only needs
// shape-compatibility. No `any`.
```

---

- [ ] **Step 11: Update the wrapper's imports**

Lines **45–49**, before:

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet, platformPost } from './client';
```

After (one added line — everything else stays, because the 3 FX hooks still need `trpc`, `isPlatformApiEnabled`, `inferRouterOutputs` and `AppRouter`):

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import type { BenefitUtilizationItem, CompaRatioDistribution } from '@tims/shared';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet, platformPost } from './client';
```

`@tims/shared` is already a declared dependency of `apps/web` (`apps/web/package.json:26`) and `apps/web/lib/platform-api/succession.ts:15` already imports types from it — no new dependency.

---

- [ ] **Step 12: Replace the wrapper's type-alias block**

Lines **51–61**, before:

```ts
type RouterOutput = inferRouterOutputs<AppRouter>;
type SalaryBandsOutput = RouterOutput['compensation']['getSalaryBands'];
type BenefitsUtilizationOutput = RouterOutput['compensation']['getBenefitsUtilization'];
type CompaRatioDistributionOutput = RouterOutput['compensation']['getCompaRatioDistribution'];
type PendingAdjustmentsOutput = RouterOutput['compensation']['listPendingAdjustments'];
type MyCompensationOutput = RouterOutput['compensation']['myCompensation'];
type BandDistributionOutput = RouterOutput['compensation']['getBandDistribution'];
type TotalCompBreakdownOutput = RouterOutput['compensation']['getTotalCompBreakdown'];
type CompDashboardKpisOutput = RouterOutput['compensation']['getDashboardKpis'];
type CreateAdjustmentOutput = RouterOutput['compensation']['createAdjustment'];
type ApproveAdjustmentOutput = RouterOutput['compensation']['approveAdjustment'];
```

After:

```ts
// The 3 FX-gated hooks still have a live tRPC procedure, so their types stay INFERRED from the
// router contract — the dual-path mappers below remain compile-time-locked to it.
type RouterOutput = inferRouterOutputs<AppRouter>;
type BandDistributionOutput = RouterOutput['compensation']['getBandDistribution'];
type TotalCompBreakdownOutput = RouterOutput['compensation']['getTotalCompBreakdown'];
type CompDashboardKpisOutput = RouterOutput['compensation']['getDashboardKpis'];

// The 7 C#-only hooks' output types are hand-declared (there is no tRPC procedure left to infer
// from). Shapes mirror what the deleted procedures returned, so every call site is unchanged.

// Prisma `SalaryBand` scalar row (packages/db/prisma/schema/compensation.prisma:1-19). The deleted
// getSalaryBands was a bare findMany with no `select`, so the tRPC output was the full 11-field row
// with superjson-rebuilt Dates — exactly what the mapper below produces. Every status/type column in
// that schema file is a plain `String` (no Prisma enums), so nothing is a union type.
interface SalaryBandRow {
  id: string;
  organizationId: string;
  level: string;
  title: string | null;
  minSalary: number;
  midSalary: number;
  maxSalary: number;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
type SalaryBandsOutput = SalaryBandRow[];

// buildBenefitsUtilization / buildCompaRatioDistribution are the pure @tims/shared kernels the
// deleted procedures returned verbatim AND the C# port is golden-fixtured against
// (contracts/compensation-fixtures/*), so sourcing these two shapes from @tims/shared keeps the FE
// contract-locked to the one definition both stacks share.
type BenefitsUtilizationOutput = BenefitUtilizationItem[];
type CompaRatioDistributionOutput = CompaRatioDistribution;

// Field-authed dynamic shape: id/createdAt/user/requester are always present; the restricted salary
// keys are PRESENT for entitled tiers (super/hr; type/status also hrbp) and ABSENT otherwise — never
// nulled. Optional keys model exactly that.
interface PendingAdjustmentRow {
  id: string;
  createdAt: Date;
  previousSalary?: number;
  newSalary?: number;
  currency?: string;
  reason?: string | null;
  type?: string;
  status?: string;
  user: { id: string; firstName: string; lastName: string; jobTitle: string | null };
  requester: { id: string; firstName: string; lastName: string };
}
type PendingAdjustmentsOutput = PendingAdjustmentRow[];

// Mirrors EmployeeCompDto (packages/api/src/services/compensation.service.ts:33-40), which is NOT
// re-exported from @tims/api's entrypoint (package.json main/types = ./src/root.ts, which exports
// only the router + AppRouter) — so it is hand-declared here rather than imported. Same field-auth
// key-absence semantics as PendingAdjustmentRow above.
interface MyCompensationDto {
  userId: string;
  currency?: string;
  currentSalary?: number;
  variablePay?: number;
  compaRatio?: number | null;
  band?: {
    level: string | null;
    title: string | null;
    min: number;
    mid: number;
    max: number;
    currency: string;
  } | null;
}
type MyCompensationOutput = MyCompensationDto | null;

// §21 minimal-select: both write endpoints return only id + status (the deleted TS procedures did
// `select: { id: true, status: true }` and `return { id: input.id, status: newStatus }` respectively).
interface AdjustmentMutationResult {
  id: string;
  status: string;
}
type CreateAdjustmentOutput = AdjustmentMutationResult;
type ApproveAdjustmentOutput = AdjustmentMutationResult;
```

---

- [ ] **Step 13: Delete the dead read flag and re-word the surviving FX flag comment**

Lines **63–69**, before:

```ts
// Second gate: even when the client is enabled, compensation only routes to C# when its own flag
// is exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const COMPENSATION_VIA_CSHARP = process.env.NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP === 'true';

// Third gate, FX-dependent subset only: independent of COMPENSATION_VIA_CSHARP above (see the
// file header) — gates getBandDistribution / getTotalCompBreakdown / getDashboardKpis.
const COMPENSATION_FX_VIA_CSHARP = process.env.NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP === 'true';
```

After:

```ts
// Second gate, FX-dependent subset ONLY (the 3 hooks that still have a tRPC fallback): even when the
// client is enabled, they route to C# only when this flag is exactly 'true'. NEXT_PUBLIC_* so it is
// inlined for the browser. This is now the ONLY compensation FE flag any code reads — the read/write
// flags it used to sit beside are retired (see the file header + .env.example).
const COMPENSATION_FX_VIA_CSHARP = process.env.NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP === 'true';
```

Leave the `num` / `numOrNull` / `toDate` helpers (lines 71–80) exactly as they are — all three are still used by both the C#-only and the FX hooks.

---

- [ ] **Step 14: Rewrite `useCompensationSalaryBands` as C#-only**

Lines **82–118**, before:

```ts
/**
 * HR-admin org catalog: raw SalaryBand rows (no per-person salary data). Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /compensation/salary-bands (optional companyId query; min/mid/maxSalary doubles
 *            coerced; createdAt/updatedAt Dates rebuilt; title null preserved).
 *  - false → trpc.compensation.getSalaryBands.useQuery(filters) (the DEFAULT).
 */
export function useCompensationSalaryBands(filters?: { companyId?: string }) {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_VIA_CSHARP;

  const trpcQuery = trpc.compensation.getSalaryBands.useQuery(filters ?? {}, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<SalaryBandsOutput>({
    queryKey: ['platform-api', 'compensation', 'salary-bands', filters ?? {}],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/compensation/salary-bands', { companyId: filters?.companyId });
      return raw.map((b) => ({
        id: b.id,
        organizationId: b.organizationId,
        level: b.level,
        title: b.title ?? null,
        minSalary: num(b.minSalary),
        midSalary: num(b.midSalary),
        maxSalary: num(b.maxSalary),
        currency: b.currency,
        isActive: b.isActive,
        createdAt: toDate(b.createdAt),
        updatedAt: toDate(b.updatedAt),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}
```

After:

```ts
/**
 * HR-admin org catalog: raw SalaryBand rows (no per-person salary data). C#-ONLY — the TS tRPC
 * procedure was deleted. GET /compensation/salary-bands (optional companyId query;
 * min/mid/maxSalary doubles coerced; createdAt/updatedAt Dates rebuilt; title null preserved).
 */
export function useCompensationSalaryBands(filters?: { companyId?: string }) {
  return useQuery<SalaryBandsOutput>({
    queryKey: ['platform-api', 'compensation', 'salary-bands', filters ?? {}],
    queryFn: async () => {
      const raw = await platformGet('/compensation/salary-bands', { companyId: filters?.companyId });
      return raw.map((b) => ({
        id: b.id,
        organizationId: b.organizationId,
        level: b.level,
        title: b.title ?? null,
        minSalary: num(b.minSalary),
        midSalary: num(b.midSalary),
        maxSalary: num(b.maxSalary),
        currency: b.currency,
        isActive: b.isActive,
        createdAt: toDate(b.createdAt),
        updatedAt: toDate(b.updatedAt),
      }));
    },
  });
}
```

---

- [ ] **Step 15: Rewrite `useCompensationBenefitsUtilization` as C#-only**

Lines **120–148**, before:

```ts
/**
 * STAFF org-rollup: per-plan benefits utilization (pure kernel output; no min-5). Gate as above.
 *  - true  → GET /compensation/benefits-utilization (enrolled int + utilization double coerced).
 *  - false → trpc.compensation.getBenefitsUtilization.useQuery() (the DEFAULT).
 */
export function useCompensationBenefitsUtilization() {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_VIA_CSHARP;

  const trpcQuery = trpc.compensation.getBenefitsUtilization.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<BenefitsUtilizationOutput>({
    queryKey: ['platform-api', 'compensation', 'benefits-utilization'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/compensation/benefits-utilization');
      return raw.map((b) => ({
        id: b.id,
        name: b.name,
        category: b.category,
        enrolled: num(b.enrolled),
        utilization: num(b.utilization),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}
```

After:

```ts
/**
 * STAFF org-rollup: per-plan benefits utilization (pure kernel output; no min-5). C#-ONLY — the TS
 * tRPC procedure was deleted. GET /compensation/benefits-utilization (enrolled int + utilization
 * double coerced). The row shape is @tims/shared's BenefitUtilizationItem, the same kernel output
 * the C# port is golden-fixtured against.
 */
export function useCompensationBenefitsUtilization() {
  return useQuery<BenefitsUtilizationOutput>({
    queryKey: ['platform-api', 'compensation', 'benefits-utilization'],
    queryFn: async () => {
      const raw = await platformGet('/compensation/benefits-utilization');
      return raw.map((b) => ({
        id: b.id,
        name: b.name,
        category: b.category,
        enrolled: num(b.enrolled),
        utilization: num(b.utilization),
      }));
    },
  });
}
```

---

- [ ] **Step 16: Rewrite `useCompensationCompaRatioDistribution` as C#-only**

Lines **150–189**, before:

```ts
/**
 * STAFF org-rollup: the min-5 compa-ratio distribution kernel. Gate as above.
 *  - true  → GET /compensation/compa-ratio-distribution (optional companyId/businessUnitId query;
 *            bucket keys ("<0.80" etc.) preserved verbatim; per-bucket count int|null coerced,
 *            null preserved; avgCompaRatio/totalEmployees int|null coerced; suppressed boolean).
 *  - false → trpc.compensation.getCompaRatioDistribution.useQuery(filters) (the DEFAULT).
 */
export function useCompensationCompaRatioDistribution(filters?: { companyId?: string; businessUnitId?: string }) {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_VIA_CSHARP;

  const trpcQuery = trpc.compensation.getCompaRatioDistribution.useQuery(filters ?? {}, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<CompaRatioDistributionOutput>({
    queryKey: ['platform-api', 'compensation', 'compa-ratio-distribution', filters ?? {}],
    enabled: viaCSharp,
    queryFn: async () => {
```

After (the whole hook):

```ts
/**
 * STAFF org-rollup: the min-5 compa-ratio distribution kernel. C#-ONLY — the TS tRPC procedure was
 * deleted. GET /compensation/compa-ratio-distribution (optional companyId/businessUnitId query;
 * bucket keys ("<0.80" etc.) preserved verbatim; per-bucket count int|null coerced, null preserved;
 * avgCompaRatio/totalEmployees int|null coerced; suppressed boolean). The shape is @tims/shared's
 * CompaRatioDistribution, the same kernel output the C# port is golden-fixtured against.
 */
export function useCompensationCompaRatioDistribution(filters?: { companyId?: string; businessUnitId?: string }) {
  return useQuery<CompaRatioDistributionOutput>({
    queryKey: ['platform-api', 'compensation', 'compa-ratio-distribution', filters ?? {}],
    queryFn: async () => {
      const raw = await platformGet('/compensation/compa-ratio-distribution', {
        companyId: filters?.companyId,
        businessUnitId: filters?.businessUnitId,
      });
      return {
        // Bucket keys ("<0.80", "0.80-0.90", …) are emitted verbatim by the kernel — map values
        // only, never rename/re-order keys (Object.entries preserves insertion order).
        distribution: Object.fromEntries(
          Object.entries(raw.distribution).map(([key, bucket]) => [
            key,
            { suppressed: bucket.suppressed, count: numOrNull(bucket.count) },
          ]),
        ),
        avgCompaRatio: numOrNull(raw.avgCompaRatio),
        totalEmployees: numOrNull(raw.totalEmployees),
        suppressed: raw.suppressed,
      };
    },
  });
}
```

(The `queryFn` body is unchanged — only the surrounding dual-path scaffolding is removed.)

---

- [ ] **Step 17: Rewrite `useCompensationListPendingAdjustments` as C#-only**

Lines **191–257**. Delete the dual-path scaffolding; keep the entire lens + mapper body verbatim, including the `as PendingAdjustmentsOutput` cast at the end (it now casts to the hand-declared type from Step 12).

After (full hook):

```ts
/**
 * STAFF row-scoped + FIELD-AUTHED: pending salary adjustments. The restricted salary fields
 * (previousSalary/newSalary/currency/reason/type/status) are PRESENT only for entitled tiers
 * (super/hr; type/status also hrbp) and ABSENT otherwise — key absence is preserved (not nulled).
 * C#-ONLY — the TS tRPC procedure was deleted. GET /compensation/pending-adjustments (JsonObject[];
 * dynamic field-authed shape; createdAt Date rebuilt; salaries coerced; absent restricted keys stay
 * absent).
 */
export function useCompensationListPendingAdjustments() {
  return useQuery<PendingAdjustmentsOutput>({
    queryKey: ['platform-api', 'compensation', 'pending-adjustments'],
    queryFn: async () => {
      const raw = await platformGet('/compensation/pending-adjustments');
      // JsonObject is `Record<string, never>`; read through a lens that mirrors the field-authed
      // DTO (restricted keys optional). Double-cast via unknown because the index-signature type
      // is not directly comparable to the lens.
      return raw.map((row) => {
        const a = row as unknown as {
          id: string;
          createdAt: unknown;
          previousSalary?: number | string;
          newSalary?: number | string;
          currency?: string;
          reason?: string | null;
          type?: string;
          status?: string;
          user: { id: string; firstName: string; lastName: string; jobTitle?: string | null };
          requester: { id: string; firstName: string; lastName: string };
        };
        return {
          id: a.id,
          createdAt: toDate(a.createdAt),
          // Preserve ABSENCE of restricted keys (do not inject null for an omitted field).
          ...(a.previousSalary !== undefined ? { previousSalary: num(a.previousSalary) } : {}),
          ...(a.newSalary !== undefined ? { newSalary: num(a.newSalary) } : {}),
          ...(a.currency !== undefined ? { currency: a.currency } : {}),
          ...(a.reason !== undefined ? { reason: a.reason ?? null } : {}),
          ...(a.type !== undefined ? { type: a.type } : {}),
          ...(a.status !== undefined ? { status: a.status } : {}),
          user: {
            id: a.user.id,
            firstName: a.user.firstName,
            lastName: a.user.lastName,
            jobTitle: a.user.jobTitle ?? null,
          },
          requester: {
            id: a.requester.id,
            firstName: a.requester.firstName,
            lastName: a.requester.lastName,
          },
        };
        // The dynamic field-authed shape (optional restricted keys) is guaranteed server-side by the
        // C# implementation + its integration tests; cast the mapped rows to the declared type.
      }) as PendingAdjustmentsOutput;
    },
  });
}
```

---

- [ ] **Step 18: Rewrite `useCompensationMyCompensation` as C#-only**

Lines **259–325**. Same treatment: drop `viaCSharp`, `trpcQuery`, `enabled`, and the ternary; keep the lens + mapper + `as MyCompensationOutput` cast verbatim.

After (full hook):

```ts
/**
 * OWN-scoped + FIELD-AUTHED: the caller's own compensation, or null when no row exists. The
 * restricted analytics fields (variablePay/compaRatio/band; currency/currentSalary for entitled
 * tiers) are PRESENT only for entitled roles and ABSENT otherwise — key absence is preserved.
 * C#-ONLY — the TS tRPC procedure was deleted. GET /compensation/my-compensation
 * (oneOf[null,object]; null → null; salaries coerced; band bounds coerced, band null preserved;
 * absent restricted keys stay absent).
 */
export function useCompensationMyCompensation() {
  return useQuery<MyCompensationOutput>({
    queryKey: ['platform-api', 'compensation', 'my-compensation'],
    queryFn: async () => {
      const raw = await platformGet('/compensation/my-compensation');
      // 200 body is oneOf[null, object]: a missing comp row → null (graceful empty for the UI).
      if (raw === null) return null;
      const c = raw as unknown as {
        userId: string;
        currency?: string;
        currentSalary?: number | string;
        variablePay?: number | string;
        compaRatio?: number | string | null;
        band?: {
          level: string | null;
          title: string | null;
          min: number | string;
          mid: number | string;
          max: number | string;
          currency: string;
        } | null;
      };
      return {
        userId: c.userId,
        // Preserve ABSENCE of restricted keys (do not inject null for an omitted field).
        ...(c.currency !== undefined ? { currency: c.currency } : {}),
        ...(c.currentSalary !== undefined ? { currentSalary: num(c.currentSalary) } : {}),
        ...(c.variablePay !== undefined ? { variablePay: num(c.variablePay) } : {}),
        ...(c.compaRatio !== undefined ? { compaRatio: numOrNull(c.compaRatio) } : {}),
        ...(c.band !== undefined
          ? {
              band: c.band
                ? {
                    level: c.band.level,
                    title: c.band.title,
                    min: num(c.band.min),
                    mid: num(c.band.mid),
                    max: num(c.band.max),
                    currency: c.band.currency,
                  }
                : null,
            }
          : {}),
        // The dynamic field-authed DTO (optional restricted keys) is guaranteed server-side by the
        // C# implementation + its integration tests; cast the mapped object to the declared type.
      } as MyCompensationOutput;
    },
  });
}
```

---

- [ ] **Step 19: Leave the 3 FX hooks byte-identical — verify, do not edit**

`useCompensationBandDistribution` (lines 327–362), `useCompensationTotalCompBreakdown` (364–406), `useCompensationDashboardKpis` (408–445) must be **unchanged**. After Steps 14–18 confirm:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
git diff -U0 apps/web/lib/platform-api/compensation.ts | grep -n "BandDistribution\|TotalCompBreakdown\|DashboardKpis\|COMPENSATION_FX_VIA_CSHARP"
# expected: NO hunk lines touching the 3 FX hook bodies. The only acceptable hit is the
# COMPENSATION_FX_VIA_CSHARP comment rewrite from Step 13.
```

If any of the three hooks appears in the diff beyond its unchanged context, revert that hunk.

---

- [ ] **Step 20: Rewrite the writes-section header and delete the dead write flag**

Lines **447–461**, before:

```ts
// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 12) — a SEPARATE flag from the reads above, mirroring backend
// `Platform:CompensationWriteEnabled` (independent of CompensationReadEnabled/FxReadsEnabled). Both
// C# mutations (createAdjustment/approveAdjustment) have live FE consumers (request-adjustment-modal.tsx,
// approve-adjustment-modal.tsx) — this is the FIRST write port with a 100% wrap rate (no zero-consumer
// procedure to skip, unlike succession/nine-box). Each hook mirrors trpc's useMutation shape
// ({ onSuccess?, onError? }) so existing call sites swap in with a one-line change; both consumers
// already invalidate the `['platform-api','compensation',...]` (and, for createAdjustment, `['platform-
// api','succession',...]` comp-gap) query keys themselves post-success — this file only supplies the
// mutation itself. Error messages are byte-identical between stacks for every outcome (createAdjustment's
// FORBIDDEN, approveAdjustment's NOT_FOUND/CONFLICT all share the exact TS/C# message constants) — no
// documented exceptions, unlike succession's addSuccessor 409.
// ---------------------------------------------------------------------------

const COMPENSATION_WRITE_VIA_CSHARP = process.env.NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP === 'true';
```

After (header rewritten, flag const deleted entirely):

```ts
// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 12) — C#-ONLY. Both TS tRPC mutations (compensation.createAdjustment /
// compensation.approveAdjustment) were deleted on 2026-07-29;
// NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP was confirmed live in prod on 2026-07-28 and is no
// longer read here (the flag is retired — see .env.example). Both mutations have live FE consumers
// (talent/succession/request-adjustment-modal.tsx, compensation/approve-adjustment-modal.tsx) — a
// 100% wrap rate, so nothing was left unwrapped. Each hook keeps trpc's useMutation option shape
// ({ onSuccess?, onError?, onSettled? }), so both call sites are unchanged; both consumers invalidate
// the `['platform-api','compensation',...]` (and, for createAdjustment,
// `['platform-api','succession',...]` comp-gap) query keys themselves post-success — this file only
// supplies the mutation itself. Error messages were byte-identical between stacks before the TS side
// was removed (createAdjustment's FORBIDDEN, approveAdjustment's NOT_FOUND/CONFLICT all shared the
// exact TS/C# message constants), so the C# strings the consumers surface today are the same strings
// users already saw.
// ---------------------------------------------------------------------------
```

Keep `MutationOptions` (463–467) and `useCSharpMutation` (469–479) exactly as they are — both are still used.

---

- [ ] **Step 21: Rewrite the two write hooks as C#-only**

Lines **491–508** and **516–529**. Keep `CreateAdjustmentInputShape` (481–489) and `ApproveAdjustmentInputShape` (510–514) unchanged.

Before (`useCompensationCreateAdjustment`):

```ts
export function useCompensationCreateAdjustment(options?: MutationOptions) {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.compensation.createAdjustment.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: CreateAdjustmentInputShape) => {
```

After:

```ts
/** STAFF: request a salary adjustment (1 call site: talent/succession/request-adjustment-modal.tsx). */
export function useCompensationCreateAdjustment(options?: MutationOptions) {
  return useCSharpMutation(async (input: CreateAdjustmentInputShape) => {
    const raw = await platformPost('/compensation/adjustments', {
      userId: input.userId,
      type: input.type,
      previousSalary: input.previousSalary,
      newSalary: input.newSalary,
      currency: input.currency,
      reason: input.reason,
      effectiveDate: input.effectiveDate,
    });
    return { id: raw.id, status: raw.status } satisfies CreateAdjustmentOutput;
  }, options);
}
```

Before (`useCompensationApproveAdjustment`):

```ts
export function useCompensationApproveAdjustment(options?: MutationOptions) {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.compensation.approveAdjustment.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: ApproveAdjustmentInputShape) => {
```

After:

```ts
/** STAFF: approve/reject a pending adjustment (1 call site: compensation/approve-adjustment-modal.tsx). */
export function useCompensationApproveAdjustment(options?: MutationOptions) {
  return useCSharpMutation(async (input: ApproveAdjustmentInputShape) => {
    const raw = await platformPost(
      '/compensation/adjustments/{id}/approve',
      { approved: input.approved, comment: input.comment },
      { id: input.id },
    );
    return { id: raw.id, status: raw.status } satisfies ApproveAdjustmentOutput;
  }, options);
}
```

Then confirm nothing dangles:

```bash
grep -n "COMPENSATION_VIA_CSHARP\|COMPENSATION_WRITE_VIA_CSHARP\|trpcQuery\|trpcMutation\|csharpMutation\|viaCSharp ? " apps/web/lib/platform-api/compensation.ts
# expected: only the 3 FX hooks' `const viaCSharp = isPlatformApiEnabled() && COMPENSATION_FX_VIA_CSHARP;`,
# their `trpcQuery`/`csharpQuery` locals, and their `return viaCSharp ? csharpQuery : trpcQuery;` lines.
```

---

- [ ] **Step 22: Fix the dead invalidate calls in `approve-adjustment-modal.tsx`**

`apps/web/app/(admin)/compensation/approve-adjustment-modal.tsx` lines **28–36**, before:

```tsx
    onSuccess: () => {
      utils.compensation.listPendingAdjustments.invalidate();
      utils.compensation.getDashboardKpis.invalidate();
      utils.compensation.getBandDistribution.invalidate();
      utils.compensation.getCompaRatioDistribution.invalidate();
      utils.compensation.getTotalCompBreakdown.invalidate();
      // Cutover parity: refresh the C# platform-api compensation reads (pending-adjustments,
      // compa-ratio-distribution) so a flag-on cache stays coherent. No-op under tRPC.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'compensation'] });
```

After:

```tsx
    onSuccess: () => {
      // The 3 FX-dependent reads are still tRPC-served (NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP
      // does not exist in Vercel yet), so their tRPC caches still need an explicit invalidate.
      utils.compensation.getDashboardKpis.invalidate();
      utils.compensation.getBandDistribution.invalidate();
      utils.compensation.getTotalCompBreakdown.invalidate();
      // pending-adjustments and compa-ratio-distribution are C#-only now (their tRPC procedures were
      // deleted), so this prefix invalidation is the ONLY thing that refreshes them.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'compensation'] });
```

The `trpc` import (line 5) and `const utils = trpc.useUtils();` (line 22) **stay** — 3 invalidates survive. Removing lines 29 and 32 loses no behavior: the broad `['platform-api','compensation']` prefix invalidation already covers both C# caches.

---

- [ ] **Step 23: Fix the dead invalidate call + stale docstring in `request-adjustment-modal.tsx`**

`apps/web/app/(admin)/talent/succession/request-adjustment-modal.tsx` lines **50–56**, before:

```tsx
    onSuccess: () => {
      utils.compensation.listPendingAdjustments.invalidate();
      utils.compensation.getDashboardKpis.invalidate();
      // Cutover parity: refresh the C# platform-api succession (comp-gap, TS tRPC read deleted)
      // AND compensation reads (listPendingAdjustments is driven by this create).
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'compensation'] });
```

After:

```tsx
    onSuccess: () => {
      // getDashboardKpis is FX-dependent and still tRPC-served, so its tRPC cache needs an explicit
      // invalidate.
      utils.compensation.getDashboardKpis.invalidate();
      // Refresh the C# platform-api succession (comp-gap, TS tRPC read deleted) AND compensation
      // reads — pending-adjustments (driven by this create) is C#-only now, so this prefix
      // invalidation is the ONLY thing that refreshes it.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'compensation'] });
```

And lines **25–33**, before:

```tsx
/**
 * Sprint 1.4 Task 4 — the comp-gap badge's "Request adjustment" trigger.
 * This is small frontend wiring of the EXISTING, already-fully-built
 * `compensation.createAdjustment` mutation (which had zero frontend callers
 * before this) — NOT a new self-serve adjustment-request flow/page. Fields
 * are pre-filled from the computed comp gap and remain editable; nothing is
 * auto-submitted, same "suggest, human confirms" pattern as the Suggested
 * Successors panel.
 */
```

After:

```tsx
/**
 * Sprint 1.4 Task 4 — the comp-gap badge's "Request adjustment" trigger.
 * This is small frontend wiring of the EXISTING, already-fully-built salary-adjustment
 * create endpoint (POST /compensation/adjustments on the C# Platform service, via
 * useCompensationCreateAdjustment; its TS tRPC counterpart `compensation.createAdjustment`
 * was deleted 2026-07-29 once the write flag was confirmed live) — NOT a new self-serve
 * adjustment-request flow/page. Fields are pre-filled from the computed comp gap and remain
 * editable; nothing is auto-submitted, same "suggest, human confirms" pattern as the
 * Suggested Successors panel.
 */
```

The `trpc` import (line 5) and `const utils = trpc.useUtils();` (line 42) **stay** — 1 invalidate survives.

---

- [ ] **Step 24: Type-check the frontend**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
pnpm --filter @tims/api exec tsc --noEmit
(cd apps/web && npx tsc --noEmit)
```

Both must be clean before touching any test file. Also confirm zero remaining direct references to the deleted procedures anywhere in the app:

```bash
grep -rn "compensation\.getSalaryBands\|compensation\.getBenefitsUtilization\|compensation\.getCompaRatioDistribution\|compensation\.listPendingAdjustments\|compensation\.myCompensation\|compensation\.createAdjustment\|compensation\.approveAdjustment" apps/web packages
# expected: no output
```

---

- [ ] **Step 25: Prune `tests/access/scope-wiring-compensation.test.ts` — taxonomy header**

Lines **8–25**, before:

```ts
// Endpoint taxonomy (all 13 procedures enumerated):
//   getSalaryBands        → org catalog (band definitions, no per-person data)
//                           UNTOUCHED — safe without scoping.
//   getMarketComparison   → org catalog (salaryBand only, no per-person data)
//                           UNTOUCHED — safe without scoping.
//   getBandDistribution   → org-rollup aggregate  → requireOrgScope
//   getCompaRatioDistrib. → org-rollup aggregate  → requireOrgScope
//   getPayEquity          → org-rollup aggregate  → requireOrgScope
//   getBenefitsUtilization→ org-rollup aggregate  → requireOrgScope
//   getTotalCompBreakdown → org-rollup aggregate  → requireOrgScope
//   getDashboardKpis      → org-rollup aggregate  → requireOrgScope
//   listPendingAdjustments→ row-level (salaryAdjustment) → AND-compose fragment
//   createAdjustment      → write targeting input.userId → assertSubjectInScope
//   approveAdjustment     → by-id mutation on salaryAdjustment → assertScoped
//   simulateAdjustment    → per-person read (employeeCompensation by userId)
//                           → assertSubjectInScope on input.userId
//   getEmployeeComp       → per-person read (employeeCompensation by userId)
//                           → assertSubjectInScope on input.userId
```

After:

```ts
// Endpoint taxonomy — the 7 SURVIVING procedures. The other 7 (getSalaryBands,
// getCompaRatioDistribution, getBenefitsUtilization, listPendingAdjustments, myCompensation,
// createAdjustment, approveAdjustment) were DELETED on 2026-07-29 once their C# read/write
// surfaces were confirmed live in prod; their guarantees now live in the C# implementation +
// scripts/parity/{surfaces,write-surfaces}.ts.
//   getMarketComparison   → org catalog (salaryBand only, no per-person data)
//                           UNTOUCHED — safe without scoping.
//   getBandDistribution   → org-rollup aggregate  → requireOrgScope   (FX — still TS-served)
//   getPayEquity          → org-rollup aggregate  → requireOrgScope
//   getTotalCompBreakdown → org-rollup aggregate  → requireOrgScope   (FX — still TS-served)
//   getDashboardKpis      → org-rollup aggregate  → requireOrgScope   (FX — still TS-served)
//   simulateAdjustment    → per-person read (employeeCompensation by userId)
//                           → assertSubjectInScope on input.userId
//   getEmployeeComp       → per-person read (employeeCompensation by userId)
//                           → assertSubjectInScope on input.userId
```

---

- [ ] **Step 26: Prune `tests/access/scope-wiring-compensation.test.ts` — delete 4 tests, update 1**

**a)** Delete lines **38–44** (test + trailing blank):

```ts
it('composes salaryAdjustment fragment (listPendingAdjustments is row-level)', () => {
  const src = read();
  expect(src).toMatch(/scopeWhereFor\('salaryAdjustment'/);
  // AND-composition required (no spread)
  expect(src).toMatch(/AND:\s*\[/);
});
```

**b)** Delete lines **52–59** (two tests + trailing blank):

```ts
it('approveAdjustment probes salaryAdjustment via assertScoped', () => {
  expect(read()).toMatch(/assertScoped\('salaryAdjustment'/);
});

it('createAdjustment gates the target user via assertSubjectInScope', () => {
  expect(read()).toMatch(/assertSubjectInScope/);
});
```

**c)** Update lines **60–64**, before:

```ts
it('org-rollup analytics gated via requireOrgScope (≥6 calls: getBandDistribution, getCompaRatioDistribution, getPayEquity, getBenefitsUtilization, getTotalCompBreakdown, getDashboardKpis)', () => {
  const src = read();
  const matches = src.match(/requireOrgScope/g) ?? [];
  expect(matches.length).toBeGreaterThanOrEqual(6);
});
```

After:

```ts
it('org-rollup analytics gated via requireOrgScope (≥4 calls: getBandDistribution, getPayEquity, getTotalCompBreakdown, getDashboardKpis)', () => {
  const src = read();
  const matches = src.match(/requireOrgScope/g) ?? [];
  expect(matches.length).toBeGreaterThanOrEqual(4);
});
```

(The regex also matches the import statement, so the real post-deletion count is 5 — the assertion of ≥4 is deliberately one below that, matching the 4 named procedures.)

**d)** Delete lines **116–121** (test + trailing blank):

```ts
it('getCompaRatioDistribution routes every bucket count through suppressBelowMin5 (shared kernel)', () => {
  // buildCompaRatioDistribution folds each bucket count through the floor; the router delegates.
  expect(readKernel()).toMatch(/suppressBelowMin5\(count\)/);
  expect(read()).toMatch(/buildCompaRatioDistribution\(/);
});
```

Leave the `composes employeeCompensation fragment…` test (45–50 — `assertSubjectInScope` still exists at simulateAdjustment), the `no file spreads a scope fragment` test, both `getBandDistribution` tests, the `getPayEquity` test, and the 4-shaper loop (130–138 — all 4 shapers survive) untouched. `readKernel` (line 35) stays used.

**Net: −4 tests.**

---

- [ ] **Step 27: Prune `tests/access/scope-wiring-sensitive-data.test.ts` — header comments**

Lines **16–19**, before:

```ts
// Phase-5 Slice 9 (compensation strangler): the compa-ratio min-5 distribution + benefits utilization are
// now the pure @tims/shared kernels the router RETURNS (honest-fixture rule) + the C# port mirrors. The
// min-5 guards that USED to live inline in the router now live in the kernel (and are golden-fixtured BOTH
// stacks via contracts/compensation-fixtures), so the source tripwires read the kernel + assert delegation.
```

After:

```ts
// Phase-5 Slice 9 (compensation strangler): the compa-ratio min-5 distribution + benefits utilization are
// pure @tims/shared kernels golden-fixtured against the C# port (contracts/compensation-fixtures). Their TS
// router procedures were DELETED on 2026-07-29 (C#-only now), so the router no longer calls either kernel —
// these tripwires guard the kernels themselves, which remain the live cross-stack contract.
```

Lines **21–26**, before:

```ts
// The per-person employeeCompensation read (selectFor + FULL+AUDIT logDataAccess)
// lives in the shared compensation.service.ts helper (getEmployeeCompForSubject),
// reused by BOTH compensation.getEmployeeComp and compensation.myCompensation
// (Slice 5B). Audit-guarantee tripwires that count the employeeCompensation audit
// path read the router + service together so the guarantee is enforced wherever
// the code physically lives.
```

After:

```ts
// The per-person employeeCompensation read (selectFor + FULL+AUDIT logDataAccess)
// lives in the shared compensation.service.ts helper (getEmployeeCompForSubject),
// used by compensation.getEmployeeComp (its second caller, compensation.myCompensation,
// was deleted 2026-07-29). Audit-guarantee tripwires that count the employeeCompensation
// audit path read the router + service together so the guarantee is enforced wherever
// the code physically lives.
```

---

- [ ] **Step 28: Prune `tests/access/scope-wiring-sensitive-data.test.ts` — drop the router-delegation assertion**

Lines **307–310**, before:

```ts
  it('emits an empty distribution + null total + suppressed when the population OR any bucket is sub-floor', () => {
    // The router now DELEGATES to the shared kernel (honest-fixture); the guards live in the kernel.
    expect(readComp()).toMatch(/return buildCompaRatioDistribution\(/);
    const src = readCompKernel();
```

After:

```ts
  it('emits an empty distribution + null total + suppressed when the population OR any bucket is sub-floor', () => {
    // The TS router procedure was deleted 2026-07-29 (C#-only); the guards live in the shared kernel,
    // which both stacks are golden-fixtured against.
    const src = readCompKernel();
```

The remaining kernel assertions (`:311–318`) stay unchanged. The test itself is **kept**, not deleted.

---

- [ ] **Step 29: Prune `tests/access/scope-wiring-sensitive-data.test.ts` — the audited-reads describe**

**a)** Delete lines **436–442** (test + trailing blank):

```ts
it('listPendingAdjustments audits each returned row on salaryAdjustment', () => {
  const src = readComp();
  expect(src).toMatch(/entity:\s*'salaryAdjustment'/);
  // the list audits every row via Promise.all over the returned adjustments
  expect(src).toMatch(/adjustments\.map\(\(a\) =>\s*\n?\s*logDataAccess\(/);
});
```

**b)** Update lines **449–452**, before:

```ts
it('three restricted readers call logDataAccess (getEmployeeComp, simulateAdjustment, listPendingAdjustments)', () => {
  const calls = readComp().match(/logDataAccess\(/g) ?? [];
  expect(calls.length).toBeGreaterThanOrEqual(3);
});
```

After:

```ts
it('the surviving restricted reader calls logDataAccess in the router (simulateAdjustment; getEmployeeComp audits inside the shared service)', () => {
  const calls = readComp().match(/logDataAccess\(/g) ?? [];
  expect(calls.length).toBeGreaterThanOrEqual(1);
});
```

(The `logDataAccess\(` regex does not match the import line, which has no paren — the real post-deletion count in the router is exactly 1.)

Keep `compensation router imports logDataAccess…` (425–427), `getEmployeeComp (via service) + simulateAdjustment audit…` (429–434 — `entity: 'employeeCompensation'` still appears twice: router `:453` pre-deletion numbering, plus the service), and `audits actorId via impersonatorId fallback…` (443–447 — both patterns survive in simulateAdjustment).

---

- [ ] **Step 30: Prune `tests/access/scope-wiring-sensitive-data.test.ts` — delete the two write-mutation describes (11 tests)**

Delete lines **455–546** in one contiguous block: the `// ── Slice 6: minimal-select invariant…` comment (455–460), the `describe('createAdjustment + approveAdjustment use minimal selects (slice 6 write mutations)')` block (461–516, **7 tests**), the blank line (517), the `// ── FIX 1 (slice 6 round 8): approveAdjustment is atomic + conditional ───` comment (518–523), and the `describe('approveAdjustment is an atomic, conditional state transition (FIX 1)')` block (524–546, **4 tests**).

The file must now end at the `});` that closes `describe('restricted compensation reads are audited fail-closed (fix 4)')` (line 453) plus a single trailing newline.

> **SECURITY REVIEW NOTE — this step is the one that requires the explicit note.** These 11 tests were the only TypeScript assertions of: `salaryAdjustment.create` having an explicit minimal `select: { id: true, status: true }`; `approveAdjustment`'s `findFirst` select being minimal and excluding `previousSalary`/`reason`; the `action: 'update'` audit firing before the write; the handler returning only `{ id, status }`; the `$transaction` wrapper; the conditional `updateMany where status: 'pending'`; the `count === 0` → `CONFLICT` guard; and the in-transaction `employee_compensations` propagation. **Post-deletion those guarantees are asserted only by the C# implementation's own tests and by `scripts/parity/write-surfaces.ts`'s `readbackMutated`/`readbackNoMutation` raw-SQL readbacks** (which do cover the transaction side-effect and the no-leak case). Accepted, deliberate tradeoff — the TS side is being retired, not weakened. Restate this in the commit message.

Verify `readCompAudited` is still used (it is, at line 432):

```bash
grep -n "readCompAudited" tests/access/scope-wiring-sensitive-data.test.ts
# expected: the helper definition (~:27) and exactly one call site in the getEmployeeComp test
```

**Net for this file: −12 tests, 2 assertions updated.**

---

- [ ] **Step 31: Prune `tests/access/scope-wiring-employee-self-service.test.ts` (−5 tests)**

**a)** Lines **5–7**, before:

```ts
// Wave (role rebuild) Slice 5B — static tripwires for the three OWN-scoped
// employee self-service reads. An employee sees ONLY their own data, never an
// org-wide rollup. These guards fail closed if a future edit widens scope.
```

After:

```ts
// Wave (role rebuild) Slice 5B — static tripwires for the OWN-scoped employee
// self-service reads. An employee sees ONLY their own data, never an org-wide
// rollup. These guards fail closed if a future edit widens scope. (The third
// read, compensation.myCompensation, was deleted 2026-07-29 — C#-only now.)
```

**b)** Delete lines **14–17** (the `compensation.myCompensation` taxonomy entry):

```ts
//   compensation.myCompensation → CURRENT user's own comp via the existing
//                                 getEmployeeComp SERVICE path (field-auth +
//                                 audit preserved). Subject hard-pinned to
//                                 ctx.user.id — never an input userId.
```

**c)** Delete line **24** (the helper becomes unused after (d)):

```ts
const readCompensation = () => readFileSync(join(ROOT, 'packages/api/src/routers/compensation.ts'), 'utf8');
```

**d)** Delete lines **73–105** — the whole `describe('compensation.myCompensation — own-pinned through the field-auth/audit service')` block (5 tests) plus the trailing blank line. The `describe('consent.myConsents — own-pinned DataConsent read')` block must directly follow the engagement describe's closing `});`.

> This deletion is **mandatory, not cosmetic**: `procedureBody()` (lines 29–36) calls `expect(start, 'procedure myCompensation not found').toBeGreaterThanOrEqual(0)`, so leaving the block would hard-fail once the procedure is gone.

Keep the `engagement.myPendingSurveys` describe, the `consent.myConsents` describe, the `consent router is wired` describe, and the `procedureBody` helper (still used by the engagement describe).

---

- [ ] **Step 32: Prune `tests/dei/comp-field-auth.test.ts` (−2 tests)**

**a)** Header lines **4–9**, before:

```ts
// ── Behavioral test for compensation field-auth (slice 6 round 5, HIGH 1) ────
// getEmployeeComp / simulateAdjustment / listPendingAdjustments now build their
// Prisma select from selectFor(ctx.access.roles, …) and construct the returned DTO
// ONLY from selected fields. A leader/employee/hrbp caller with compensation:read
// must NOT receive compaRatio/variablePay (employeeCompensation) or previousSalary/
// newSalary (salaryAdjustment); super/hr must.
```

After:

```ts
// ── Behavioral test for compensation field-auth (slice 6 round 5, HIGH 1) ────
// getEmployeeComp / simulateAdjustment build their Prisma select from
// selectFor(ctx.access.roles, …) and construct the returned DTO ONLY from selected
// fields. A leader/employee/hrbp caller with compensation:read must NOT receive
// compaRatio/variablePay (employeeCompensation); super/hr must. (listPendingAdjustments
// carried the same guarantee for salaryAdjustment's previousSalary/newSalary/reason —
// its TS procedure was deleted 2026-07-29 and that guarantee now lives only in the C#
// implementation.)
```

**b)** Delete line **17** (`const adjFindMany = vi.fn();`) and line **23** (`    salaryAdjustment: { findMany: (...a: unknown[]) => adjFindMany(...a) },`) — both become unused once (d) lands.

**c)** Delete line **57** from the `CompCaller` interface:

```ts
  listPendingAdjustments(): Promise<Array<Record<string, unknown>>>;
```

**d)** Delete lines **163–205** — the whole `describe('listPendingAdjustments field-auth (HIGH 1)')` block (its `ADJ_ROW` fixture + 2 tests) and the blank line preceding it.

Keep the `getEmployeeComp field-auth (HIGH 1)` and `simulateAdjustment field-auth (HIGH 1)` describes untouched.

---

- [ ] **Step 33: Prune `tests/dei/comp-distribution-suppression.test.ts` (−5 tests)**

**a)** Header lines **4–9**, before:

```ts
// ── Behavioral test for compensation distribution suppression (round 7) ──────────
// Round 7 (present-key cardinality) SUPERSEDES the round-5 uniform-flag-keep-keys
// approach. getCompaRatioDistribution (buckets) and getBandDistribution (bands) must:
//  emit an EMPTY distribution/bands (no per-bucket/band keys) when the OWN population
//  is 1..4 OR ANY bucket/band/unbanded bucket is below the floor — so N + the present-
//  key set can never pin singletons. The top-level `suppressed` flag is the only signal.
```

After:

```ts
// ── Behavioral test for compensation distribution suppression (round 7) ──────────
// Round 7 (present-key cardinality) SUPERSEDES the round-5 uniform-flag-keep-keys
// approach. getBandDistribution (bands) must emit an EMPTY bands array (no per-band
// keys) when the OWN population is 1..4 OR ANY band/unbanded bucket is below the floor
// — so N + the present-key set can never pin singletons. The top-level `suppressed`
// flag is the only signal. (getCompaRatioDistribution carried the identical guarantee;
// its TS procedure was deleted 2026-07-29 — the kernel-level guard is still covered by
// tests/compensation/compa-ratio-distribution-fixtures.test.ts + the C# unit tests.)
```

**b)** Delete lines **40–44** from the `CompCaller` interface:

```ts
  getCompaRatioDistribution(input?: unknown): Promise<{
    distribution: Record<string, { suppressed: boolean; count: number | null }>;
    totalEmployees: number | null;
    suppressed: boolean;
  }>;
```

**c)** Delete lines **72–73** — the `compRow` helper plus its trailing blank line (it is used only inside the describe deleted in (d); verified by grep):

```ts
const compRow = (cr: number) => ({ id: 'x', currentSalary: 5_000_000, currency: 'USD', compaRatio: cr, userId: 'u' });
```

**d)** Delete lines **79–145** — the whole `describe('getCompaRatioDistribution suppression (round 7)')` block (5 tests, including its inner `compRowSalary` helper at `:118`) plus the blank line after it.

Keep `describe('getBandDistribution suppression (round 7)')` and `describe('getTotalCompBreakdown — denominator alignment …')` untouched. `compFindMany`, `compCount`, and `companyFindFirst` all remain used by those describes.

---

- [ ] **Step 34: Prune `tests/dei/sub-floor-aggregate-leaks.test.ts` (−3 tests)**

**a)** Delete header line **8**:

```ts
//   HIGH 1  getCompaRatioDistribution  → avgCompaRatio null at sub-floor population
```

**b)** Delete line **100** from the `compCaller` return-type annotation:

```ts
    getCompaRatioDistribution(input?: unknown): Promise<{ distribution: Record<string, unknown>; avgCompaRatio: number | null; totalEmployees: number | null; suppressed: boolean }>;
```

**c)** Delete lines **114–115** — the `compRow` helper plus its trailing blank line (grep-verified: used only inside the describe deleted in (d)):

```ts
const compRow = (cr: number) => ({ id: 'x', currentSalary: 5_000_000, currency: 'USD', compaRatio: cr, userId: 'u' });
```

**d)** Delete lines **121–157** — the `// ── HIGH 1: getCompaRatioDistribution avgCompaRatio null at sub-floor ─────────` comment plus the whole `describe('getCompaRatioDistribution avgCompaRatio (HIGH 1)')` block (3 tests) plus the trailing blank line. The next surviving line must be `// ── HIGH 2: getTotalCompBreakdown min-5 floor ─────...`.

Keep `getTotalCompBreakdown (HIGH 2)`, `compensation getDashboardKpis (HIGH 3)`, `simulateAdjustment select field-auth (MEDIUM 5)`, and every engagement/DEI describe untouched.

---

- [ ] **Step 35: Rewrite the 2 stale assertions in `tests/tier1/s3-compensation-wiring.test.ts` (0 tests removed)**

**a)** Lines **13–20**, before:

```ts
it('calls the real mutation (not a comingSoon stub)', () => {
  // Cut over to the dark platform-api wrapper (apps/web/lib/platform-api/compensation.ts,
  // Phase-5 Slice-12 write wrapper) — it still calls trpc.compensation.approveAdjustment.useMutation
  // internally on the default (non-C#) path, so this assertion follows the refactor rather
  // than the raw call (same pattern as tests/access/survey-take-ui.test.ts's engagement fix).
  expect(modal).toMatch(/useCompensationApproveAdjustment/);
  expect(modal).not.toMatch(/comingSoon/);
});
```

After:

```ts
it('calls the real mutation (not a comingSoon stub)', () => {
  // Cut over to the platform-api wrapper (apps/web/lib/platform-api/compensation.ts, Phase-5
  // Slice-12 write wrapper). As of 2026-07-29 that hook calls the C# service unconditionally —
  // trpc.compensation.approveAdjustment was deleted — so this assertion targets the hook rather
  // than the raw tRPC call (same pattern as tests/access/survey-take-ui.test.ts's engagement fix).
  expect(modal).toMatch(/useCompensationApproveAdjustment/);
  expect(modal).not.toMatch(/comingSoon/);
});
```

**b)** Lines **30–39**, before:

```ts
it('invalidates listPendingAdjustments', () => {
  expect(modal).toMatch(/utils\.compensation\.listPendingAdjustments\.invalidate/);
});

it('invalidates all five queries', () => {
  expect(modal).toMatch(/utils\.compensation\.getDashboardKpis\.invalidate/);
  expect(modal).toMatch(/utils\.compensation\.getBandDistribution\.invalidate/);
  expect(modal).toMatch(/utils\.compensation\.getCompaRatioDistribution\.invalidate/);
  expect(modal).toMatch(/utils\.compensation\.getTotalCompBreakdown\.invalidate/);
});
```

After:

```ts
it('invalidates the C# platform-api compensation cache (pending-adjustments + compa-ratio are C#-only now)', () => {
  expect(modal).toMatch(/queryClient\.invalidateQueries\(\{\s*queryKey:\s*\['platform-api',\s*'compensation'\]/);
});

it('invalidates the three surviving FX tRPC queries', () => {
  expect(modal).toMatch(/utils\.compensation\.getDashboardKpis\.invalidate/);
  expect(modal).toMatch(/utils\.compensation\.getBandDistribution\.invalidate/);
  expect(modal).toMatch(/utils\.compensation\.getTotalCompBreakdown\.invalidate/);
});
```

Keep the other 5 tests in the file unchanged.

---

- [ ] **Step 36: Shrink `scripts/parity/surfaces.ts`'s compensation entry from 7 endpoints to 2**

**a)** Replace the header comment at lines **60–72**, before:

```ts
// ── compensation ────────────────────────────────────────────────────────────────────────────
// 6 of the 7 compensation reads (the FX-FREE subset; the /employee/{userId} by-id read is a
// Tier-2 follow-up needing the harness Mode-A id extension). `compensation.getSalaryBands/
// getMarketComparison/getBenefitsUtilization/getCompaRatioDistribution/listPendingAdjustments/
// myCompensation` → /compensation/{salary-bands,market-comparison,benefits-utilization,
// compa-ratio-distribution,pending-adjustments,my-compensation}. All permissionProcedure(
// 'compensation','read'). One flag Platform:CompensationReadEnabled + FE NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP.
// RBAC (seed grants hr_admin compensation:read@org, hrbp @unit): grant-only reads (salary-bands/
// market-comparison/pending-adjustments) → hrbp 200 (pending-adjustments returns scoped-empty rows,
// not 403); requireOrgScope reads (benefits-utilization/compa-ratio-distribution) → hrbp 403;
// my-compensation → hrbp 403 (SubjectInScope unit: caller's own id ∉ empty unit-member set).
// compa-ratio-distribution needs ≥5 org-A comp rows in ONE compa bucket (min-5) or it self-
// suppresses to an all-zero object identical to empty org B → false-fail; the seed provides 5.
```

After:

```ts
// ── compensation ────────────────────────────────────────────────────────────────────────────
// UPDATE 2026-07-29: 5 of the original 7 registered compensation reads had their TS procedures
// DELETED (NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP confirmed live in prod) — salary-bands,
// benefits-utilization, compa-ratio-distribution, pending-adjustments and my-compensation are
// REMOVED below (no TS side left to diff against for any of them). The 2 that survive
// (market-comparison, employee) map to the router's zero-FE-consumer procedures, which stay live
// — pre-existing dead code unrelated to this migration — so `verify compensation` still runs 2
// REAL parity/RLS/RBAC checks, not a no-op. One flag Platform:CompensationReadEnabled still gates
// the C# side for all 7 backend endpoints; only these 2 have a TS side left to compare against.
//
// FX EXCLUSION (unchanged): the 3 FE-consumed FX-dependent reads (getBandDistribution /
// getTotalCompBreakdown / getDashboardKpis) were NEVER registered here — they are gated by the
// separate Platform__FxReadsEnabled flag (the same FX-tied-endpoint exclusion applied to
// `dei.getPayEquity` further down this registry), and their TS implementations are DELIBERATELY
// RETAINED as the live production path for those 3 reads.
//
// RBAC (seed grants hr_admin compensation:read@org, hrbp @unit): market-comparison is a grant-only
// org-catalog read → hrbp 200; employee is subject-scoped → hrbp 403 (target ∉ its subject set).
```

**b)** In the `endpoints:` array (lines 78–141), delete the `salary-bands` (79–86), `benefits-utilization` (95–102), `compa-ratio-distribution` (103–110), `pending-adjustments` (111–119) and `my-compensation` (120–128) entries. Keep `market-comparison` (87–94) and the `employee` Tier-2 entry with its preceding comment (129–140). Result:

```ts
  compensation: {
    key: 'compensation',
    flag: 'Platform__CompensationReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'market-comparison',
        csharpPath: '/compensation/market-comparison',
        tsProcedure: 'compensation.getMarketComparison',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'level' },
      },
      // Tier-2 by-id: getEmployeeComp = permissionProcedure('compensation','read') + assertSubjectInScope.
      // Org-A target = a:hr_admin (has a comp row). super_admin bypass → 200; hr_admin reads its own id →
      // 200; hrbp @unit → the target ∉ its subject set → 403. Mode-A IDOR: org-A token → org-B b:hr_admin id.
      {
        name: 'employee',
        csharpPath: '/compensation/employee/{id}',
        tsProcedure: 'compensation.getEmployeeComp',
        input: { userId: ID_SENTINEL },
        idScopeKey: 'employee',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
```

**c)** Confirm-only: the DEI block's back-reference (~line 443, `"…the same FX-tied-endpoint exclusion already applied to compensation's live-FX reads elsewhere in this registry…"`) still resolves, because the rewritten compensation header above **retains** an explicit FX EXCLUSION paragraph. Grep to confirm, and do NOT change the DEI comment:

```bash
grep -n "FX-tied-endpoint exclusion already applied to compensation" scripts/parity/surfaces.ts
grep -n "FX EXCLUSION" scripts/parity/surfaces.ts
# both must return exactly one hit
```

---

- [ ] **Step 37: Update `scripts/parity/surfaces.test.ts`**

Lines **5–15**, before:

```ts
  it('the four read surfaces are registered with their flags + full endpoint sets (Tier-1 + Tier-2 by-id)', () => {
    expect(SURFACES['compensation'].flag).toBe('Platform__CompensationReadEnabled');
    expect(SURFACES['compensation'].endpoints.map((e) => e.name).sort()).toEqual([
      'benefits-utilization',
      'compa-ratio-distribution',
      'employee',
      'market-comparison',
      'my-compensation',
      'pending-adjustments',
      'salary-bands',
    ]);
```

After:

```ts
  it('the three read surfaces that still have a TS side are registered with their flags + current endpoint sets (Tier-1 + Tier-2 by-id)', () => {
    expect(SURFACES['compensation'].flag).toBe('Platform__CompensationReadEnabled');
    // 2026-07-29: shrunk from 7 to 2 — the other 5 TS procedures were deleted (C#-only now).
    expect(SURFACES['compensation'].endpoints.map((e) => e.name).sort()).toEqual([
      'employee',
      'market-comparison',
    ]);
```

The `ninebox`/`succession` assertions (16–20), the `probeRole` loop (21–23), the Tier-2 by-id test (26–47, `'compensation/employee': 'employee'` survives so `byIdCount` stays **3**), and the nine-box `globalScope` test all stay unchanged.

---

- [ ] **Step 38: Append an UPDATE clause to `scripts/parity/write-surfaces.ts` (comment only — no code change)**

Lines **193–198**, before:

```ts
// 2 writes under ONE flag Platform__CompensationWriteEnabled (Program.cs). createAdjustment =
// permissionProcedure('compensation','create') + assertSubjectInScope (out-of-org subject → 403);
// approveAdjustment = permissionProcedure('compensation','approve') + assertScoped IDOR (out-of-org
// id → 404). super/hr_admin allow, hrbp denied (no create/approve grant). Approve runs a tx:
// salary_adjustments.status pending→approved (+ approved_by_id) AND employee_compensations.current_salary
// = new_salary for the subject.
```

After:

```ts
// 2 writes under ONE flag Platform__CompensationWriteEnabled (Program.cs). createAdjustment =
// permissionProcedure('compensation','create') + assertSubjectInScope (out-of-org subject → 403);
// approveAdjustment = permissionProcedure('compensation','approve') + assertScoped IDOR (out-of-org
// id → 404). super/hr_admin allow, hrbp denied (no create/approve grant). Approve runs a tx:
// salary_adjustments.status pending→approved (+ approved_by_id) AND employee_compensations.current_salary
// = new_salary for the subject.
//
// UPDATE 2026-07-29: the TS tRPC counterparts (compensation.createAdjustment /
// compensation.approveAdjustment) have been DELETED — the permissionProcedure / assertSubjectInScope /
// assertScoped wiring described above is now the C# implementation's, not TypeScript's. This surface is
// UNAFFECTED: it drives literal C# HTTP paths and asserts side effects with raw SQL readbacks, so
// `verify-write compensation` never depended on the TS router. Those readbacks
// (readbackMutated / readbackNoMutation) are now the ONLY automated assertion of the atomic
// pending→approved transition and of the §21 minimal-select no-leak guarantee — see the security note
// in the TS-deletion commit.
```

Confirm no code change is needed anywhere else in this file or in `scripts/parity/seed.ts` / `scripts/parity/write-surfaces.test.ts`:

```bash
grep -n "tsProcedure" scripts/parity/write-surfaces.ts | head
# expected: write surfaces use literal csharpPath values, no tsProcedure — nothing to prune.
grep -n "seedCompensationGrants\|seedCompensationData\|seedCompensationWritePreconditions\|resolveCompensationWriteResources" scripts/parity/seed.ts
# expected: all four still present; all are raw SQL and all are still needed (succession's seed
# depends on seedCompensationData's band + comp rows; the surviving read endpoints need the grants).
```

---

- [ ] **Step 39: Update `scripts/deploy/cutover.sh` (both compensation rows)**

**a)** The read surface, lines **82–84**, before:

```bash
    compensation)
      echo "read|CompensationReadEnabled|verify|compensation|NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4 — the FX-FREE subset only (7 of 12 comp reads). The 5 FX-dependent reads sit behind the separate FxReadsEnabled flag (needs the fx_rates migration + a seed first) and are intentionally NOT covered by this surface name."
      ;;
```

After (single line, matching succession's and nine-box's shape — note the status change `FLIP_READY` → `CONFIRMED_LIVE`):

```bash
    compensation)
      echo "read|CompensationReadEnabled|verify|compensation|NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase A #4. UPDATE 2026-07-29: flag confirmed live in prod; 5 of 7 registered read procedures (salary-bands, benefits-utilization, compa-ratio-distribution, pending-adjustments, my-compensation) have ALSO had their TS side deleted — scripts/parity/surfaces.ts's 'compensation' entry now registers only market-comparison + employee (both zero-FE-consumer procedures that stay live). --verify-only still runs a REAL (smaller) check, unlike reporting/evaluation360/team-intel/billing-usage's now-fully-no-op surfaces — do not treat this as TS_DELETED. FX SPLIT: the 3 FE-consumed FX-dependent reads (getBandDistribution/getTotalCompBreakdown/getDashboardKpis) are NOT part of this surface, are gated by the separate Platform:FxReadsEnabled + NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP (which still does not exist in Vercel), and their TS implementations are DELIBERATELY RETAINED — they are the live production path for those 3 reads today."
      ;;
```

**b)** The write surface, lines **109–110**, before:

```bash
    compensation-write)
      echo "write|CompensationWriteEnabled|verify-write|compensation|NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP|COEXISTENCE|Runbook §6 Phase B #11 — COEXISTENCE: salary_adjustments/employee_compensations stay read by other surfaces; table stays efcoreStranglerWrite, no ownership flip."
      ;;
```

After (status stays `COEXISTENCE` — see the Global Constraints — with an appended UPDATE clause):

```bash
    compensation-write)
      echo "write|CompensationWriteEnabled|verify-write|compensation|NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP|COEXISTENCE|Runbook §6 Phase B #11 — COEXISTENCE: salary_adjustments/employee_compensations stay read by other surfaces; table stays efcoreStranglerWrite, no ownership flip. UPDATE 2026-07-29: the flag IS confirmed live in prod and both TS mutations (createAdjustment/approveAdjustment) have now been DELETED — but the status stays COEXISTENCE, not CONFIRMED_LIVE, because COEXISTENCE classifies TABLE OWNERSHIP and that reason is MORE true after the deletion: employee_compensations is still read in TypeScript by getTotalCompBreakdown/getDashboardKpis/getPayEquity/simulateAdjustment (two of which are the still-TS-served FX reads). verify-write is unaffected either way — write-surfaces.ts's compensationSurface hits the C# HTTP endpoints directly and asserts side effects with raw SQL, never via the TS router."
      ;;
```

Confirm-only (no change needed): `cutover.sh:6` (surface list), `:124` (`ALL_SURFACES`), `:176-177` and `:540` (usage examples using `compensation` — still valid commands), `:248` ("It has NO field at all for evaluation360/succession/compensation/nine-box/…" — still true).

---

- [ ] **Step 40: Retarget `README-cutover.md`'s worked example from `compensation` to `dei` (OQ-6)**

Rationale, verified against `scripts/deploy/cutover.sh` and `docs/REMAINING-WORK.md:147-152` at plan-writing time: `dei` read is `FLIP_READY`, `NEXT_PUBLIC_DEI_READ_VIA_CSHARP` **does not exist in Vercel**, its entire TS router is live, and `verify dei` runs a real 10-endpoint check. `engagement` read is in the identical state and is an equally valid substitute; `dei` is preferred because it has **no write counterpart** and no TS-deletion work sequenced against it (engagement-write is the next domain in this sequence), so this example will stay true longer. This is a proactive fix for the "worked-example citation goes stale" pattern that has hit 4 prior domains' whole-branch reviews.

Replace `scripts/deploy/README-cutover.md` lines **31–62** in full.

Before:

````markdown
## Worked example: cutting over `compensation`

```bash
# 1) Verify — safe, non-mutating, needs scripts/parity/.env populated (see scripts/parity/README.md)
#    and a live, reachable C# service.
./scripts/deploy/cutover.sh compensation --verify-only

# 2) Once that's green, flip the backend flag AND re-verify in the same breath — the script
#    refuses to flip unless a verify pass is bundled into the same invocation (see "sequencing
#    safety" below). --yes is what actually executes the AWS CLI call; without it you get a
#    dry-run printout of the exact command.
./scripts/deploy/cutover.sh compensation --verify-only --flip-backend --yes

# 3) Canary/monitor per the runbook, then flip the FE flag too (NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP=true
#    in Vercel Production + redeploy) — this script does not touch Vercel; that step stays manual
#    per the runbook (§6: "The flag alone does not move the FE.").

# If anything looks wrong at any point, roll back immediately — no re-verify needed:
./scripts/deploy/cutover.sh compensation --rollback --yes
```

**Why not `reporting` for this walkthrough (like before)?** As of 2026-07-28 the TS
recruitment-analytics router and its FE tRPC fallback were deleted outright (the C# read path is
the sole implementation now), and the same happened to the TS evaluation360 router (both read AND
write) — see the table below. As of 2026-07-29, the TS `team-intel` `getDashboardKpis` procedure
and the TS `billing-usage` `getBillingConfig`/`getCurrentPlan`/`getUsage` procedures joined this
group too (each time, only the specific dead procedure(s) were removed — team-intel's and
billing.ts's routers stay alive for their other, still-dark-or-unrelated procedures). None of
`reporting`, `evaluation360` (read), `team-intel`, or `billing-usage` has a parity command left to
demonstrate; `--verify-only` for any of them is now a no-op that prints an explanatory notice and
exits 0 rather than running a real check. `compensation` (FX-free read subset) is this
walkthrough's surface instead — still `FLIP_READY` as of this writing.
````

After:

````markdown
## Worked example: cutting over `dei`

```bash
# 1) Verify — safe, non-mutating, needs scripts/parity/.env populated (see scripts/parity/README.md)
#    and a live, reachable C# service.
./scripts/deploy/cutover.sh dei --verify-only

# 2) Once that's green, flip the backend flag AND re-verify in the same breath — the script
#    refuses to flip unless a verify pass is bundled into the same invocation (see "sequencing
#    safety" below). --yes is what actually executes the AWS CLI call; without it you get a
#    dry-run printout of the exact command.
./scripts/deploy/cutover.sh dei --verify-only --flip-backend --yes

# 3) Canary/monitor per the runbook, then flip the FE flag too (NEXT_PUBLIC_DEI_READ_VIA_CSHARP=true
#    in Vercel Production + redeploy) — this script does not touch Vercel; that step stays manual
#    per the runbook (§6: "The flag alone does not move the FE.").

# If anything looks wrong at any point, roll back immediately — no re-verify needed:
./scripts/deploy/cutover.sh dei --rollback --yes
```

**Why `dei` and not one of the other surfaces?** A worked example is only honest on a surface that
is genuinely still un-flipped AND still has a live TS side to verify against. As of 2026-07-29 most
surfaces fail one half or the other. `reporting`, `evaluation360` (read), `team-intel` and
`billing-usage` had their TS routers/procedures deleted outright (the C# read path is the sole
implementation now — each time only the specific dead procedure(s) were removed, so team-intel's and
billing.ts's routers stay alive for their other, still-dark-or-unrelated procedures), so
`--verify-only` for any of them is a no-op that prints an explanatory notice and exits 0 rather than
running a real check. `succession`, `nine-box` and `compensation` are already CONFIRMED LIVE in prod
with their TS side partially deleted, so "flip the flag" and "roll back" no longer describe reality
for them — `compensation` in particular held this walkthrough until 2026-07-29, when 5 of its 7
registered read procedures were deleted. `dei` read is the cleanest remaining demonstration:
`NEXT_PUBLIC_DEI_READ_VIA_CSHARP` does not exist in Vercel yet, the whole TS DEI router is live, and
`verify dei` runs a real 10-endpoint parity/RLS/RBAC check. (`engagement` read is in the same state
and substitutes cleanly if DEI ever flips first.) One DEI caveat, also printed by `--list`:
`dei.getPayEquity` is gated by the separate `Platform:FxReadsEnabled` flag and is NOT covered by
this surface.
````

---

- [ ] **Step 41: Update `README-cutover.md`'s two compensation table rows**

**a)** Line **122**, before:

```markdown
| `compensation` | read | `CompensationReadEnabled` | `verify compensation` | `NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP` | FLIP-READY |
```

After:

```markdown
| `compensation` | read | `CompensationReadEnabled` | `verify compensation` | `NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP` | CONFIRMED LIVE (partial TS deletion — 5/7 read procedures, see cutover.sh) |
```

**b)** Line **131**, before:

```markdown
| `compensation-write` | write | `CompensationWriteEnabled` | `verify-write compensation` | `NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP` | COEXISTENCE |
```

After:

```markdown
| `compensation-write` | write | `CompensationWriteEnabled` | `verify-write compensation` | `NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP` | COEXISTENCE (flag live; both TS mutations deleted — see cutover.sh) |
```

Confirm-only, no change needed: line **84** ("field at all for evaluation360, succession, compensation, nine-box, engagement, dei, audit-log, …" — still true) and line **200** ("Only evaluation360/succession/nine-box/compensation/engagement/access-review actually have a write flag today" — still true; the `compensation-write` flag still exists).

---

- [ ] **Step 42: Retire the dead flags in `.env.example` (OQ-3)**

This is a plain-text repo file, not a Vercel secret, so this edit is fully in scope (unlike prior domains' actual Vercel-flag hand-offs, which are Federico-only). Deleting the _Vercel_ env vars remains a separate, optional, Federico-only cleanup and is **not** part of this plan.

Lines **112–117**, before:

```bash
# Per-surface flag: route the FIVE FE-consumed FX-FREE compensation reads (getSalaryBands /
# getBenefitsUtilization / getCompaRatioDistribution / listPendingAdjustments / myCompensation)
# to the C# service. Mirrors the backend `Platform:CompensationReadEnabled` flag. Requires
# NEXT_PUBLIC_TIMS_PLATFORM_API_URL to also be set. Anything other than the exact string
# 'true' (including unset) keeps the tRPC path. Default off.
NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP=false
```

After:

```bash
# RETIRED 2026-07-29 — DEAD FLAG, no code reads it. It used to route the FIVE FE-consumed FX-FREE
# compensation reads (getSalaryBands / getBenefitsUtilization / getCompaRatioDistribution /
# listPendingAdjustments / myCompensation) to the C# service. The flag was confirmed live in prod on
# 2026-07-28 and those five TS tRPC procedures were deleted on 2026-07-29, so the reads are now
# unconditionally C#-served (apps/web/lib/platform-api/compensation.ts no longer references this
# variable). Kept listed here only so the name is not mistaken for a missing flag — setting it has
# NO effect. NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP (createAdjustment / approveAdjustment) was
# never listed in this file and is retired in exactly the same way. The FX flag below is the ONLY
# compensation FE flag still read by any code.
NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP=false
```

And amend the FX block's opening at lines **119–120**, before:

```bash
# Per-surface flag, SEPARATE from the one above: route the THREE FE-consumed FX-DEPENDENT
# compensation reads (getBandDistribution / getTotalCompBreakdown / getDashboardKpis) to the C#
```

After:

```bash
# Per-surface flag, SEPARATE from the retired one above and the ONLY LIVE compensation FE flag:
# route the THREE FE-consumed FX-DEPENDENT compensation reads (getBandDistribution /
# getTotalCompBreakdown / getDashboardKpis) to the C#
```

Leave the rest of the FX block (lines 121–127) untouched — it is still fully accurate.

---

- [ ] **Step 43: Update `docs/REMAINING-WORK.md`**

**a)** Append a TS-deletion clause to the Compensation bullet. Line **87**, before:

```markdown
    (`docs/architecture/csharp-migration/fx-seed-once-runbook.md`, Federico-only).
```

After:

```markdown
    (`docs/architecture/csharp-migration/fx-seed-once-runbook.md`, Federico-only). **TS deletion
    2026-07-29:** 7 of the router's 14 procedures were deleted (the 5 FX-free reads + both writes);
    the 3 FX-dependent procedures are **deliberately retained as the live prod path**, and the 4
    zero-FE-consumer procedures (`getPayEquity`, `simulateAdjustment`, `getMarketComparison`,
    `getEmployeeComp`) are untouched pre-existing dead code.
```

**b)** Line **106**, before:

```markdown
    FX-dependent compensation/DEI reads) have a dark `useX()` hook per read, mirroring the exact tRPC output
```

After:

```markdown
    FX-dependent compensation/DEI reads) have a `useX()` hook per read, originally dark and mirroring the exact
    tRPC output type — though for domains whose flag has since gone live and whose TS procedures were
    subsequently deleted (reporting, evaluation360, team-intel, billing-usage, succession, nine-box, and
    compensation's 5 FX-free reads) the hook is now C#-only with hand-declared types, no longer dark and no
    longer mirroring a tRPC output
```

**c)** Line **122**, before:

```markdown
    billing-webhook, billing-self-serve) have a dark `useXMutation()` hook per write MUTATION THAT HAS A
```

After:

```markdown
    billing-webhook, billing-self-serve) have a `useXMutation()` hook per write MUTATION THAT HAS A
    LIVE FE CALL SITE — originally dark; where the write flag has since gone live and the TS mutation was
    deleted (succession, nine-box, compensation) the hook is now C#-only —
```

…then remove the now-duplicated `LIVE FE CALL SITE — ` prefix at the start of the following line so the sentence reads cleanly. Re-read lines 120–126 after editing and confirm the prose is grammatical.

**d)** Lines **153–161**, before:

```markdown
respective slice docs). TS-code deletion (step 7) has now happened for 6 of the now-12 live
read/write surfaces — reporting and evaluation360 (2026-07-28), team-intel and billing-usage
(2026-07-29), succession (2026-07-29, **partially** deleted — 8 of 9 read procedures + 2 of
5 write procedures; `getCriticalRole` and 3 zero-consumer write mutations remain untouched,
unrelated dead code), and nine-box (2026-07-29, **partially** deleted — 7 of 11 read procedures +
3 of 5 write procedures; `getAxisBreakdown`/`getMovementHistory`/`simulate`/`getQuadrantPlan`
(reads) and `submitCalibrationVote`/`finalizeCalibration` (writes) remain untouched, unrelated
zero-consumer dead code) — the remaining live surfaces (compensation, engagement write) still
have their TS fallback code sitting dead-but-undeleted behind their (now-always-true) flags. Flipping a
```

After:

```markdown
respective slice docs). TS-code deletion (step 7) has now happened for 7 of the now-12 live
read/write surfaces — reporting and evaluation360 (2026-07-28), team-intel and billing-usage
(2026-07-29), succession (2026-07-29, **partially** deleted — 8 of 9 read procedures + 2 of
5 write procedures; `getCriticalRole` and 3 zero-consumer write mutations remain untouched,
unrelated dead code), nine-box (2026-07-29, **partially** deleted — 7 of 11 read procedures +
3 of 5 write procedures; `getAxisBreakdown`/`getMovementHistory`/`simulate`/`getQuadrantPlan`
(reads) and `submitCalibrationVote`/`finalizeCalibration` (writes) remain untouched, unrelated
zero-consumer dead code), and compensation (2026-07-29, **partially** deleted — 5 of 10
FE-consumed read procedures + both write procedures; the 3 FX-dependent reads
`getBandDistribution`/`getTotalCompBreakdown`/`getDashboardKpis` are DELIBERATELY RETAINED because
`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` still does not exist in Vercel and TypeScript is
their live prod path, and `getPayEquity`/`simulateAdjustment`/`getMarketComparison`/
`getEmployeeComp` remain untouched zero-consumer dead code) — the one remaining live surface,
engagement write, still has its TS fallback code sitting dead-but-undeleted behind its
(now-always-true) flag. Flipping a
```

**e)** Line **256**, before:

```markdown
- **Compensation** — Approve/Reject adjustment (`approveAdjustment`, atomic). ✅
```

After:

```markdown
- **Compensation** — Approve/Reject adjustment (atomic; originally `compensation.approveAdjustment`, now the C# `POST /compensation/adjustments/{id}/approve` behind `useCompensationApproveAdjustment` — the TS procedure was deleted 2026-07-29). ✅
```

**f)** Confirm-only, no change: lines **147–148** ("**Live now:** … compensation read (FX-free subset)+write … **Still dark:** compensation FX-dependent read subset…") are still exactly accurate; line **241** (the Federico-ownership table row) is still accurate; line **298** (the ExchangeRate-API attribution TODO gating any future FX flip) is still accurate and remains a real blocker on ever flipping the FX flag.

---

- [ ] **Step 44: Fix the broken smoke-test call in `tools/test-apis.sh`**

This is a **functional** break, not just prose — the script would hit a nonexistent procedure. Line **138**, before:

```bash
test_query "compensation.getSalaryBands" "compensation.getSalaryBands"
```

After (swap in a surviving zero-input compensation query so the router keeps a smoke test — the same substitution pattern `0901624` used for `billing.getCurrentPlan` → `billing.listInvoices`; `getMarketComparison`'s input is `.optional()`, so the no-input `test_query` form works):

```bash
test_query "compensation.getMarketComparison" "compensation.getMarketComparison"
```

Line 139 (`compensation.getDashboardKpis`) stays — that procedure survives.

Then sweep the whole script for any other deleted procedure:

```bash
grep -n "getSalaryBands\|getBenefitsUtilization\|getCompaRatioDistribution\|listPendingAdjustments\|myCompensation\|createAdjustment\|approveAdjustment" tools/test-apis.sh
# expected: no output
```

---

- [ ] **Step 45: Cross-reference sweep — sibling wrapper headers**

Compensation is now only _partially_ dual-path, so listing it plainly in a sibling's "Mirrors … exactly" list is misleading, and removing it entirely would also be wrong (3 hooks still do exactly that).

**a)** `apps/web/lib/platform-api/dei.ts` lines **11–12**, before:

```ts
// Mirrors lib/platform-api/{access-review,audit-log,billing,compensation,
// engagement}.ts exactly: each hook calls BOTH the tRPC hook (enabled when NOT viaCSharp) and a
```

After:

```ts
// Mirrors lib/platform-api/{access-review,audit-log,billing,engagement}.ts — and compensation.ts's
// 3 FX-gated hooks only (its other 7 went C#-only on 2026-07-29) — exactly: each hook calls BOTH
// the tRPC hook (enabled when NOT viaCSharp) and a
```

**b)** `apps/web/lib/platform-api/engagement.ts` line **10**, before:

```ts
// Mirrors lib/platform-api/{access-review,audit-log,billing,compensation,dei}.ts
```

After:

```ts
// Mirrors lib/platform-api/{access-review,audit-log,billing,dei}.ts — and compensation.ts's 3
// FX-gated hooks only (its other 7 went C#-only on 2026-07-29) —
```

**c)** `apps/web/lib/platform-api/billing.ts` line **302**, before:

```ts
// (billing-plans.tsx, settings/billing/page.tsx) — a 100% wrap rate, like compensation's. Each hook
```

After:

```ts
// (billing-plans.tsx, settings/billing/page.tsx) — a 100% wrap rate, as compensation's writes also
// had before their TS side was deleted (they are C#-only now). Each hook
```

**d)** Confirm-only, no change needed: `apps/web/lib/platform-api/dei.ts:318` (the `comp-left-column.tsx PayEquityCard` call-site note — still accurate, that page reuses the DEI domain's read) and `apps/web/lib/platform-api/client.ts:6` (already retargeted off ninebox onto `dei.ts` by `0480ef6`).

---

- [ ] **Step 46: Cross-reference sweep — prose citing a deleted procedure**

**a)** `packages/api/src/services/compensation.service.ts` lines **12–14**, before:

```ts
 * Single source of truth for both `compensation.getEmployeeComp` (HR/leader
 * reading a subject in their scope) and `compensation.myCompensation` (an
 * employee reading their OWN row, subject hard-pinned to the caller). Reusing
```

After:

```ts
 * Used by `compensation.getEmployeeComp` (HR/leader reading a subject in their
 * scope). It was also the single source of truth for `compensation.myCompensation`
 * (an employee reading their OWN row, subject hard-pinned to the caller) until that
 * procedure was deleted on 2026-07-29 — the C# port keeps the same shared shape. Reusing
```

**b)** `packages/shared/src/compensation.ts` lines **5–7**, before:

```ts
// This slice extracts the two FX-FREE aggregate kernels: buildCompaRatioDistribution (read #4 — the meaty
// min-5 kernel) and buildBenefitsUtilization (read #3). The five FX-dependent reads (convertMoney/getFxRate)
// stay in the router and are Slice 9b.
```

After:

```ts
// This slice extracts the two FX-FREE aggregate kernels: buildCompaRatioDistribution (read #4 — the meaty
// min-5 kernel) and buildBenefitsUtilization (read #3). The five FX-dependent reads (convertMoney/getFxRate)
// stay in the router and are Slice 9b.
//
// NOTE (2026-07-29): the TS router no longer calls buildCompaRatioDistribution or
// buildBenefitsUtilization — those two procedures were deleted once the C# read surface went live.
// Both kernels are DELIBERATELY KEPT: they remain the golden-fixtured cross-stack contract
// (contracts/compensation-fixtures/*, asserted by both this repo's vitest and the C# unit tests),
// and apps/web/lib/platform-api/compensation.ts imports their result types.
```

**c)** `tests/compensation/compa-ratio-distribution-fixtures.test.ts` lines **4–5**, before:

```ts
 * Asserts the REAL @tims/shared buildCompaRatioDistribution (the SAME kernel compensation
 * .getCompaRatioDistribution now returns) against the shared golden
```

After:

```ts
 * Asserts the REAL @tims/shared buildCompaRatioDistribution (the kernel the deleted
 * compensation.getCompaRatioDistribution used to return, and the one the C# port mirrors) against the shared golden
```

**d)** `tests/compensation/benefits-utilization-fixtures.test.ts` lines **4–5**, before:

```ts
 * Asserts the REAL @tims/shared buildBenefitsUtilization (the SAME kernel compensation
 * .getBenefitsUtilization now returns) against the shared golden
```

After:

```ts
 * Asserts the REAL @tims/shared buildBenefitsUtilization (the kernel the deleted
 * compensation.getBenefitsUtilization used to return, and the one the C# port mirrors) against the shared golden
```

**e)** `apps/web/app/(admin)/compensation/comp-right-column.tsx` line **14**, before:

```tsx
// Compa-ratio buckets as returned by getCompaRatioDistribution, with display meta.
```

After:

```tsx
// Compa-ratio buckets as returned by the C# GET /compensation/compa-ratio-distribution read
// (via useCompensationCompaRatioDistribution), with display meta.
```

**f)** Confirm-only, no change needed:

- `tests/compensation/comp-fx-shaping-fixtures.test.ts:6` — "the SAME kernels packages/api/src/routers/compensation.ts now delegates to" names `buildBandDistribution`/`buildCompPayEquity`/`buildTotalCompBreakdown`/`buildCompDashboardKpis`/`buildSimulateAdjustment`; **all five survive** in the router. Still true.
- `scripts/parity/checks/rls.ts:54` — "…rather than a 404 (which compensation/succession use)". Verify it still holds for the 2 surviving endpoints (`market-comparison` is not a by-id route; `employee` is the by-id route and returns 404 on a cross-tenant id). Leave unchanged.
- `scripts/deploy/set-parity-secrets.sh:5,86` — "…direct SQL, e.g. compensation/evaluation360". Still accurate (the seed still uses raw SQL).
- `apps/web/lib/platform-api/schema.d.ts` — generated OpenAPI types for the C# service; all 14 `/compensation/*` paths stay.
- `apps/web/lib/nav/manifest.ts:73,107` — module-level nav entries, not procedure names.
- `contracts/compensation-fixtures/`, `contracts/comp-fixtures/`, `services/Tims.Platform/**` — the C# side is the replacement; nothing to delete.

**g)** **Explicitly OUT OF SCOPE:** `scripts/parity/README.md:3` claims `verify compensation` triggers "a full parity suite covering Candidate, Team, Intel, and premium assessments". That is **already factually wrong today** (compensation's surface has nothing to do with candidates or assessments) and is not caused by this change. Deferred, following the precedent of `0901624` deferring `docs/API-SPEC.md` drift on the nine-box branch. Do **not** fix it in this branch.

---

- [ ] **Step 47: Confirm the two "no change expected" files really need no change, then run the final repo-wide staleness grep**

**a)** `apps/web/lib/trpc-types.ts` — unlike nine-box (which had to remove entries plus an orphaned section header in `0480ef6`/`0901624`), compensation has **no** `RouterOutput["compensation"][...]` re-derivations. Confirm and leave the file untouched:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
grep -in "compensation" apps/web/lib/trpc-types.ts
# expected: no output. If this returns a hit, the investigation was wrong for this file —
# prune the dead alias(es) and any orphaned section header the same way 0480ef6 did.
```

**b)** `packages/api/src/root.ts` — the router survives (7 procedures), so the mount stays:

```bash
grep -n "compensationRouter" packages/api/src/root.ts
# expected: exactly 2 hits (the import at :19 and `compensation: compensationRouter` at :71). Leave both.
```

**c)** Also confirm no FE component derives a type from a deleted procedure (the investigation found zero, but re-verify — this is the class of gap that bites at review time):

```bash
grep -rn "RouterOutput\|inferRouterOutputs\|trpc-types" "apps/web/app/(admin)/compensation" "apps/web/app/(admin)/dashboard" "apps/web/app/(admin)/talent/succession"
# expected: no output
```

**d)** Final repo-wide staleness grep:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
for p in getSalaryBands getBenefitsUtilization getCompaRatioDistribution listPendingAdjustments myCompensation createAdjustment approveAdjustment; do
  echo "=== $p ==="
  grep -rn "$p" \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
    --exclude-dir=.claude --exclude-dir=.superpowers \
    --exclude-dir=services --exclude-dir=contracts \
    . | grep -v "docs/superpowers/plans/" | grep -v "schema.d.ts"
done
```

Every remaining hit must be one of: (a) a **C# path or endpoint name** (`/compensation/pending-adjustments`, `/compensation/my-compensation`, `/compensation/adjustments`), (b) an **FE hook name** (`useCompensationListPendingAdjustments`, `useCompensationMyCompensation`, `useCompensationCreateAdjustment`, `useCompensationApproveAdjustment`), (c) **historical prose deliberately written in the past tense** by Steps 25–46, or (d) `docs/REMAINING-WORK.md` / `scripts/deploy/*` notes updated above. **Any hit that reads as a present-tense claim about a live TS procedure is a bug in this task — fix it before proceeding.**

---

- [ ] **Step 48: Full verification (evidence before assertions)**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
pnpm --filter @tims/api exec tsc --noEmit
(cd apps/web && npx tsc --noEmit)
npx vitest run 2>&1 | tail -20
npx tsx scripts/parity/surfaces.test.ts 2>/dev/null || npx vitest run scripts/parity/surfaces.test.ts
```

Fill in and check against Step 1's baseline:

```
AFTER:
  vitest tests   : ____ passed   (baseline ____, delta ____; predicted −31)
  vitest files   : ____ passed   (baseline ____, delta 0 — no test FILE is deleted)
  tsc @tims/api  : clean
  tsc apps/web   : clean
```

Rules for this step:

- **Zero failing tests.** A failure here is a real regression, not an expected consequence — debug it with superpowers:systematic-debugging before continuing.
- **The test-file count must be unchanged** (every affected file retains surviving describes).
- **Report the MEASURED delta, not −31.** If the measured delta differs from the prediction, do not "fix" the tests to match the prediction — find out which test the prediction miscounted and say so explicitly in the commit message.

Also run the code-quality greps this repo's gate uses:

```bash
grep -rn "queryRawUnsafe\|executeRawUnsafe\|dangerouslySetInnerHTML\|: any\b\|as any\b" \
  packages/api/src/routers/compensation.ts apps/web/lib/platform-api/compensation.ts
# expected: no output
```

---

- [ ] **Step 49: Commit**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats
git add -A
git status --short   # review before committing
```

Commit message (fill in the REAL measured test numbers from Step 48 — do not paste the prediction):

```
refactor(compensation): delete dead TS reads/writes (7 of 14 procedures) + truth-up cutover tooling

Deletes the 5 FX-free read procedures (getSalaryBands, getCompaRatioDistribution,
getBenefitsUtilization, listPendingAdjustments, myCompensation) and both write procedures
(createAdjustment, approveAdjustment) superseded by the live-in-prod C# Platform compensation
read/write surfaces (NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP and _WRITE_VIA_CSHARP both
confirmed true in Vercel production).

FIRST PARTIAL WRAPPER REWRITE in this migration: apps/web/lib/platform-api/compensation.ts
keeps its inferRouterOutputs<AppRouter> import for exactly 3 type aliases, because
getBandDistribution/getTotalCompBreakdown/getDashboardKpis stay dual-path — they are gated by
NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP, re-verified on 2026-07-29 as still absent from
Vercel production, so TypeScript is their LIVE PROD PATH and they are deliberately retained.
The other 7 hooks become C#-only with hand-declared types (or types re-sourced from the
@tims/shared kernels the C# port is golden-fixtured against). All 10 hook names/params/return
shapes are preserved, so the only FE call-site changes are two dead tRPC invalidate lines in
approve-adjustment-modal.tsx and request-adjustment-modal.tsx.

The 4 zero-FE-consumer procedures (getPayEquity, simulateAdjustment, getMarketComparison,
getEmployeeComp) stay untouched, unrelated pre-existing dead code.

SECURITY REVIEW NOTE (CLAUDE.md: "Security changes require explicit review note"): deleting
createAdjustment/approveAdjustment also deletes 11 tests in
tests/access/scope-wiring-sensitive-data.test.ts that were the ONLY TypeScript-side assertions
of two §21 guarantees — the minimal-select invariant (a write response must never echo an
unselected SalaryAdjustment row) and the atomic conditional state transition on approve
($transaction + conditional updateMany + count===0 -> CONFLICT + in-transaction
employee_compensations propagation). Those guarantees now live exclusively in the C#
implementation plus scripts/parity/write-surfaces.ts's readbackMutated/readbackNoMutation raw-SQL
readbacks, which do assert both the transaction side-effect and the no-leak case. This is an
accepted, deliberate tradeoff consistent with every other completed domain in this migration
(the TS side is being retired, not weakened), not an oversight.

Truths up scripts/parity/surfaces.ts (7 -> 2 endpoints; verify compensation stays a REAL check,
so the status is CONFIRMED_LIVE, not TS_DELETED) + its test assertions, scripts/deploy/cutover.sh
+ README-cutover.md (read FLIP_READY -> CONFIRMED LIVE; compensation-write stays COEXISTENCE by
design, with an UPDATE clause), .env.example (both compensation read/write flags marked RETIRED),
docs/REMAINING-WORK.md (deletion tally 6 -> 7 of 12 live surfaces; only engagement write remains),
and tools/test-apis.sh (swapped a deleted procedure out of the smoke test). Proactively retargets
README-cutover.md's worked example off compensation onto dei, the recurring
"worked-example citation goes stale" pattern from 4 prior domains.

Deferred, explicitly out of scope: scripts/parity/README.md:3's pre-existing wrong description of
what `verify compensation` covers (same precedent as deferring docs/API-SPEC.md on the nine-box
branch).

tsc clean on @tims/api and apps/web. Full vitest: <BEFORE> -> <AFTER> tests (<DELTA>),
<N>/<N> files green both before and after.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

---

- [ ] **Step 50: Request review**

Use superpowers:requesting-code-review for the whole branch, and dispatch the `codex:codex-rescue` agent per `.claude/rules/verification.md` for the adversarial cross-model pass. Explicitly ask both reviewers to check:

1. That no FX-gated code path (`getBandDistribution` / `getTotalCompBreakdown` / `getDashboardKpis`, their 3 wrapper hooks, `COMPENSATION_FX_VIA_CSHARP`, `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP`) was modified — this is the one change in this branch that could break live production traffic.
2. That every doc/comment claim added by Steps 25–46 is literally true (file:line evidence, no overstatement) — especially the past-tense rewrites.
3. That the reported vitest delta is the measured one, not the predicted one.
4. That the security note is present in the commit message and accurately describes what coverage moved where.
5. Whether any generic worked-example / help-text surface still cites compensation as a live-TS or flip-ready surface (the recurring staleness pattern).
   </content>
   </invoke>
