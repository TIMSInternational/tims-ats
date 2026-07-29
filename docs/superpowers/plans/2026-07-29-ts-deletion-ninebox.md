# TS Deletion: nine-box (10 of 16 procedures) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-dead TS fallback for nine-box's 10 wrapped-and-live procedures (7 reads gated on `NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP`, 3 writes gated on `NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP`, both confirmed live in prod) and truth up every doc/tooling reference that assumed a live TS side existed. This is the 6th domain through this pattern (after reporting, evaluation360, team-intel, billing-usage, succession).

**Architecture:** The router (`packages/api/src/routers/ninebox.ts`) keeps 6 procedures with zero FE consumers (`getAxisBreakdown`, `getMovementHistory`, `simulate`, `submitCalibrationVote`, `finalizeCalibration`, `getQuadrantPlan` — pre-existing dead code unrelated to this migration, confirmed via full-repo grep, out of scope) so it **cannot be deleted** — surgical in-file deletion, same shape as team-intel/billing-usage/succession. Nine-box is succession's closest analog: the FE wrapper (`apps/web/lib/platform-api/ninebox.ts`) wraps **100% of its content** around the 10 in-scope procedures (confirmed: all 10 exported hooks — `useNineBoxGrid`, `useNineBoxEmployeeDetail`, `useNineBoxBenchStrength`, `useNineBoxDashboardKpis`, `useNineBoxListCalibrations`, `useNineBoxCalibration`, `useNineBoxMyCalibrations`, `useNineBoxCreateCalibration`, `useNineBoxAddCalibrationMember`, `useNineBoxRemoveCalibrationMember`, plus `isNineboxForbiddenError`/`invalidateNineboxPlatformReads` — map 1:1 to the 10 deleted procedures; the file's own header comment already documents that the 6 survivors get zero wrapper) — so the wrapper gets a **full-file rewrite** (C#-only, hand-declared types; `quadrant`/`status` stay `string` — the Prisma columns are plain `String` with no enum, unlike succession's `criticality`/`readiness`). Nine-box has a companion schemas file (`ninebox.schemas.ts`, a plain Zod barrel) with 6 dead exports once the router stops importing them (confirmed zero other importers in `packages/api`) — those get deleted too. `ninebox.helpers.ts` is a pre-existing 3-line re-export shim that is *already* an orphan (confirmed via repo-wide grep — its only other reference is a comment, not an import) — out of scope, left untouched, exactly like this migration's precedent for similar orphans.

**Tech Stack:** tRPC (`packages/api`), Next.js/React Query (`apps/web`), TypeScript strict mode, Prisma (`@tims/db`).

## Global Constraints

- Do NOT delete `packages/api/src/routers/ninebox.ts` itself, and do NOT touch `getAxisBreakdown`, `getMovementHistory`, `simulate`, `submitCalibrationVote`, `finalizeCalibration`, `getQuadrantPlan` — confirmed zero FE call sites, pre-existing dead code unrelated to this migration, out of scope.
- Do NOT delete `packages/api/src/routers/ninebox.helpers.ts` — it is already an orphan (pre-existing, unrelated to this deletion) per this migration's established precedent of leaving such orphans alone.
- `tsc --noEmit` must pass on both `@tims/api` and `@tims/web` after this change.
- Full `npx vitest run` (repo root) must pass, not just `tsc` — get REAL before/after test counts by actually running it; never assert a number without verifying (a mistake made twice already in this migration).
- **The `scripts/parity/surfaces.ts` `ninebox` entry must be SHRUNK, not removed** — 4 of its 11 registered endpoints (`movement-history`, `simulate`, `quadrant-plan`, `axis-breakdown`) map to procedures that stay in the router. `--verify-only` for this surface keeps a real, still-meaningful 4-endpoint check after the deletion.
- **Because nine-box's read-side parity check stays partially real**, its `cutover.sh`/`README-cutover.md` status must NOT become `TS_DELETED` (that means "no TS side left to diff against ANYWHERE for this surface," which would be false here) and its `parity_command` stays `verify` (not `NONE`) — use `CONFIRMED_LIVE` instead, mirroring succession's precedent exactly. Do NOT add `nine-box` to `README-cutover.md`'s "why not X" no-op list — its `--verify-only` is not a no-op.
- `nine-box-write`'s cutover status: `write-surfaces.ts`'s `nineboxSurface` tests the C# HTTP endpoints directly (confirmed via grep — zero TS-router dependency), so it is completely unaffected by this deletion. Its status should simply be corrected from stale `FLIP_READY` to `CONFIRMED_LIVE` (the flag genuinely is live), with no `parity_command` change.
- `.env.example` is **missing BOTH** `NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP` and `NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP` entirely (unlike every prior domain, which was missing at most one) — I could not independently verify this myself (the file sits in a sandbox-denied directory for this planning session), so this carries forward the pre-verified claim; **the implementing agent MUST verify with a fresh grep before treating the hand-off as "add two new lines" instead of "patch two existing lines."** Hand Federico both new-line additions per Step 18.
- **Proactive cross-reference staleness checks are REQUIRED, not optional** — this is a lesson from 3 prior domains' whole-branch reviews finding this same class of gap after the fact. Specifically: `apps/web/lib/platform-api/client.ts`'s module header citation (Step 15), `apps/web/lib/nav/manifest.ts`'s `ninebox.myCalibrations` comment (Step 16), and confirming `engagement.ts`/`dei.ts`'s nine-box references are pattern-citations-only (Step 17) must all be checked and either fixed or explicitly confirmed-no-fix-needed with file:line evidence.
- **This worktree's copies of `scripts/parity/surfaces.ts`, `surfaces.test.ts`, `scripts/deploy/cutover.sh`, `README-cutover.md`, `docs/REMAINING-WORK.md`, and `tests/access/scope-wiring-talent.test.ts` were stale relative to `main`** when this plan was written (they predate team-intel/billing-usage/succession's actual merges) — every before/after quote below for those 6 files was taken from `main`, not from a local working copy. Before executing, re-pull/rebase so the local tree matches `main` for these files, then diff against the "Before" quotes here to confirm they still match exactly (line numbers may have drifted further if other work has landed since).

---

### Task 1: Delete the dead TS code + truth-up parity/cutover tooling

**Files:**

- Modify: `packages/api/src/routers/ninebox.ts` (delete 7 read + 3 write procedures + fix imports; keep 6 procedures + their imports)
- Modify: `packages/api/src/routers/ninebox.schemas.ts` (delete 6 now-dead schema exports; keep 6)
- Modify: `apps/web/lib/platform-api/ninebox.ts` (full-file rewrite: C#-only, hand-declared types)
- Modify: `apps/web/app/(admin)/talent/nine-box/committee-members-panel.tsx` (remove 1 dead invalidate line + now-unused `utils`/`trpc` import — the ENTIRE import, mirroring succession's Step 4/5 shape, not the partial Step 6 shape)
- Modify: `apps/web/lib/trpc-types.ts` (delete 2 dead type-alias lines — confirmed zero real consumers)
- Modify: `scripts/parity/surfaces.ts` (shrink the `ninebox` entry from 11 to 4 endpoints; rewrite its doc-comment block)
- Modify: `scripts/parity/surfaces.test.ts` (4 assertions: endpoint count, by-id expected map, byIdCount total, globalScope test's endpoint references)
- Modify: `scripts/deploy/cutover.sh` (nine-box read status: `FLIP_READY`→`CONFIRMED_LIVE` with a note; nine-box-write status: `FLIP_READY`→`CONFIRMED_LIVE`, stale note corrected)
- Modify: `scripts/deploy/README-cutover.md` (both table rows' status column)
- Modify: `docs/REMAINING-WORK.md` (deletion tally: 5→6, add nine-box's partial-deletion clause, remove nine-box from "remaining live surfaces")
- Modify: `tests/access/membership-admin-committee.test.ts` (delete 2 whole `describe` blocks + the now-unused `ninebox` helper const)
- Modify: `tests/access/scope-wiring-talent.test.ts` (rewrite the ninebox taxonomy header comment; delete the `myCalibrations` describe block; rename/refocus 2 vacuous-pass tests)
- Modify: `apps/web/lib/platform-api/client.ts` (repoint the module-header citation from `ninebox.ts` to `dei.ts`)
- Modify: `apps/web/lib/nav/manifest.ts` (fix a comment naming `ninebox.myCalibrations`, a deleted procedure)
- Confirm-only (no changes): `packages/api/src/routers/ninebox.helpers.ts` (already an orphan, pre-existing, out of scope), `tests/ninebox/kernels-fixtures.test.ts` (tests `@tims/shared` kernels directly, never the router), `tests/tier1/*ninebox*` (confirmed: no such file exists), `scripts/parity/write-surfaces.ts`'s `nineboxSurface` (tests C# HTTP directly), `scripts/parity/README.md` and `README-cutover.md`'s worked-example walkthrough (uses `compensation`, doesn't mention nine-box anywhere breaking), `apps/web/lib/platform-api/engagement.ts`/`dei.ts` (nine-box references are design-pattern citations, not deleted-procedure names)
- Federico hand-off only (cannot be automated): `.env.example` (add 2 new `NEXT_PUBLIC_NINEBOX_*_VIA_CSHARP` lines)

**Interfaces:**

- Consumes: nothing from earlier tasks (first and only task).
- Produces: all 10 hook names (`useNineBoxGrid`, `useNineBoxEmployeeDetail`, `useNineBoxBenchStrength`, `useNineBoxDashboardKpis`, `useNineBoxListCalibrations`, `useNineBoxCalibration`, `useNineBoxMyCalibrations`, `useNineBoxCreateCalibration`, `useNineBoxAddCalibrationMember`, `useNineBoxRemoveCalibrationMember`) plus `isNineboxForbiddenError`/`invalidateNineboxPlatformReads` stay identical in name, params, and return shape — every FE call site (`talent/nine-box/page.tsx`, `talent/nine-box/committee-members-panel.tsx`, `dashboard/committee-tasks-dashboard.tsx`) needs zero changes beyond the one `committee-members-panel.tsx` invalidate-line fix in Step 6.

---

- [ ] **Step 1: Delete the 7 dead read procedures + 3 dead write procedures from the router (bottom-to-top, to keep other line numbers stable while editing)**

In `packages/api/src/routers/ninebox.ts`:

**a) The `getDashboardKpis` procedure (including its `// ── Dashboard KPIs ──` section header):**

Before:
```typescript
  // ── Dashboard KPIs ───────────────────────────────────────────────────

  getDashboardKpis: permissionProcedure('ninebox', 'read')
    .input(getDashboardKpisInput)
    .query(async ({ ctx, input }) => {
      // Org-rollup dashboard aggregate → interim org-gate (slice-6 follow-up).
      requireOrgScope(ctx.access);

      const orgId = ctx.user.organizationId;

      const [totalEvaluations, calibrationSessions, activeCalibrations] = await Promise.all([
        db.nineBoxEvaluation.count({
          where: { organizationId: orgId, period: input.period },
        }),
        db.calibrationSession.count({
          where: { organizationId: orgId, period: input.period },
        }),
        db.calibrationSession.count({
          where: { organizationId: orgId, period: input.period, status: { not: 'finalized' } },
        }),
      ]);

      const evaluations = await db.nineBoxEvaluation.findMany({
        where: { organizationId: orgId, period: input.period },
        select: { quadrant: true },
      });

      return {
        period: input.period,
        totalEvaluations,
        calibrationSessions,
        activeCalibrations,
        // Pure kernel (@tims/shared) — quadrant→count, golden-fixtured both stacks.
        distribution: buildQuadrantDistribution(evaluations.map((ev) => ev.quadrant)),
      };
    }),
});
```

After (the section is gone; `getQuadrantPlan` is now the last procedure before the closing brace):
```typescript
});
```

**b) The `getBenchStrength` procedure (its `// ── Plans & Analytics ──` header stays — `getQuadrantPlan` still lives under it):**

Before:
```typescript
  getBenchStrength: permissionProcedure('ninebox', 'read')
    .input(getBenchStrengthInput)
    .query(async ({ ctx, input }) => {
      // Org-rollup aggregate (quadrant distribution across the whole org) →
      // interim org-gate until slice-6 scope-aware aggregation lands.
      requireOrgScope(ctx.access);

      const evaluations = await db.nineBoxEvaluation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          period: input.period,
        },
        select: { quadrant: true },
      });

      // Pure kernel (@tims/shared) — distribution + highPotentialRatio (half-up), golden-fixtured both stacks.
      return { period: input.period, ...buildBenchStrength(evaluations.map((ev) => ev.quadrant)) };
    }),

```

After (empty — nothing replaces it; `getQuadrantPlan`'s closing `}),` is immediately followed by the router's closing `});`):
```typescript

```

**c) The `removeCalibrationMember` procedure:**

Before:
```typescript
  removeCalibrationMember: permissionProcedure('ninebox', 'update')
    .input(z.object({ sessionId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Committee membership administration is org-governance (mirror of
      // addCalibrationMember) → org/company scope only.
      requireOrgScope(ctx.access);
      const session = await db.calibrationSession.findFirst({
        where: { id: input.sessionId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de calibracion no encontrada' });
      const result = await db.calibrationMember.deleteMany({
        where: { sessionId: input.sessionId, userId: input.userId },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Miembro no encontrado' });
      return { success: true };
    }),

```
After: (deleted entirely — nothing replaces it)

**d) The `addCalibrationMember` procedure (including its `// ── Calibration committee membership...` section header):**

Before:
```typescript
  // ── Calibration committee membership on an EXISTING session ──────────
  // Populates CalibrationMember, the committee anchor. ninebox:update; session
  // org-verified (NOT_FOUND otherwise) and the member must be in-org.
  addCalibrationMember: permissionProcedure('ninebox', 'update')
    .input(z.object({ sessionId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Committee membership is ORG-GOVERNANCE (sessions have no team/unit
      // anchor). A committee user holds ninebox@team — without this gate they
      // could self-add to ANY session and then vote (self-promotion). Restrict
      // membership writes to org/company-scope admins.
      requireOrgScope(ctx.access);
      try {
        return await db.$transaction(async (tx) => {
          const [session, user] = await Promise.all([
            tx.calibrationSession.findFirst({
              where: { id: input.sessionId, organizationId: ctx.user.organizationId },
              select: { id: true },
            }),
            tx.user.findFirst({
              where: { id: input.userId, organizationId: ctx.user.organizationId },
              select: { id: true },
            }),
          ]);
          if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de calibracion no encontrada' });
          if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
          return tx.calibrationMember.create({
            data: { sessionId: input.sessionId, userId: input.userId, status: 'invited' },
            select: { id: true },
          });
        });
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'El usuario ya es miembro de este comite' });
        }
        throw err;
      }
    }),

```
After: (deleted entirely)

**e) The `myCalibrations` procedure (including its long comment block):**

Before:
```typescript
  // "Mis Calibraciones" — the committee landing's member-scoped list. Surfaces
  // ONLY the caller's own sessions: those they CREATED or are a CalibrationMember
  // of. NOT org-wide (listCalibrations is requireOrgScope and FORBIDDEN here) and
  // NOT via scopeWhereFor (calibrationSession is not a registered ENTITY — that
  // would throw). Hand-roll the createdById-OR-membership anchor, exactly like
  // getCalibration. Tenant-isolated, explicit select, bounded.
  myCalibrations: permissionProcedure('ninebox', 'read')
    .query(async ({ ctx }) => {
      return db.calibrationSession.findMany({
        where: {
          AND: [
            { organizationId: ctx.user.organizationId },
            {
              OR: [
                { createdById: ctx.user.id },
                { members: { some: { userId: ctx.user.id } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          period: true,
          status: true,
          scheduledAt: true,
          completedAt: true,
          createdAt: true,
          _count: { select: { members: true, votes: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    }),

```
After: (deleted entirely — `createCalibration`/`listCalibrations`'s deletion in the next sub-steps means `submitCalibrationVote` now follows directly after the void left here)

**f) The `getCalibration` procedure:**

Before:
```typescript
  getCalibration: permissionProcedure('ninebox', 'read')
    .input(getCalibrationInput)
    .query(async ({ ctx, input }) => {
      // Org/company scopes see any session; narrow scopes (committee members)
      // may only read a session they CREATED or are a MEMBER of.
      if (ctx.access.scope !== 'organization' && ctx.access.scope !== 'company') {
        const session = await db.calibrationSession.findFirst({
          where: { id: input.id, organizationId: ctx.user.organizationId },
          select: { id: true, createdById: true },
        });
        if (!session) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de calibracion no encontrada' });
        }
        if (session.createdById !== ctx.user.id) {
          const membership = await db.calibrationMember.findFirst({
            where: { sessionId: input.id, userId: ctx.user.id },
            select: { id: true },
          });
          if (!membership) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Solo un miembro del comite puede ver esta sesion',
            });
          }
        }
      }

      return db.calibrationSession.findFirstOrThrow({
        where: {
          id: input.id,
          organizationId: ctx.user.organizationId,
        },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true } },
          members: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
          },
          votes: {
            include: {
              evaluatedUser: { select: { id: true, firstName: true, lastName: true } },
              voter: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });
    }),

```
After: (deleted entirely)

**g) The `listCalibrations` procedure:**

Before:
```typescript
  listCalibrations: permissionProcedure('ninebox', 'read')
    .query(async ({ ctx }) => {
      // Listing all calibration sessions is org-governance (committee-membership
      // administration reads the same list). Committee members hold ninebox@team
      // and must NOT enumerate every org session → org/company scope only.
      requireOrgScope(ctx.access);
      return db.calibrationSession.findMany({
        where: { organizationId: ctx.user.organizationId },
        select: {
          id: true,
          period: true,
          status: true,
          scheduledAt: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    }),

```
After: (deleted entirely)

**h) The `createCalibration` procedure (including the `// ── Calibration ──` section header — `submitCalibrationVote` survives under this same header, so the header itself stays; only the procedure body is removed):**

Before:
```typescript
  // ── Calibration ──────────────────────────────────────────────────────

  createCalibration: permissionProcedure('ninebox', 'create')
    .input(createCalibrationInput)
    .mutation(async ({ ctx, input }) => {
      // Creating a calibration session is an org-governance act — the matrix
      // grants committee members read/update@team, NOT session creation. Narrow
      // scopes are FORBIDDEN here (no-op at org/company scope — deploy-neutral).
      requireOrgScope(ctx.access);

      // Cross-tenant hardening (Phase-5 Slice-15 / succession H1 lesson): the
      // nested calibration_members.create below inserts input.memberIds VERBATIM.
      // RLS only guards the SESSION linkage (calibration_members has no
      // organization_id), NOT the member user_id — so an org-scoped creator could
      // otherwise seed a cross-tenant member (org-A session, org-B user). Validate
      // every memberId is a user in the caller's org BEFORE the nested insert; a
      // cross-org/nonexistent id → BAD_REQUEST, nothing written (atomic). Applied
      // in BOTH stacks (this router + the C# NineBoxWriteRepository) to keep parity.
      if (input.memberIds && input.memberIds.length > 0) {
        const uniqueMemberIds = [...new Set(input.memberIds)];
        const found = await db.user.findMany({
          where: { id: { in: uniqueMemberIds }, organizationId: ctx.user.organizationId },
          select: { id: true },
        });
        if (found.length !== uniqueMemberIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Uno o mas miembros no pertenecen a esta organizacion',
          });
        }
      }

      return db.calibrationSession.create({
        data: {
          organizationId: ctx.user.organizationId,
          period: input.period,
          status: 'draft',
          createdById: ctx.user.id,
          ...(input.scheduledAt && { scheduledAt: new Date(input.scheduledAt) }),
          ...(input.memberIds && {
            members: {
              create: input.memberIds.map((userId) => ({
                userId,
                status: 'invited',
              })),
            },
          }),
        },
        include: { members: true },
      });
    }),

```
After:
```typescript
  // ── Calibration ──────────────────────────────────────────────────────

```

**i) The `getEmployeeDetail` procedure:**

Before:
```typescript
  getEmployeeDetail: permissionProcedure('ninebox', 'read')
    .input(getEmployeeDetailInput)
    .query(async ({ ctx, input }) => {
      // Point-read of one employee's evaluation: the target must be in the
      // caller's subject set (own/team/unit).
      await assertSubjectInScope(
        ctx.access,
        ctx.user.id,
        input.userId,
        'No puedes ver esta evaluacion',
      );

      const evaluation = await db.nineBoxEvaluation.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          userId: input.userId,
          period: input.period,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              jobTitle: true,
              email: true,
            },
          },
        },
      });

      // Fetch history across periods
      const history = await db.nineBoxEvaluation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          userId: input.userId,
        },
        orderBy: { evaluatedAt: 'asc' },
        select: {
          period: true,
          quadrant: true,
          potentialScore: true,
          performanceScore: true,
          evaluatedAt: true,
        },
      });

      return { evaluation, history };
    }),

```
After: (deleted entirely)

**j) The `getGrid` procedure (the `// ── Grid ──` header stays — `getAxisBreakdown`/`getMovementHistory`/`simulate` still live under it):**

Before:
```typescript
  getGrid: permissionProcedure('ninebox', 'read')
    .input(getGridInput)
    .query(async ({ ctx, input }) => {
      // Build user filter based on scope
      let userFilter: Prisma.NineBoxEvaluationWhereInput = {};
      if (input.teamId) {
        const members = await db.userTeam.findMany({
          where: { teamId: input.teamId },
          select: { userId: true },
        });
        userFilter = { userId: { in: members.map((m) => m.userId) } };
      } else if (input.unitId) {
        const teamMembers = await db.userTeam.findMany({
          where: { team: { businessUnitId: input.unitId } },
          select: { userId: true },
        });
        userFilter = { userId: { in: teamMembers.map((m) => m.userId) } };
      } else if (input.companyId) {
        userFilter = { user: { companyId: input.companyId } };
      }

      // Scope fragment (own/team/unit → row filter; org → {}). The existing
      // teamId/unitId/companyId input branches only INTERSECT — they narrow
      // within the caller's grant, never widen it.
      const scopeWhere = (await scopeWhereFor('nineBoxEvaluation', ctx.access, ctx.user.id)) as Prisma.NineBoxEvaluationWhereInput;

      const evaluations = await db.nineBoxEvaluation.findMany({
        where: {
          AND: [
            { organizationId: ctx.user.organizationId, period: input.period },
            userFilter,
            scopeWhere,
          ],
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              jobTitle: true,
            },
          },
        },
        orderBy: { evaluatedAt: 'desc' },
      });

      // Pure kernel (@tims/shared) — group by quadrantToGrid preserving evaluatedAt-desc order,
      // golden-fixtured both stacks.
      const grid = gridPlacement(evaluations, (evaluation) => evaluation.quadrant);

      return { period: input.period, grid, totalEvaluations: evaluations.length };
    }),

```
After: (deleted entirely — `getAxisBreakdown` is now the first procedure under the `// ── Grid ──` header)

- [ ] **Step 2: Fix the router's import block**

Before:
```typescript
import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import {
  scopeWhereFor,
  assertSubjectInScope,
  requireOrgScope,
} from '../access';
import {
  getGridInput,
  getEmployeeDetailInput,
  getAxisBreakdownInput,
  getMovementHistoryInput,
  simulateInput,
  createCalibrationInput,
  getCalibrationInput,
  submitCalibrationVoteInput,
  finalizeCalibrationInput,
  getQuadrantPlanInput,
  getBenchStrengthInput,
  getDashboardKpisInput,
} from './ninebox.schemas';
import {
  simulateBands,
  resolveQuadrantPlan,
  buildBenchStrength,
  buildQuadrantDistribution,
  gridPlacement,
  computeMovements,
} from '@tims/shared';
```

After:
```typescript
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertSubjectInScope, requireOrgScope } from '../access';
import {
  getAxisBreakdownInput,
  getMovementHistoryInput,
  simulateInput,
  submitCalibrationVoteInput,
  finalizeCalibrationInput,
  getQuadrantPlanInput,
} from './ninebox.schemas';
import { simulateBands, resolveQuadrantPlan, computeMovements } from '@tims/shared';
```

`z` was only used by `addCalibrationMember`/`removeCalibrationMember`'s inline `z.object(...)` inputs (both deleted) — now unused, removed. `buildBenchStrength`, `buildQuadrantDistribution`, `gridPlacement` were only used by `getBenchStrength`/`getDashboardKpis`/`getGrid` (all deleted) — now unused, removed. `simulateBands`, `resolveQuadrantPlan`, `computeMovements` stay (used by the surviving `simulate`/`getQuadrantPlan`/`getMovementHistory`).

- [ ] **Step 3: Delete the 6 now-dead schema exports from `packages/api/src/routers/ninebox.schemas.ts`**

Confirmed via grep restricted to `packages/api`: `ninebox.ts` is the ONLY importer of `ninebox.schemas.ts`'s exports — so once Step 2 stops importing these 6, they are truly dead (no shadow-matching importer elsewhere).

Before:
```typescript
import { z } from 'zod';

// ── Grid ─────────────────────────────────────────────────────────────

export const getGridInput = z.object({
  period: z.string().max(100),
  companyId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

export const getEmployeeDetailInput = z.object({
  userId: z.string().uuid(),
  period: z.string().max(100),
});

export const getAxisBreakdownInput = z.object({
  userId: z.string().uuid(),
  period: z.string().max(100),
});

export const getMovementHistoryInput = z.object({
  userId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
});

export const simulateInput = z.object({
  userId: z.string().uuid(),
  newPotentialScore: z.number().min(0).max(100),
  newPerformanceScore: z.number().min(0).max(100),
});

// ── Calibration ──────────────────────────────────────────────────────

export const createCalibrationInput = z.object({
  period: z.string().max(100),
  scheduledAt: z.string().datetime().optional(),
  memberIds: z.array(z.string().uuid()).max(100).optional(),
});

export const getCalibrationInput = z.object({ id: z.string().uuid() });

export const submitCalibrationVoteInput = z.object({
  sessionId: z.string().uuid(),
  evaluatedUserId: z.string().uuid(),
  quadrant: z.string().max(100),
  justification: z.string().max(20000).optional(),
});

export const finalizeCalibrationInput = z.object({ sessionId: z.string().uuid() });

// ── Plans & Analytics ────────────────────────────────────────────────

export const getQuadrantPlanInput = z.object({ quadrant: z.string().max(100) });

export const getBenchStrengthInput = z.object({ period: z.string().max(100) });

// ── Dashboard KPIs ───────────────────────────────────────────────────

export const getDashboardKpisInput = z.object({ period: z.string().max(100) });
```

After:
```typescript
import { z } from 'zod';

// ── Grid ─────────────────────────────────────────────────────────────

export const getAxisBreakdownInput = z.object({
  userId: z.string().uuid(),
  period: z.string().max(100),
});

export const getMovementHistoryInput = z.object({
  userId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
});

export const simulateInput = z.object({
  userId: z.string().uuid(),
  newPotentialScore: z.number().min(0).max(100),
  newPerformanceScore: z.number().min(0).max(100),
});

// ── Calibration ──────────────────────────────────────────────────────

export const submitCalibrationVoteInput = z.object({
  sessionId: z.string().uuid(),
  evaluatedUserId: z.string().uuid(),
  quadrant: z.string().max(100),
  justification: z.string().max(20000).optional(),
});

export const finalizeCalibrationInput = z.object({ sessionId: z.string().uuid() });

// ── Plans & Analytics ────────────────────────────────────────────────

export const getQuadrantPlanInput = z.object({ quadrant: z.string().max(100) });
```

- [ ] **Step 4: Full-file rewrite of `apps/web/lib/platform-api/ninebox.ts`**

Before (the entire current file, 559 lines):
```typescript
'use client';

// Per-surface read gate for the SEVEN FE-consumed nine-box reads (getGrid /
// getEmployeeDetail / getBenchStrength / getDashboardKpis / listCalibrations / getCalibration /
// myCalibrations) — the seventh read surface staged to route to the C# Platform service. DARK by
// default: unless BOTH the platform-api base URL and NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP are set at
// deploy time, every hook returns the existing tRPC query unchanged (byte-identical to today).
// Merging changes nothing in prod until Federico flips the flag at cutover.
//
// Mirrors lib/platform-api/{reporting,billing,evaluation360,succession,compensation}.ts exactly:
// each hook calls BOTH the tRPC hook (enabled when NOT viaCSharp) and a C# useQuery (enabled when
// viaCSharp), then returns the active one. The C# useQuery is typed to the EXACT tRPC output type
// (inferRouterOutputs), so each mapper below is compile-time-locked to the live contract's shape —
// including the superjson Date semantics on the evaluation/calibration date fields, the jsonb
// `axisBreakdown` passthrough, and the number-as-string wire artifacts.
//
// SCOPE — the nine-box router exposes ELEVEN reads; only SEVEN are consumed by the FE (the three
// call sites: talent/nine-box/page.tsx, talent/nine-box/committee-members-panel.tsx,
// dashboard/committee-tasks-dashboard.tsx). The four NOT consumed by the FE — getMovementHistory,
// getAxisBreakdown, simulate, getQuadrantPlan — get NO wrapper here (they stay on tRPC; there is no
// call site to route). All eleven live behind the C# `Platform:NineBoxReadEnabled` backend flag
// (services/Tims.Platform/src/Tims.Api/NineBox/NineBoxReadEndpoints.cs), so the seven wrapped here
// share ONE FE flag mirroring it.
//
// MISSING-RECORD PARITY (verified per read against ninebox.ts + NineBoxReadEndpoints.cs):
//   - getEmployeeDetail — tRPC uses `findFirst` (returns null, NOT a throw); the C# route ALWAYS
//     returns 200 with a NULLABLE `evaluation` (EmployeeDetailView.Evaluation is `EmployeeDetail
//     Evaluation?`). No 404 is emitted for this read, so the wrapper just maps through, PRESERVING
//     `evaluation: null` (the empty state the page renders as "select an employee"). No throw.
//   - getCalibration — tRPC uses `findFirstOrThrow` (a missing session THROWS NOT_FOUND → the panel
//     renders its error branch); the C# route returns a clean 404 for the same case. Its tRPC output
//     type is NON-nullable, so returning null is impossible — the wrapper lets the 404 PROPAGATE as a
//     thrown PlatformApiError (react-query error state), matching tRPC's throw-on-missing exactly.
//   - getAxisBreakdown is the only OTHER 404-emitting read, and it is NOT FE-consumed (skipped).
//
// FORBIDDEN PARITY (listCalibrations): the tRPC read is org-governance — narrow-scope committee
// members reach the page but get FORBIDDEN. The page deliberately treats that as "no sessions
// visible" (empty state, never a crash). The C# route returns 403 for the same case. `isNineboxForbid
// denError` normalizes BOTH error shapes (tRPC `error.data.code === 'FORBIDDEN'` and PlatformApi
// Error status 403) so the call site's forbidden-as-empty rendering is identical on either path.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformDelete, platformGet, platformPost, PlatformApiError } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type GridOutput = RouterOutput['ninebox']['getGrid'];
type EmployeeDetailOutput = RouterOutput['ninebox']['getEmployeeDetail'];
type BenchStrengthOutput = RouterOutput['ninebox']['getBenchStrength'];
type DashboardKpisOutput = RouterOutput['ninebox']['getDashboardKpis'];
type ListCalibrationsOutput = RouterOutput['ninebox']['listCalibrations'];
type CalibrationOutput = RouterOutput['ninebox']['getCalibration'];
type MyCalibrationsOutput = RouterOutput['ninebox']['myCalibrations'];
type CreateCalibrationOutput = RouterOutput['ninebox']['createCalibration'];
type AddCalibrationMemberOutput = RouterOutput['ninebox']['addCalibrationMember'];
type RemoveCalibrationMemberOutput = RouterOutput['ninebox']['removeCalibrationMember'];

// Nested-shape aliases so each mapper is narrowed to the EXACT sub-object the tRPC output declares
// (no `any`; the jsonb `axisBreakdown` widened wire value is cast to the contract's JsonValue).
type GridEvalOut = GridOutput['grid'][string][number];
type EmployeeDetailEvalOut = NonNullable<EmployeeDetailOutput['evaluation']>;
type EmployeeHistoryOut = EmployeeDetailOutput['history'][number];
type CalibrationMemberOut = CalibrationOutput['members'][number];
type CalibrationVoteOut = CalibrationOutput['votes'][number];

// Second gate: even when the client is enabled, nine-box only routes to C# when its own flag is
// exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const NINEBOX_VIA_CSHARP = process.env.NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP === 'true';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the tRPC output declares.
const num = (v: number | string): number => Number(v);

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO converter.
// The tRPC output types them as Prisma `Date` (superjson rebuilds real Date objects), so the C# path
// reconstructs Date objects to be byte-identical at cutover. The contract types the raw values as
// `unknown`; parse to Date (or null for the nullable scheduledAt/completedAt columns).
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

// A quadrant→count distribution ({[key]: number}); map values only, PRESERVING key insertion order
// (the kernel emits first-seen order; Object.entries preserves it).
const mapDistribution = (raw: { [key: string]: number | string }): Record<string, number> =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, num(v)]));

/**
 * True when an error is the nine-box FORBIDDEN case, normalized across BOTH read paths: the tRPC
 * client error (`error.data.code === 'FORBIDDEN'`) and the C# {@link PlatformApiError} (status 403).
 * The nine-box page uses it so a narrow-scope committee member's listCalibrations 403 renders as an
 * empty session list (never an error card) on either path. Takes `unknown` → safe on the union.
 */
export function isNineboxForbiddenError(err: unknown): boolean {
  if (err instanceof PlatformApiError) return err.status === 403;
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { code?: string } | null }).data;
    return data?.code === 'FORBIDDEN';
  }
  return false;
}

// Full nine-box evaluation scalars shared by getGrid (grid cells). The user select carries
// jobTitle but NOT email (getEmployeeDetail's user select adds email).
const mapGridEvaluation = (e: {
  id: string;
  organizationId: string;
  userId: string;
  period: string;
  potentialScore: number | string;
  performanceScore: number | string;
  quadrant: string;
  confidence: number | string;
  axisBreakdown: unknown;
  evaluatedAt: unknown;
  createdAt: unknown;
  user: { id: string; firstName: string; lastName: string; avatar: string | null; jobTitle: string | null };
}): GridEvalOut => ({
  id: e.id,
  organizationId: e.organizationId,
  userId: e.userId,
  period: e.period,
  potentialScore: num(e.potentialScore),
  performanceScore: num(e.performanceScore),
  quadrant: e.quadrant,
  confidence: num(e.confidence),
  // jsonb passthrough: the contract widens the column to `unknown`; narrow it back to the exact
  // Prisma JsonValue the tRPC output declares (no `null` injection — the column is a real value).
  axisBreakdown: e.axisBreakdown as GridEvalOut['axisBreakdown'],
  evaluatedAt: toDate(e.evaluatedAt),
  createdAt: toDate(e.createdAt),
  user: {
    id: e.user.id,
    firstName: e.user.firstName,
    lastName: e.user.lastName,
    avatar: e.user.avatar ?? null,
    jobTitle: e.user.jobTitle ?? null,
  },
});

/**
 * STAFF row-scoped: the nine-box grid (scope-filtered evaluations grouped by grid cell, evaluatedAt-
 * desc order preserved). Gate: `isPlatformApiEnabled() && NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /ninebox/grid?period= (per-cell arrays; scores/confidence coerced; jsonb axis passthrough;
 *            evaluatedAt/createdAt Dates rebuilt; key + within-cell order preserved verbatim).
 *  - false → trpc.ninebox.getGrid.useQuery({ period }) (the DEFAULT).
 */
export function useNineBoxGrid(period: string) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getGrid.useQuery({ period }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<GridOutput>({
    queryKey: ['platform-api', 'ninebox', 'grid', period],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/grid', { period });
      return {
        period: raw.period,
        grid: Object.fromEntries(Object.entries(raw.grid).map(([key, cell]) => [key, cell.map(mapGridEvaluation)])),
        totalEvaluations: num(raw.totalEvaluations),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF subject-scoped point-read: one employee's current evaluation (nullable) + cross-period
 * history. Gate as above; disabled until a person is selected (matching the call site's
 * `enabled: !!selectedUserId`).
 *  - true  → GET /ninebox/employee/{userId}?period= (200 with NULLABLE evaluation — findFirst parity;
 *            evaluation user select carries email; history is evaluatedAt-asc).
 *  - false → trpc.ninebox.getEmployeeDetail.useQuery({ userId, period }) (the DEFAULT).
 */
export function useNineBoxEmployeeDetail(userId: string | null, period: string) {
  const enabledId = !!userId;
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getEmployeeDetail.useQuery(
    { userId: userId!, period },
    { enabled: !viaCSharp && enabledId },
  );

  const csharpQuery = useQuery<EmployeeDetailOutput>({
    queryKey: ['platform-api', 'ninebox', 'employee', userId, period],
    enabled: viaCSharp && enabledId,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/employee/{userId}', { period }, { userId: userId! });
      const evaluation: EmployeeDetailEvalOut | null = raw.evaluation
        ? {
            id: raw.evaluation.id,
            organizationId: raw.evaluation.organizationId,
            userId: raw.evaluation.userId,
            period: raw.evaluation.period,
            potentialScore: num(raw.evaluation.potentialScore),
            performanceScore: num(raw.evaluation.performanceScore),
            quadrant: raw.evaluation.quadrant,
            confidence: num(raw.evaluation.confidence),
            axisBreakdown: raw.evaluation.axisBreakdown as EmployeeDetailEvalOut['axisBreakdown'],
            evaluatedAt: toDate(raw.evaluation.evaluatedAt),
            createdAt: toDate(raw.evaluation.createdAt),
            user: {
              id: raw.evaluation.user.id,
              firstName: raw.evaluation.user.firstName,
              lastName: raw.evaluation.user.lastName,
              avatar: raw.evaluation.user.avatar ?? null,
              jobTitle: raw.evaluation.user.jobTitle ?? null,
              email: raw.evaluation.user.email,
            },
          }
        : null;
      return {
        evaluation,
        history: raw.history.map(
          (h): EmployeeHistoryOut => ({
            period: h.period,
            quadrant: h.quadrant,
            potentialScore: num(h.potentialScore),
            performanceScore: num(h.performanceScore),
            evaluatedAt: toDate(h.evaluatedAt),
          }),
        ),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: bench-strength (quadrant distribution + high-potential ratio kernel). Gate as
 * above.
 *  - true  → GET /ninebox/bench-strength?period= (total/highPotentialRatio/benchStrength coerced;
 *            distribution values coerced, key order preserved).
 *  - false → trpc.ninebox.getBenchStrength.useQuery({ period }) (the DEFAULT).
 */
export function useNineBoxBenchStrength(period: string) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getBenchStrength.useQuery({ period }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<BenchStrengthOutput>({
    queryKey: ['platform-api', 'ninebox', 'bench-strength', period],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/bench-strength', { period });
      return {
        period: raw.period,
        total: num(raw.total),
        distribution: mapDistribution(raw.distribution),
        highPotentialRatio: num(raw.highPotentialRatio),
        benchStrength: num(raw.benchStrength),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: nine-box dashboard KPIs (counts + quadrant distribution). Gate as above.
 *  - true  → GET /ninebox/dashboard-kpis?period= (counts coerced; distribution values coerced,
 *            key order preserved).
 *  - false → trpc.ninebox.getDashboardKpis.useQuery({ period }) (the DEFAULT).
 */
export function useNineBoxDashboardKpis(period: string) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getDashboardKpis.useQuery({ period }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'ninebox', 'dashboard-kpis', period],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/dashboard-kpis', { period });
      return {
        period: raw.period,
        totalEvaluations: num(raw.totalEvaluations),
        calibrationSessions: num(raw.calibrationSessions),
        activeCalibrations: num(raw.activeCalibrations),
        distribution: mapDistribution(raw.distribution),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * ORG-GOVERNANCE list: all calibration sessions (bounded 100, createdAt desc; narrow scope → 403).
 * Gate as above. A 403 propagates as a react-query error on BOTH paths; the call site treats it as
 * "no sessions visible" via {@link isNineboxForbiddenError}, so the 403 is NOT retried here.
 *  - true  → GET /ninebox/calibrations (scheduledAt Date|null; createdAt Date; _count.members coerced).
 *  - false → trpc.ninebox.listCalibrations.useQuery() (the DEFAULT), retry-disabled on FORBIDDEN.
 */
export function useNineBoxListCalibrations() {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.listCalibrations.useQuery(undefined, {
    enabled: !viaCSharp,
    retry: (failureCount, err) => (err.data?.code === 'FORBIDDEN' ? false : failureCount < 3),
  });

  const csharpQuery = useQuery<ListCalibrationsOutput>({
    queryKey: ['platform-api', 'ninebox', 'calibrations'],
    enabled: viaCSharp,
    retry: (failureCount, err) => (err instanceof PlatformApiError && err.status === 403 ? false : failureCount < 3),
    queryFn: async () => {
      const raw = await platformGet('/ninebox/calibrations');
      return raw.map((s) => ({
        id: s.id,
        period: s.period,
        status: s.status,
        scheduledAt: toDateOrNull(s.scheduledAt),
        createdAt: toDate(s.createdAt),
        _count: { members: num(s._count.members) },
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF hand-rolled membership gate: one calibration session (creator + members + votes,
 * deterministically ordered). Gate as above.
 *  - true  → GET /ninebox/calibrations/{id} (scalars + Dates; members/votes ordered by C#; a missing
 *            session → clean 404 which PROPAGATES as a thrown error — findFirstOrThrow parity).
 *  - false → trpc.ninebox.getCalibration.useQuery({ id }) (the DEFAULT).
 */
export function useNineBoxCalibration(id: string) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getCalibration.useQuery({ id }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<CalibrationOutput>({
    queryKey: ['platform-api', 'ninebox', 'calibration', id],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/calibrations/{id}', undefined, { id });
      return {
        id: raw.id,
        organizationId: raw.organizationId,
        period: raw.period,
        status: raw.status,
        scheduledAt: toDateOrNull(raw.scheduledAt),
        completedAt: toDateOrNull(raw.completedAt),
        createdById: raw.createdById,
        createdAt: toDate(raw.createdAt),
        updatedAt: toDate(raw.updatedAt),
        creator: {
          id: raw.creator.id,
          firstName: raw.creator.firstName,
          lastName: raw.creator.lastName,
        },
        members: raw.members.map(
          (m): CalibrationMemberOut => ({
            id: m.id,
            sessionId: m.sessionId,
            userId: m.userId,
            status: m.status,
            createdAt: toDate(m.createdAt),
            user: {
              id: m.user.id,
              firstName: m.user.firstName,
              lastName: m.user.lastName,
              avatar: m.user.avatar ?? null,
            },
          }),
        ),
        votes: raw.votes.map(
          (v): CalibrationVoteOut => ({
            id: v.id,
            sessionId: v.sessionId,
            evaluatedUserId: v.evaluatedUserId,
            voterId: v.voterId,
            quadrant: v.quadrant,
            justification: v.justification ?? null,
            createdAt: toDate(v.createdAt),
            evaluatedUser: {
              id: v.evaluatedUser.id,
              firstName: v.evaluatedUser.firstName,
              lastName: v.evaluatedUser.lastName,
            },
            voter: {
              id: v.voter.id,
              firstName: v.voter.firstName,
              lastName: v.voter.lastName,
            },
          }),
        ),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * MEMBER-scoped self list: the caller's OWN calibration sessions (created or a member of). Gate as
 * above.
 *  - true  → GET /ninebox/my-calibrations (bounded 100, createdAt desc; scheduledAt/completedAt
 *            Date|null; createdAt Date; _count.{members,votes} coerced).
 *  - false → trpc.ninebox.myCalibrations.useQuery() (the DEFAULT).
 */
export function useNineBoxMyCalibrations() {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.myCalibrations.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<MyCalibrationsOutput>({
    queryKey: ['platform-api', 'ninebox', 'my-calibrations'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/my-calibrations');
      return raw.map((s) => ({
        id: s.id,
        period: s.period,
        status: s.status,
        scheduledAt: toDateOrNull(s.scheduledAt),
        completedAt: toDateOrNull(s.completedAt),
        createdAt: toDate(s.createdAt),
        _count: { members: num(s._count.members), votes: num(s._count.votes) },
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Invalidate every C#-routed nine-box read (the `['platform-api','ninebox']` query-key prefix) after
 * a nine-box mutation, so the C# path refreshes exactly like `utils.ninebox.*.invalidate()` refreshes
 * the tRPC path. No-op under tRPC (nothing is cached at that prefix). Call from a mutation onSuccess
 * alongside the existing tRPC invalidations; pass the `useQueryClient()` instance.
 */
export function invalidateNineboxPlatformReads(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['platform-api', 'ninebox'] });
}

// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 15) — a SEPARATE flag from the reads above, mirroring backend
// `Platform:NineBoxWriteEnabled` (independent of NineBoxReadEnabled). Of the 5 C# mutations
// (createCalibration/submitCalibrationVote/addCalibrationMember/removeCalibrationMember/
// finalizeCalibration), only createCalibration (talent/nine-box/page.tsx) and
// addCalibrationMember/removeCalibrationMember (committee-members-panel.tsx) have live FE
// consumers — a full-repo grep confirms submitCalibrationVote/finalizeCalibration have zero call
// sites anywhere (same situation as succession's addCriticalRole/removeSuccessor/
// updateSuccessorReadiness), so they are intentionally NOT wrapped here. Each hook mirrors trpc's
// useMutation shape ({ onSuccess?, onError? }) so existing call sites swap in with a one-line
// change; both consumers already invalidate via `invalidateNineboxPlatformReads` post-success —
// this file only supplies the mutation itself. Error messages are byte-identical between stacks
// (verified against NineBoxWriteEndpoints.cs's message constants and the TS router's inline
// messages), including the addCalibrationMember 409 duplicate-member conflict (unlike succession's
// addSuccessor, both stacks here already throw a friendly 409/CONFLICT with the same message).
// ---------------------------------------------------------------------------

const NINEBOX_WRITE_VIA_CSHARP = process.env.NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP === 'true';

interface MutationOptions<TData = void> {
  onSuccess?: (data: TData) => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput, TData>(
  mutationFn: (input: TInput) => Promise<TData>,
  options: MutationOptions<TData> | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

interface CreateCalibrationInputShape {
  period: string;
  scheduledAt?: string;
  memberIds?: string[];
}

/**
 * STAFF: start a new calibration session (1 call site: talent/nine-box/page.tsx, which reads
 * `session.id` from the resolved data to auto-open the new session's committee panel).
 */
export function useNineBoxCreateCalibration(options?: MutationOptions<CreateCalibrationOutput>) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.ninebox.createCalibration.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: CreateCalibrationInputShape) => {
    const raw = await platformPost('/ninebox/calibrations', {
      period: input.period,
      scheduledAt: input.scheduledAt,
      memberIds: input.memberIds,
    });
    return {
      id: raw.id,
      organizationId: raw.organizationId,
      period: raw.period,
      status: raw.status,
      scheduledAt: toDateOrNull(raw.scheduledAt),
      completedAt: toDateOrNull(raw.completedAt),
      createdById: raw.createdById,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt),
      members: raw.members.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        userId: m.userId,
        status: m.status,
        createdAt: toDate(m.createdAt),
      })),
    } satisfies CreateCalibrationOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}

interface AddCalibrationMemberInputShape {
  sessionId: string;
  userId: string;
}

/** STAFF: add a committee member to a calibration session (1 call site: committee-members-panel.tsx). */
export function useNineBoxAddCalibrationMember(options?: MutationOptions<AddCalibrationMemberOutput>) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.ninebox.addCalibrationMember.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: AddCalibrationMemberInputShape) => {
    const raw = await platformPost(
      '/ninebox/calibrations/{sessionId}/members',
      { userId: input.userId },
      { sessionId: input.sessionId },
    );
    return { id: raw.id } satisfies AddCalibrationMemberOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}

interface RemoveCalibrationMemberInputShape {
  sessionId: string;
  userId: string;
}

/** STAFF: remove a committee member from a calibration session (1 call site: committee-members-panel.tsx). */
export function useNineBoxRemoveCalibrationMember(options?: MutationOptions<RemoveCalibrationMemberOutput>) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.ninebox.removeCalibrationMember.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: RemoveCalibrationMemberInputShape) => {
    const raw = await platformDelete('/ninebox/calibrations/{sessionId}/members/{userId}', {
      sessionId: input.sessionId,
      userId: input.userId,
    });
    return raw satisfies RemoveCalibrationMemberOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}
```

After (the complete replacement file):
```typescript
'use client';

// C#-only nine-box reads + the 3 wrapped writes. The TS ninebox tRPC procedures backing these
// hooks (getGrid, getEmployeeDetail, getBenchStrength, getDashboardKpis, listCalibrations,
// getCalibration, myCalibrations, createCalibration, addCalibrationMember,
// removeCalibrationMember) have been DELETED from packages/api/src/routers/ninebox.ts —
// NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP and NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP are both true in
// every environment and there is no TS fallback left to route to. Types below are hand-declared
// (previously derived from inferRouterOutputs<AppRouter>) since the deleted procedures no longer
// exist to infer from; quadrant/status stay `string` (the Prisma columns — NineBoxEvaluation.quadrant,
// CalibrationSession.status, CalibrationMember.status, CalibrationVote.quadrant — are plain String
// with no enum, unlike succession's criticality/readiness).
//
// The router itself SURVIVES for its 6 zero-FE-consumer procedures (getAxisBreakdown,
// getMovementHistory, simulate, submitCalibrationVote, finalizeCalibration, getQuadrantPlan) —
// pre-existing dead code unrelated to this migration. None of those six ever had a wrapper here,
// so nothing below references them.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformDelete, platformGet, platformPost, PlatformApiError } from './client';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to a real `number`.
const num = (v: number | string): number => Number(v);

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO converter;
// parse to Date (or null for the nullable scheduledAt/completedAt columns).
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

// A quadrant→count distribution ({[key]: number}); map values only, PRESERVING key insertion order
// (the kernel emits first-seen order; Object.entries preserves it).
const mapDistribution = (raw: { [key: string]: number | string }): Record<string, number> =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, num(v)]));

/**
 * True when an error is the nine-box FORBIDDEN case (a narrow-scope committee member reading
 * org-governance data). Only the C# {@link PlatformApiError} shape exists now (status 403) — the
 * tRPC `error.data.code === 'FORBIDDEN'` branch was removed alongside the TS procedures. Takes
 * `unknown` → safe on the union; callers don't need to change.
 */
export function isNineboxForbiddenError(err: unknown): boolean {
  return err instanceof PlatformApiError && err.status === 403;
}

interface NineBoxUserSummary {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  jobTitle: string | null;
}

interface NineBoxEvaluationView {
  id: string;
  organizationId: string;
  userId: string;
  period: string;
  potentialScore: number;
  performanceScore: number;
  quadrant: string;
  confidence: number;
  axisBreakdown: unknown;
  evaluatedAt: Date;
  createdAt: Date;
  user: NineBoxUserSummary;
}

interface GridOutput {
  period: string;
  grid: Record<string, NineBoxEvaluationView[]>;
  totalEvaluations: number;
}

interface EmployeeDetailHistoryRow {
  period: string;
  quadrant: string;
  potentialScore: number;
  performanceScore: number;
  evaluatedAt: Date;
}

interface EmployeeDetailEvaluationView extends Omit<NineBoxEvaluationView, 'user'> {
  user: NineBoxUserSummary & { email: string };
}

interface EmployeeDetailOutput {
  evaluation: EmployeeDetailEvaluationView | null;
  history: EmployeeDetailHistoryRow[];
}

interface BenchStrengthOutput {
  period: string;
  total: number;
  distribution: Record<string, number>;
  highPotentialRatio: number;
  benchStrength: number;
}

interface DashboardKpisOutput {
  period: string;
  totalEvaluations: number;
  calibrationSessions: number;
  activeCalibrations: number;
  distribution: Record<string, number>;
}

interface CalibrationSessionSummary {
  id: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  createdAt: Date;
  _count: { members: number };
}

type ListCalibrationsOutput = CalibrationSessionSummary[];

interface MyCalibrationSummary {
  id: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  _count: { members: number; votes: number };
}

type MyCalibrationsOutput = MyCalibrationSummary[];

interface CalibrationMemberOut {
  id: string;
  sessionId: string;
  userId: string;
  status: string;
  createdAt: Date;
  user: { id: string; firstName: string; lastName: string; avatar: string | null };
}

interface CalibrationVoteOut {
  id: string;
  sessionId: string;
  evaluatedUserId: string;
  voterId: string;
  quadrant: string;
  justification: string | null;
  createdAt: Date;
  evaluatedUser: { id: string; firstName: string; lastName: string };
  voter: { id: string; firstName: string; lastName: string };
}

interface CalibrationOutput {
  id: string;
  organizationId: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; firstName: string; lastName: string };
  members: CalibrationMemberOut[];
  votes: CalibrationVoteOut[];
}

interface CreateCalibrationMemberRow {
  id: string;
  sessionId: string;
  userId: string;
  status: string;
  createdAt: Date;
}

interface CreateCalibrationOutput {
  id: string;
  organizationId: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  members: CreateCalibrationMemberRow[];
}

interface AddCalibrationMemberOutput {
  id: string;
}

interface RemoveCalibrationMemberOutput {
  success: boolean;
}

// Full nine-box evaluation scalars shared by getGrid (grid cells). The user select carries
// jobTitle but NOT email (getEmployeeDetail's user select adds email).
const mapGridEvaluation = (e: {
  id: string;
  organizationId: string;
  userId: string;
  period: string;
  potentialScore: number | string;
  performanceScore: number | string;
  quadrant: string;
  confidence: number | string;
  axisBreakdown: unknown;
  evaluatedAt: unknown;
  createdAt: unknown;
  user: { id: string; firstName: string; lastName: string; avatar: string | null; jobTitle: string | null };
}): NineBoxEvaluationView => ({
  id: e.id,
  organizationId: e.organizationId,
  userId: e.userId,
  period: e.period,
  potentialScore: num(e.potentialScore),
  performanceScore: num(e.performanceScore),
  quadrant: e.quadrant,
  confidence: num(e.confidence),
  axisBreakdown: e.axisBreakdown,
  evaluatedAt: toDate(e.evaluatedAt),
  createdAt: toDate(e.createdAt),
  user: {
    id: e.user.id,
    firstName: e.user.firstName,
    lastName: e.user.lastName,
    avatar: e.user.avatar ?? null,
    jobTitle: e.user.jobTitle ?? null,
  },
});

/**
 * STAFF row-scoped: the nine-box grid (scope-filtered evaluations grouped by grid cell, evaluatedAt-
 * desc order preserved). GET /ninebox/grid?period= (per-cell arrays; scores/confidence coerced;
 * jsonb axis passthrough; evaluatedAt/createdAt Dates rebuilt; key + within-cell order preserved).
 */
export function useNineBoxGrid(period: string) {
  return useQuery<GridOutput>({
    queryKey: ['platform-api', 'ninebox', 'grid', period],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/grid', { period });
      return {
        period: raw.period,
        grid: Object.fromEntries(Object.entries(raw.grid).map(([key, cell]) => [key, cell.map(mapGridEvaluation)])),
        totalEvaluations: num(raw.totalEvaluations),
      };
    },
  });
}

/**
 * STAFF subject-scoped point-read: one employee's current evaluation (nullable) + cross-period
 * history. Disabled until a person is selected (matching the call site's `enabled: !!selectedUserId`).
 * GET /ninebox/employee/{userId}?period= (200 with NULLABLE evaluation — findFirst parity;
 * evaluation user select carries email; history is evaluatedAt-asc).
 */
export function useNineBoxEmployeeDetail(userId: string | null, period: string) {
  return useQuery<EmployeeDetailOutput>({
    queryKey: ['platform-api', 'ninebox', 'employee', userId, period],
    enabled: !!userId,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/employee/{userId}', { period }, { userId: userId! });
      const evaluation: EmployeeDetailEvaluationView | null = raw.evaluation
        ? {
            id: raw.evaluation.id,
            organizationId: raw.evaluation.organizationId,
            userId: raw.evaluation.userId,
            period: raw.evaluation.period,
            potentialScore: num(raw.evaluation.potentialScore),
            performanceScore: num(raw.evaluation.performanceScore),
            quadrant: raw.evaluation.quadrant,
            confidence: num(raw.evaluation.confidence),
            axisBreakdown: raw.evaluation.axisBreakdown,
            evaluatedAt: toDate(raw.evaluation.evaluatedAt),
            createdAt: toDate(raw.evaluation.createdAt),
            user: {
              id: raw.evaluation.user.id,
              firstName: raw.evaluation.user.firstName,
              lastName: raw.evaluation.user.lastName,
              avatar: raw.evaluation.user.avatar ?? null,
              jobTitle: raw.evaluation.user.jobTitle ?? null,
              email: raw.evaluation.user.email,
            },
          }
        : null;
      return {
        evaluation,
        history: raw.history.map(
          (h): EmployeeDetailHistoryRow => ({
            period: h.period,
            quadrant: h.quadrant,
            potentialScore: num(h.potentialScore),
            performanceScore: num(h.performanceScore),
            evaluatedAt: toDate(h.evaluatedAt),
          }),
        ),
      };
    },
  });
}

/**
 * STAFF org-rollup: bench-strength (quadrant distribution + high-potential ratio kernel).
 * GET /ninebox/bench-strength?period= (total/highPotentialRatio/benchStrength coerced;
 * distribution values coerced, key order preserved).
 */
export function useNineBoxBenchStrength(period: string) {
  return useQuery<BenchStrengthOutput>({
    queryKey: ['platform-api', 'ninebox', 'bench-strength', period],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/bench-strength', { period });
      return {
        period: raw.period,
        total: num(raw.total),
        distribution: mapDistribution(raw.distribution),
        highPotentialRatio: num(raw.highPotentialRatio),
        benchStrength: num(raw.benchStrength),
      };
    },
  });
}

/**
 * STAFF org-rollup: nine-box dashboard KPIs (counts + quadrant distribution).
 * GET /ninebox/dashboard-kpis?period= (counts coerced; distribution values coerced, key order preserved).
 */
export function useNineBoxDashboardKpis(period: string) {
  return useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'ninebox', 'dashboard-kpis', period],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/dashboard-kpis', { period });
      return {
        period: raw.period,
        totalEvaluations: num(raw.totalEvaluations),
        calibrationSessions: num(raw.calibrationSessions),
        activeCalibrations: num(raw.activeCalibrations),
        distribution: mapDistribution(raw.distribution),
      };
    },
  });
}

/**
 * ORG-GOVERNANCE list: all calibration sessions (bounded 100, createdAt desc; narrow scope → 403).
 * A 403 propagates as a react-query error; the call site treats it as "no sessions visible" via
 * {@link isNineboxForbiddenError}, so it is NOT retried here. GET /ninebox/calibrations
 * (scheduledAt Date|null; createdAt Date; _count.members coerced).
 */
export function useNineBoxListCalibrations() {
  return useQuery<ListCalibrationsOutput>({
    queryKey: ['platform-api', 'ninebox', 'calibrations'],
    retry: (failureCount, err) => (err instanceof PlatformApiError && err.status === 403 ? false : failureCount < 3),
    queryFn: async () => {
      const raw = await platformGet('/ninebox/calibrations');
      return raw.map((s) => ({
        id: s.id,
        period: s.period,
        status: s.status,
        scheduledAt: toDateOrNull(s.scheduledAt),
        createdAt: toDate(s.createdAt),
        _count: { members: num(s._count.members) },
      }));
    },
  });
}

/**
 * STAFF hand-rolled membership gate: one calibration session (creator + members + votes,
 * deterministically ordered). A missing session → clean 404 which PROPAGATES as a thrown error
 * (findFirstOrThrow parity). GET /ninebox/calibrations/{id}.
 */
export function useNineBoxCalibration(id: string) {
  return useQuery<CalibrationOutput>({
    queryKey: ['platform-api', 'ninebox', 'calibration', id],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/calibrations/{id}', undefined, { id });
      return {
        id: raw.id,
        organizationId: raw.organizationId,
        period: raw.period,
        status: raw.status,
        scheduledAt: toDateOrNull(raw.scheduledAt),
        completedAt: toDateOrNull(raw.completedAt),
        createdById: raw.createdById,
        createdAt: toDate(raw.createdAt),
        updatedAt: toDate(raw.updatedAt),
        creator: {
          id: raw.creator.id,
          firstName: raw.creator.firstName,
          lastName: raw.creator.lastName,
        },
        members: raw.members.map(
          (m): CalibrationMemberOut => ({
            id: m.id,
            sessionId: m.sessionId,
            userId: m.userId,
            status: m.status,
            createdAt: toDate(m.createdAt),
            user: {
              id: m.user.id,
              firstName: m.user.firstName,
              lastName: m.user.lastName,
              avatar: m.user.avatar ?? null,
            },
          }),
        ),
        votes: raw.votes.map(
          (v): CalibrationVoteOut => ({
            id: v.id,
            sessionId: v.sessionId,
            evaluatedUserId: v.evaluatedUserId,
            voterId: v.voterId,
            quadrant: v.quadrant,
            justification: v.justification ?? null,
            createdAt: toDate(v.createdAt),
            evaluatedUser: {
              id: v.evaluatedUser.id,
              firstName: v.evaluatedUser.firstName,
              lastName: v.evaluatedUser.lastName,
            },
            voter: {
              id: v.voter.id,
              firstName: v.voter.firstName,
              lastName: v.voter.lastName,
            },
          }),
        ),
      };
    },
  });
}

/**
 * MEMBER-scoped self list: the caller's OWN calibration sessions (created or a member of).
 * GET /ninebox/my-calibrations (bounded 100, createdAt desc; scheduledAt/completedAt Date|null;
 * createdAt Date; _count.{members,votes} coerced).
 */
export function useNineBoxMyCalibrations() {
  return useQuery<MyCalibrationsOutput>({
    queryKey: ['platform-api', 'ninebox', 'my-calibrations'],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/my-calibrations');
      return raw.map((s) => ({
        id: s.id,
        period: s.period,
        status: s.status,
        scheduledAt: toDateOrNull(s.scheduledAt),
        completedAt: toDateOrNull(s.completedAt),
        createdAt: toDate(s.createdAt),
        _count: { members: num(s._count.members), votes: num(s._count.votes) },
      }));
    },
  });
}

/**
 * Invalidate every C#-routed nine-box read (the `['platform-api','ninebox']` query-key prefix)
 * after a nine-box mutation. Call from a mutation onSuccess; pass the `useQueryClient()` instance.
 */
export function invalidateNineboxPlatformReads(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['platform-api', 'ninebox'] });
}

// ---------------------------------------------------------------------------
// Writes — createCalibration (talent/nine-box/page.tsx) and addCalibrationMember/
// removeCalibrationMember (committee-members-panel.tsx) are the 3 mutations with live FE
// consumers. submitCalibrationVote/finalizeCalibration have zero call sites and stay untouched,
// unrelated dead code in the TS router (see ninebox.ts).
// ---------------------------------------------------------------------------

interface MutationOptions<TData = void> {
  onSuccess?: (data: TData) => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput, TData>(
  mutationFn: (input: TInput) => Promise<TData>,
  options: MutationOptions<TData> | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

interface CreateCalibrationInputShape {
  period: string;
  scheduledAt?: string;
  memberIds?: string[];
}

/**
 * STAFF: start a new calibration session (1 call site: talent/nine-box/page.tsx, which reads
 * `session.id` from the resolved data to auto-open the new session's committee panel).
 * POST /ninebox/calibrations.
 */
export function useNineBoxCreateCalibration(options?: MutationOptions<CreateCalibrationOutput>) {
  return useCSharpMutation(async (input: CreateCalibrationInputShape) => {
    const raw = await platformPost('/ninebox/calibrations', {
      period: input.period,
      scheduledAt: input.scheduledAt,
      memberIds: input.memberIds,
    });
    return {
      id: raw.id,
      organizationId: raw.organizationId,
      period: raw.period,
      status: raw.status,
      scheduledAt: toDateOrNull(raw.scheduledAt),
      completedAt: toDateOrNull(raw.completedAt),
      createdById: raw.createdById,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt),
      members: raw.members.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        userId: m.userId,
        status: m.status,
        createdAt: toDate(m.createdAt),
      })),
    } satisfies CreateCalibrationOutput;
  }, options);
}

interface AddCalibrationMemberInputShape {
  sessionId: string;
  userId: string;
}

/**
 * STAFF: add a committee member to a calibration session (1 call site: committee-members-panel.tsx).
 * POST /ninebox/calibrations/{sessionId}/members.
 */
export function useNineBoxAddCalibrationMember(options?: MutationOptions<AddCalibrationMemberOutput>) {
  return useCSharpMutation(async (input: AddCalibrationMemberInputShape) => {
    const raw = await platformPost(
      '/ninebox/calibrations/{sessionId}/members',
      { userId: input.userId },
      { sessionId: input.sessionId },
    );
    return { id: raw.id } satisfies AddCalibrationMemberOutput;
  }, options);
}

interface RemoveCalibrationMemberInputShape {
  sessionId: string;
  userId: string;
}

/**
 * STAFF: remove a committee member from a calibration session (1 call site: committee-members-panel.tsx).
 * DELETE /ninebox/calibrations/{sessionId}/members/{userId}.
 */
export function useNineBoxRemoveCalibrationMember(options?: MutationOptions<RemoveCalibrationMemberOutput>) {
  return useCSharpMutation(async (input: RemoveCalibrationMemberInputShape) => {
    const raw = await platformDelete('/ninebox/calibrations/{sessionId}/members/{userId}', {
      sessionId: input.sessionId,
      userId: input.userId,
    });
    return raw satisfies RemoveCalibrationMemberOutput;
  }, options);
}
```

Type-consistency note: `BenchStrengthOutput`/`DashboardKpisOutput` were checked against `@tims/shared`'s exports (`packages/shared/src/ninebox.ts`) — `BenchStrengthResult` there has the exact same 4-field shape (`total`, `distribution`, `highPotentialRatio`, `benchStrength`) minus the router-added `period`, so `BenchStrengthOutput` is hand-declared inline (not imported) to keep this file's types self-contained and avoid a cross-package type-identity dependency that isn't load-bearing here (no consumer imports `BenchStrengthResult` alongside this file). `DashboardKpisOutput`, `GridOutput`, `EmployeeDetailOutput`, `CalibrationOutput`, `CreateCalibrationOutput`, `ListCalibrationsOutput`, `MyCalibrationsOutput` have no exported result type in `@tims/shared` (the kernels there return bare `Record<string, number>`/void — the router composes the full object shape itself), so all are hand-declared per the constraint (no narrower union than the schema guarantees: `quadrant`/`status` stay `string`).

- [ ] **Step 5: Fix `apps/web/app/(admin)/talent/nine-box/committee-members-panel.tsx`**

Confirmed: `trpc`/`utils` are used in this file ONLY for the one `getCalibration` invalidate call — no other domain shares this file, so the entire import is removed (mirrors succession's Step 4/5 shape, not the partial Step 6 shape).

Before:
```typescript
'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { UserPicker, CandidateAvatar, Skeleton } from '../../../../components';
import {
  useNineBoxCalibration,
  useNineBoxAddCalibrationMember,
  useNineBoxRemoveCalibrationMember,
  invalidateNineboxPlatformReads,
} from '../../../../lib/platform-api/ninebox';

interface CommitteeMembersPanelProps {
  sessionId: string;
}

/**
 * Committee-membership manager for a single calibration session.
 * Reads `ninebox.getCalibration().members`; add/remove via
 * addCalibrationMember / removeCalibrationMember, invalidating getCalibration
 * on success. Self-contained — mount it anywhere a sessionId is in scope.
 */
export function CommitteeMembersPanel({ sessionId }: CommitteeMembersPanelProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const calibration = useNineBoxCalibration(sessionId);

  const invalidate = () => {
    utils.ninebox.getCalibration.invalidate({ id: sessionId });
    // Cutover parity: refresh the C# platform-api nine-box reads. No-op under tRPC.
    invalidateNineboxPlatformReads(queryClient);
  };
```

After:
```typescript
'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { UserPicker, CandidateAvatar, Skeleton } from '../../../../components';
import {
  useNineBoxCalibration,
  useNineBoxAddCalibrationMember,
  useNineBoxRemoveCalibrationMember,
  invalidateNineboxPlatformReads,
} from '../../../../lib/platform-api/ninebox';

interface CommitteeMembersPanelProps {
  sessionId: string;
}

/**
 * Committee-membership manager for a single calibration session.
 * Reads the calibration via `useNineBoxCalibration`; add/remove via
 * addCalibrationMember / removeCalibrationMember, invalidating the C# nine-box
 * reads (including this session) on success. Self-contained — mount it
 * anywhere a sessionId is in scope.
 */
export function CommitteeMembersPanel({ sessionId }: CommitteeMembersPanelProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const calibration = useNineBoxCalibration(sessionId);

  const invalidate = () => {
    invalidateNineboxPlatformReads(queryClient);
  };
```

The rest of the file (lines 40-135: `add`/`remove` mutation hooks, `memberRows`, `assignedIds`, `onRemove`, and the whole JSX return) is unchanged.

- [ ] **Step 6: Delete the 2 dead type-alias lines from `apps/web/lib/trpc-types.ts`**

Confirmed via repo-wide grep of `apps/web`: zero real consumers of `CalibrationDetail`/`CalibrationMember` outside this file (the only other hits are unrelated auto-generated OpenAPI schema names in `schema.d.ts` like `CalibrationMemberRow`/`CalibrationDetailView`, and hook names like `useNineBoxAddCalibrationMember` — none is this type alias).

Before:
```typescript
export type CalibrationDetail = RouterOutput['ninebox']['getCalibration'];
export type CalibrationMember = CalibrationDetail['members'][number];
```

After: (both lines deleted; the line immediately before/after in the file is unaffected)

- [ ] **Step 7: Shrink `scripts/parity/surfaces.ts`'s `ninebox` entry from 11 to 4 endpoints**

Before (verified against `main`):
```typescript
  // ── nine-box ────────────────────────────────────────────────────────────────────────────────
  // 8 of the 11 nine-box reads (the 3 by-id employee/{userId}, axis-breakdown, calibrations/{id} are a
  // Tier-2 follow-up needing the harness Mode-A id extension). 6 org-scoped Mode-B (grid, movement-history,
  // calibrations, my-calibrations, bench-strength, dashboard-kpis) + 2 globalScope pure kernels (simulate,
  // quadrant-plan — org-independent by design → RLS N/A, parity + RBAC still run). One flag
  // Platform:NineBoxReadEnabled. RBAC (hr_admin ninebox:read@org, hrbp @unit): requireOrgScope reads
  // (calibrations, bench-strength, dashboard-kpis) → hrbp 403; grant-only reads (my-calibrations, simulate,
  // quadrant-plan) → hrbp 200; grid + movement-history use scopeWhereFor (hrbp → 200-empty, fragile) so
  // hrbp is OMITTED from their expectedByRole (the runner iterates only present keys). super_admin bypasses.
  ninebox: {
    key: 'ninebox',
    flag: 'Platform__NineBoxReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'grid',
        csharpPath: '/ninebox/grid?period=2026-Q1',
        tsProcedure: 'ninebox.getGrid',
        input: { period: '2026-Q1' },
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true },
      },
      {
        name: 'movement-history',
        csharpPath: '/ninebox/movement-history',
        tsProcedure: 'ninebox.getMovementHistory',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'calibrations',
        csharpPath: '/ninebox/calibrations',
        tsProcedure: 'ninebox.listCalibrations',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'my-calibrations',
        csharpPath: '/ninebox/my-calibrations',
        tsProcedure: 'ninebox.myCalibrations',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'bench-strength',
        csharpPath: '/ninebox/bench-strength?period=2026-Q1',
        tsProcedure: 'ninebox.getBenchStrength',
        input: { period: '2026-Q1' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'dashboard-kpis',
        csharpPath: '/ninebox/dashboard-kpis?period=2026-Q1',
        tsProcedure: 'ninebox.getDashboardKpis',
        input: { period: '2026-Q1' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'simulate',
        csharpPath:
          '/ninebox/simulate?userId=e0000b0c-0000-4000-8000-000000000001&newPotentialScore=80&newPerformanceScore=40',
        tsProcedure: 'ninebox.simulate',
        input: { userId: 'e0000b0c-0000-4000-8000-000000000001', newPotentialScore: 80, newPerformanceScore: 40 },
        // pure kernel, userId is echoed (no DB lookup) → org-independent → RLS N/A.
        globalScope: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true },
      },
      {
        name: 'quadrant-plan',
        csharpPath: '/ninebox/quadrant-plan?quadrant=star',
        tsProcedure: 'ninebox.getQuadrantPlan',
        input: { quadrant: 'star' },
        // pure catalog lookup → org-independent → RLS N/A.
        globalScope: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id: getEmployeeDetail/getAxisBreakdown = permissionProcedure('ninebox','read') +
      // assertSubjectInScope; both take ?period=2026-Q1. Org-A target = a:hr_admin (has a 2026-Q1 eval).
      // super/hr_admin (own id) → 200; hrbp @unit → target ∉ subject set → 403. Mode-A: → org-B b:hr_admin.
      {
        name: 'employee',
        csharpPath: '/ninebox/employee/{id}?period=2026-Q1',
        tsProcedure: 'ninebox.getEmployeeDetail',
        input: { userId: ID_SENTINEL, period: '2026-Q1' },
        idScopeKey: 'employee',
        // UNIQUE among the 9 by-id reads: getEmployeeDetail models a cross-tenant/absent id as a 200
        // null-SHAPE (`{evaluation:null, history:[]}`), not a 404 (verified live on both stacks) — so a
        // 200-empty here is isolation-held, not a missing-404 anomaly. All other by-id reads 404.
        crossTenantEmptyOk: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'period' },
      },
      {
        name: 'axis-breakdown',
        csharpPath: '/ninebox/employee/{id}/axis-breakdown?period=2026-Q1',
        tsProcedure: 'ninebox.getAxisBreakdown',
        input: { userId: ID_SENTINEL, period: '2026-Q1' },
        idScopeKey: 'employee',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id: getCalibration = permissionProcedure('ninebox','read') + hand-rolled committee-membership
      // gate (org/company scope → any in-org session; narrow → creator-or-member else 403). Org-A target = the
      // org-A calibration session (created by super). super/hr_admin (org) → 200; hrbp not creator/member → 403.
      {
        name: 'calibration',
        csharpPath: '/ninebox/calibrations/{id}',
        tsProcedure: 'ninebox.getCalibration',
        input: { id: ID_SENTINEL },
        idScopeKey: 'calibration',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // nested members[]/votes[] arrays (≤1 each seeded); canonicalize any array by id before diffing.
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
    ],
  },
```

After:
```typescript
  // ── nine-box ────────────────────────────────────────────────────────────────────────────────
  // UPDATE 2026-07-29: 7 of the original 11 registered nine-box reads had their TS procedures
  // deleted (NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP confirmed live in prod) — grid, calibrations,
  // my-calibrations, bench-strength, dashboard-kpis, employee, calibration are REMOVED below (no
  // TS side left to diff against for any of them). The 4 that survive (movement-history, simulate,
  // quadrant-plan, axis-breakdown) map to the router's zero-FE-consumer procedures, which stay
  // live — pre-existing dead code unrelated to this migration — so `verify ninebox` still runs 4
  // REAL parity/RLS/RBAC checks, not a no-op. One flag Platform:NineBoxReadEnabled still gates the
  // C# side for all 11 backend endpoints; only these 4 have a TS side left to compare against.
  // RBAC (hr_admin ninebox:read@org, hrbp @unit): movement-history uses scopeWhereFor (hrbp →
  // 200-empty, fragile, OMITTED from expectedByRole); axis-breakdown is subject-scoped (hrbp @unit,
  // target ∉ subject set → 403); simulate/quadrant-plan are globalScope pure kernels (org-independent
  // by design → RLS N/A, parity + RBAC still run). super_admin bypasses.
  ninebox: {
    key: 'ninebox',
    flag: 'Platform__NineBoxReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'movement-history',
        csharpPath: '/ninebox/movement-history',
        tsProcedure: 'ninebox.getMovementHistory',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'simulate',
        csharpPath:
          '/ninebox/simulate?userId=e0000b0c-0000-4000-8000-000000000001&newPotentialScore=80&newPerformanceScore=40',
        tsProcedure: 'ninebox.simulate',
        input: { userId: 'e0000b0c-0000-4000-8000-000000000001', newPotentialScore: 80, newPerformanceScore: 40 },
        // pure kernel, userId is echoed (no DB lookup) → org-independent → RLS N/A.
        globalScope: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true },
      },
      {
        name: 'quadrant-plan',
        csharpPath: '/ninebox/quadrant-plan?quadrant=star',
        tsProcedure: 'ninebox.getQuadrantPlan',
        input: { quadrant: 'star' },
        // pure catalog lookup → org-independent → RLS N/A.
        globalScope: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id: getAxisBreakdown = permissionProcedure('ninebox','read') + assertSubjectInScope;
      // takes ?period=2026-Q1. Org-A target = a:hr_admin (has a 2026-Q1 eval). super/hr_admin (own id)
      // → 200; hrbp @unit → target ∉ subject set → 403. Mode-A: → org-B b:hr_admin.
      {
        name: 'axis-breakdown',
        csharpPath: '/ninebox/employee/{id}/axis-breakdown?period=2026-Q1',
        tsProcedure: 'ninebox.getAxisBreakdown',
        input: { userId: ID_SENTINEL, period: '2026-Q1' },
        idScopeKey: 'employee',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
```

- [ ] **Step 8: Fix `scripts/parity/surfaces.test.ts`'s 4 stale assertions**

**a) Endpoint count (verified current value on `main`: `11`):**

Before:
```typescript
    expect(SURFACES['ninebox'].flag).toBe('Platform__NineBoxReadEnabled');
    expect(SURFACES['ninebox'].endpoints).toHaveLength(11);
```
After:
```typescript
    expect(SURFACES['ninebox'].flag).toBe('Platform__NineBoxReadEnabled');
    expect(SURFACES['ninebox'].endpoints).toHaveLength(4);
```

**b) By-id `expected` map — remove `ninebox/employee` and `ninebox/calibration`, keep `ninebox/axis-breakdown`:**

Before:
```typescript
    const expected: Record<string, string> = {
      'compensation/employee': 'employee',
      'ninebox/employee': 'employee',
      'ninebox/axis-breakdown': 'employee',
      'ninebox/calibration': 'calibration',
      'succession/critical-role': 'critical-role',
    };
```
After:
```typescript
    const expected: Record<string, string> = {
      'compensation/employee': 'employee',
      'ninebox/axis-breakdown': 'employee',
      'succession/critical-role': 'critical-role',
    };
```

**c) `byIdCount` total — verified current value on `main` is `5` (already reduced by succession's own by-id deletions, NOT the stale `7` a cached number would suggest); removing 2 ninebox by-id entries brings it to `3`:**

Before:
```typescript
    expect(byIdCount).toBe(5);
```
After:
```typescript
    expect(byIdCount).toBe(3);
```

**d) `'nine-box marks only the two pure kernels as globalScope'` — swap `grid`/`dashboard-kpis` references (both deleted) for surviving endpoints with the same shape (`movement-history` has no `globalScope` and omits `hrbp`; `axis-breakdown` denies `hrbp` with 403 — both verified against the Step 7 "after" content above):**

Before:
```typescript
  it('nine-box marks only the two pure kernels as globalScope', () => {
    const nb = SURFACES['ninebox'];
    expect(nb.endpoints.find((e) => e.name === 'simulate')?.globalScope).toBe(true);
    expect(nb.endpoints.find((e) => e.name === 'quadrant-plan')?.globalScope).toBe(true);
    expect(nb.endpoints.find((e) => e.name === 'grid')?.globalScope).toBeUndefined();
    // grid + movement-history omit hrbp (scopeWhereFor fragile); the org-rollup reads deny hrbp.
    expect(nb.endpoints.find((e) => e.name === 'grid')?.expectedByRole['hrbp']).toBeUndefined();
    expect(nb.endpoints.find((e) => e.name === 'dashboard-kpis')?.expectedByRole['hrbp']).toBe(403);
  });
```
After:
```typescript
  it('nine-box marks only the two pure kernels as globalScope', () => {
    const nb = SURFACES['ninebox'];
    expect(nb.endpoints.find((e) => e.name === 'simulate')?.globalScope).toBe(true);
    expect(nb.endpoints.find((e) => e.name === 'quadrant-plan')?.globalScope).toBe(true);
    expect(nb.endpoints.find((e) => e.name === 'movement-history')?.globalScope).toBeUndefined();
    // movement-history omits hrbp (scopeWhereFor fragile); axis-breakdown (subject-scoped) denies hrbp.
    expect(nb.endpoints.find((e) => e.name === 'movement-history')?.expectedByRole['hrbp']).toBeUndefined();
    expect(nb.endpoints.find((e) => e.name === 'axis-breakdown')?.expectedByRole['hrbp']).toBe(403);
  });
```

- [ ] **Step 9: Update `scripts/deploy/cutover.sh`'s `nine-box` and `nine-box-write` branches**

Before (verified against `main` — both unchanged there, still stale):
```bash
    nine-box)
      echo "read|NineBoxReadEnabled|verify|ninebox|NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4. NOTE: the parity harness registers this surface as \"ninebox\" (no hyphen) — this script accepts the friendlier \"nine-box\" and maps it internally."
      ;;
```
```bash
    nine-box-write)
      echo "write|NineBoxWriteEnabled|verify-write|ninebox|NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP|FLIP_READY|Runbook §6 Phase B #10 — FLIP-READY: drop TS ninebox router, flip calibration_sessions/members/votes."
      ;;
```

After:
```bash
    nine-box)
      echo "read|NineBoxReadEnabled|verify|ninebox|NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase A #4. UPDATE 2026-07-29: flag confirmed live in prod; 7 of 11 registered read procedures (all but getAxisBreakdown, getMovementHistory, simulate, getQuadrantPlan, which have zero FE consumers) have ALSO had their TS side deleted — scripts/parity/surfaces.ts's 'ninebox' entry now registers only those 4 zero-consumer procedures' endpoints. --verify-only still runs a REAL (smaller) check, unlike reporting/evaluation360/team-intel/billing-usage's now-fully-no-op surfaces — do not treat this as TS_DELETED. NOTE: the parity harness registers this surface as \"ninebox\" (no hyphen) — this script accepts the friendlier \"nine-box\" and maps it internally."
      ;;
```
```bash
    nine-box-write)
      echo "write|NineBoxWriteEnabled|verify-write|ninebox|NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase B #10. UPDATE 2026-07-29: flag confirmed live in prod. 3 of 5 mutations (createCalibration, addCalibrationMember, removeCalibrationMember) have had their TS side deleted; the other 2 (submitCalibrationVote, finalizeCalibration) have zero FE consumers and are untouched, unrelated dead code. scripts/parity/write-surfaces.ts's nineboxSurface tests the C# HTTP endpoints directly regardless of TS state — verify-write is fully unaffected either way."
      ;;
```

- [ ] **Step 10: Update `scripts/deploy/README-cutover.md`'s `nine-box` and `nine-box-write` table rows**

Before (verified against `main`):
```
| `nine-box`            | read  | `NineBoxReadEnabled`        | `verify ninebox`             | `NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP`        | FLIP-READY                                                            |
```
```
| `nine-box-write`      | write | `NineBoxWriteEnabled`       | `verify-write ninebox`       | `NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP`       | FLIP-READY                                                            |
```

After:
```
| `nine-box`            | read  | `NineBoxReadEnabled`        | `verify ninebox`             | `NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP`        | CONFIRMED LIVE (partial TS deletion — 7/11 read procedures, see cutover.sh) |
```
```
| `nine-box-write`      | write | `NineBoxWriteEnabled`       | `verify-write ninebox`       | `NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP`       | CONFIRMED LIVE                                                        |
```

Do NOT touch the "Worked example: cutting over `compensation`" section or its "Why not `reporting`..." walkthrough prose — confirmed on `main` it doesn't mention succession or nine-box at all (only reporting/evaluation360/team-intel/billing-usage, the surfaces whose `--verify-only` became a full no-op), and nine-box's check isn't a no-op either — same reasoning succession's plan used to leave this section alone.

- [ ] **Step 11: Update `docs/REMAINING-WORK.md`'s TS-deletion tally**

Before (verified against `main`):
```
  respective slice docs). TS-code deletion (step 7) has now happened for 5 of the now-12 live
  read/write surfaces — reporting and evaluation360 (2026-07-28), team-intel and billing-usage
  (2026-07-29), and succession (2026-07-29, **partially** deleted — 8 of 9 read procedures + 2 of
  5 write procedures; `getCriticalRole` and 3 zero-consumer write mutations remain untouched,
  unrelated dead code) — the remaining live surfaces (nine-box, compensation, engagement write)
  still have their TS fallback code sitting dead-but-undeleted behind their (now-always-true) flags. Flipping a
```

After:
```
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

- [ ] **Step 12: Delete 2 whole `describe` blocks + the now-unused `ninebox` helper const from `tests/access/membership-admin-committee.test.ts`**

Before:
```typescript
const ROOT = join(__dirname, '..', '..');
const crud = () => readFileSync(join(ROOT, 'packages/api/src/routers/interview/crud.ts'), 'utf8');
const ninebox = () => readFileSync(join(ROOT, 'packages/api/src/routers/ninebox.ts'), 'utf8');
```
After:
```typescript
const ROOT = join(__dirname, '..', '..');
const crud = () => readFileSync(join(ROOT, 'packages/api/src/routers/interview/crud.ts'), 'utf8');
```

Before (the end of the `'interview evaluator management'` block through EOF — everything after this point is deleted):
```typescript
  it('removeEvaluator scope-probes the interview parent', () => {
    const body = endpointBody(crud(), 'removeEvaluator');
    expect(body).toMatch(/assertScoped\('interview'/);
    expect(body).not.toMatch(/interview\.findFirst/);
  });
});

describe('listCalibrations endpoint', () => {
  it('listCalibrations gated by ninebox:read', () => {
    expect(ninebox()).toMatch(/listCalibrations:\s*permissionProcedure\('ninebox',\s*'read'\)/);
  });
  it('listCalibrations is org-scoped (organizationId: ctx.user.organizationId)', () => {
    expect(ninebox()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
  });
  // Enumerating every org session is org-governance — committee members hold
  // ninebox@team and must not list all sessions.
  it('listCalibrations gates on requireOrgScope (no narrow enumeration)', () => {
    const body = endpointBody(ninebox(), 'listCalibrations');
    expect(body).toMatch(/requireOrgScope\(ctx\.access\)/);
  });
});

describe('calibration member management', () => {
  it('addCalibrationMember gated by ninebox:update', () => {
    expect(ninebox()).toMatch(/addCalibrationMember:\s*permissionProcedure\('ninebox',\s*'update'\)/);
  });
  it('removeCalibrationMember gated by ninebox:update', () => {
    expect(ninebox()).toMatch(/removeCalibrationMember:\s*permissionProcedure\('ninebox',\s*'update'\)/);
  });
  it('addCalibrationMember org-verifies the session AND the user', () => {
    const s = ninebox();
    expect(s).toMatch(/calibrationSession\.findFirst/);
    expect(s).toMatch(/user\.findFirst/);
  });
  it('addCalibrationMember maps duplicate to CONFLICT', () => {
    expect(ninebox()).toMatch(/P2002|code:\s*'CONFLICT'/);
  });

  // ── Self-promotion guard (codex slice-7a, critical) ─────────────────────
  // Calibration sessions have NO team/unit anchor. ninebox:update is held by
  // the committee role @team — without an org-gate a committee user could
  // self-add to any session and then vote. Membership writes are org-governance.
  it('addCalibrationMember gates on requireOrgScope (close self-promotion)', () => {
    const body = endpointBody(ninebox(), 'addCalibrationMember');
    expect(body).toMatch(/requireOrgScope\(ctx\.access\)/);
  });
  it('removeCalibrationMember gates on requireOrgScope', () => {
    const body = endpointBody(ninebox(), 'removeCalibrationMember');
    expect(body).toMatch(/requireOrgScope\(ctx\.access\)/);
  });

  // Tripwire: exactly the three membership-admin + list endpoints carry the
  // org-gate among the calibration-membership surface (createCalibration,
  // finalizeCalibration, getBenchStrength, getDashboardKpis also gate, so the
  // raw count is >3 — assert the three new ones each appear once).
  it('each of the three governance reads/writes gates exactly once', () => {
    for (const name of ['listCalibrations', 'addCalibrationMember', 'removeCalibrationMember']) {
      const body = endpointBody(ninebox(), name);
      const count = (body.match(/requireOrgScope\(ctx\.access\)/g) ?? []).length;
      expect(count).toBe(1);
    }
  });
});
```
After:
```typescript
  it('removeEvaluator scope-probes the interview parent', () => {
    const body = endpointBody(crud(), 'removeEvaluator');
    expect(body).toMatch(/assertScoped\('interview'/);
    expect(body).not.toMatch(/interview\.findFirst/);
  });
});
```

- [ ] **Step 13: Fix `tests/access/scope-wiring-talent.test.ts`**

Confirmed via `git diff main` that this file's ninebox-related section is unchanged between `main` and this worktree's stale copy — the quotes below are accurate against both.

**a) Rewrite the header's `ninebox taxonomy` comment block (removes references to the 7 deleted procedures; adds a note about `getAxisBreakdown`'s subject-scoping, since the "getEmployeeDetail" line moves there):**

Before:
```typescript
// ── ninebox taxonomy ──────────────────────────────────────────────────
//   getGrid / getAxisBreakdown / getMovementHistory → row-level reads of
//     NineBoxEvaluation → AND-compose the nineBoxEvaluation fragment (the
//     existing teamId/unitId/companyId input branches only INTERSECT).
//   getEmployeeDetail   → point-read of one employee → assertSubjectInScope.
//   simulate            → pure math on input scores (no DB read) → untouched.
//   createCalibration   → session creation is an org-governance act (not a
//     committee grant) → requireOrgScope.
//   getCalibration      → org-scoped + member-or-creator check.
//   submitCalibrationVote → THE membership rule (mirrors submitScorecard):
//     fetch session org-scoped, require the VOTER is a calibrationMember,
//     FORBIDDEN otherwise. voterId already comes from ctx.user.id (not input).
//   finalizeCalibration → session lifecycle write → requireOrgScope.
//   getQuadrantPlan     → static plan lookup (no DB read) → untouched.
//   getBenchStrength / getDashboardKpis → org-rollup aggregates → requireOrgScope.
```
After:
```typescript
// ── ninebox taxonomy ──────────────────────────────────────────────────
// UPDATE 2026-07-29: getGrid, getEmployeeDetail, createCalibration,
// listCalibrations, getCalibration, myCalibrations, getBenchStrength,
// getDashboardKpis had their TS side DELETED (7 reads + 3 writes wrapped
// live in prod) — the taxonomy below now covers only the 6 zero-FE-consumer
// procedures that remain, unrelated dead code out of scope for that deletion.
//   getAxisBreakdown / getMovementHistory → row-level reads of
//     NineBoxEvaluation → AND-compose the nineBoxEvaluation fragment (the
//     existing teamId/unitId/companyId input branches only INTERSECT).
//     getAxisBreakdown additionally subjects its target userId via
//     assertSubjectInScope (point-read).
//   simulate            → pure math on input scores (no DB read) → untouched.
//   submitCalibrationVote → THE membership rule (mirrors submitScorecard):
//     fetch session org-scoped, require the VOTER is a calibrationMember,
//     FORBIDDEN otherwise. voterId already comes from ctx.user.id (not input).
//   finalizeCalibration → session lifecycle write → requireOrgScope.
//   getQuadrantPlan     → static plan lookup (no DB read) → untouched.
```

**b) Rename/refocus the vacuous `getEmployeeDetail` test onto its actual surviving user, `getAxisBreakdown`:**

Before:
```typescript
  it('getEmployeeDetail subjects the target user via assertSubjectInScope', () => {
    expect(src()).toMatch(/assertSubjectInScope/);
  });
```
After:
```typescript
  it('getAxisBreakdown subjects the target user via assertSubjectInScope', () => {
    expect(src()).toMatch(/assertSubjectInScope/);
  });
```

**c) Rename/refocus the vacuous org-rollup `requireOrgScope` test onto its actual surviving user, `finalizeCalibration` (a lifecycle write, not an org-rollup read — the deleted `createCalibration`/`listCalibrations`/`addCalibrationMember`/`removeCalibrationMember`/`getBenchStrength`/`getDashboardKpis` were the org-rollup/governance procedures this originally exercised):**

Before:
```typescript
  it('org-rollup / lifecycle endpoints gated via requireOrgScope', () => {
    expect(src()).toMatch(/requireOrgScope/);
  });
```
After:
```typescript
  it('finalizeCalibration (lifecycle write) gated via requireOrgScope', () => {
    expect(src()).toMatch(/requireOrgScope/);
  });
```

**d) Delete the entire `describe('myCalibrations (committee landing)', ...)` block (tests only the deleted `myCalibrations` procedure):**

Before:
```typescript
  // Slice 5A — committee "Mis Calibraciones": a member-scoped read of the
  // caller's OWN calibration sessions. Mirrors getCalibration's member-anchor
  // (createdById OR a CalibrationMember row), NOT requireOrgScope, NOT
  // scopeWhereFor (calibrationSession is not a registered ENTITY).
  describe('myCalibrations (committee landing)', () => {
    // Isolate the procedure block so requireOrgScope on OTHER endpoints can't
    // satisfy these assertions.
    const block = () => {
      const s = src();
      const start = s.indexOf('myCalibrations:');
      expect(start).toBeGreaterThan(-1);
      // next top-level procedure after myCalibrations
      const rest = s.slice(start + 'myCalibrations:'.length);
      const nextProc = rest.search(/\n {2}\w+:\s*permissionProcedure/);
      return nextProc === -1 ? rest : rest.slice(0, nextProc);
    };

    it('anchors on createdById OR a CalibrationMember userId (own/member, not org-wide)', () => {
      const b = block();
      expect(b).toMatch(/createdById:\s*ctx\.user\.id/);
      expect(b).toMatch(/members:\s*\{\s*some:\s*\{\s*userId:\s*ctx\.user\.id/);
      expect(b).toMatch(/OR:\s*\[/);
    });

    it('does NOT use requireOrgScope (committee is team-scoped)', () => {
      expect(block()).not.toMatch(/requireOrgScope/);
    });

    it('does NOT call scopeWhereFor for calibrationSession (not a registered ENTITY)', () => {
      expect(block()).not.toMatch(/scopeWhereFor\('calibrationSession'/);
    });

    it('always filters by organizationId (tenant isolation)', () => {
      expect(block()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
    });

    it('uses an explicit select (no full-record leak) and bounds the list', () => {
      const b = block();
      expect(b).toMatch(/select:\s*\{/);
      expect(b).toMatch(/take:\s*\d+/);
    });
  });
});
```
After:
```typescript
});
```

**e) `'submitCalibrationVote validates the evaluated user belongs to the org'`** (in `describe('codex round-1 fixes (talent)', ...)`) needs NO change — confirmed: its slice boundaries `submitCalibrationVote:`/`finalizeCalibration:` both survive Step 1's deletions and remain adjacent in the post-deletion router (the deleted `addCalibrationMember`/`removeCalibrationMember` sat between them but are gone now, so the slice just gets tighter, not broken).

- [ ] **Step 14: Repoint `apps/web/lib/platform-api/client.ts`'s stale module-header citation**

Before:
```typescript
// This is the reusable foundation for routing individual READ surfaces to the C#
// backend one env-flag at a time during the backend migration. It is DARK by default:
// when NEXT_PUBLIC_TIMS_PLATFORM_API_URL is unset the client is DISABLED and callers
// fall back to the existing tRPC path (see lib/platform-api/ninebox.ts).
```
After:
```typescript
// This is the reusable foundation for routing individual READ surfaces to the C#
// backend one env-flag at a time during the backend migration. It is DARK by default:
// when NEXT_PUBLIC_TIMS_PLATFORM_API_URL is unset the client is DISABLED and callers
// fall back to the existing tRPC path (see lib/platform-api/dei.ts).
```

Verified `dei.ts` still has a genuine dual-path pattern (`viaCSharp` boolean gating both a real `trpc.dei.*.useQuery` hook and a C# `useQuery`) — confirmed via direct read (`apps/web/lib/platform-api/dei.ts:76-99` shows `const trpcQuery = trpc.dei.getDashboardKpis.useQuery(...)` alongside `const csharpQuery = useQuery<DashboardKpisOutput>(...)`, gated by `const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;`). `dei.ts` is also NOT queued next in this migration's sequence (compensation is), so it is a more stable citation than `compensation.ts`, which would need re-pointing again soon.

- [ ] **Step 15: Fix `apps/web/lib/nav/manifest.ts`'s comment naming the deleted `ninebox.myCalibrations` procedure**

Before:
```typescript
// surfaced as a panel ON the committee landing (ninebox.myCalibrations, member-scoped) rather than a
```
After:
```typescript
// surfaced as a panel ON the committee landing (useNineBoxMyCalibrations, member-scoped) rather than a
```

- [ ] **Step 16: Confirm-only items (no code changes) — verify each explicitly before closing out this task**

- `packages/api/src/routers/ninebox.helpers.ts` — confirmed via repo-wide grep it is ALREADY an orphan (its only other reference, `packages/shared/src/ninebox.ts:2`, is a comment explaining the migration, not an import). Pre-existing, unrelated to this deletion — leave untouched, matching this migration's established precedent for similar orphans.
- `tests/ninebox/kernels-fixtures.test.ts` — confirmed it imports directly from `@tims/shared` (`simulateBands`, `resolveQuadrantPlan`, `buildBenchStrength`, `buildQuadrantDistribution`, `gridPlacement`, `computeMovements`) and never touches the router — needs ZERO changes.
- `tests/tier1/*ninebox*` — confirmed via `find`: no such file exists.
- `scripts/parity/write-surfaces.ts`'s `nineboxSurface` — confirmed it tests the C# HTTP endpoints directly (zero `tsProcedure`-style TS dependency) — unaffected, matching succession's `write-surfaces.ts` precedent.
- `scripts/parity/README.md` / `README-cutover.md`'s worked-example walkthrough — confirmed (against `main`) it uses `compensation`, does not mention nine-box anywhere, and its "why not X" no-op list only names reporting/evaluation360/team-intel/billing-usage — nine-box correctly stays off that list (its check is not a no-op) — no fix needed.
- `apps/web/lib/platform-api/engagement.ts` (lines 10, 35, 353, 467) and `dei.ts` (line 11) — confirmed both reference nine-box only as a design-pattern citation ("Mirrors lib/platform-api/{...,ninebox}.ts exactly", "matching the ninebox precedent's...", "generic over TData (like ninebox's...)", "matching the ninebox/dei precedent for widened wire-type casts") — none names a specific deleted procedure — no fix needed.

- [ ] **Step 17 (Federico hand-off, not code — flag to the implementing agent): `.env.example`**

Both `NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP` and `NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP` are reported absent from `.env.example` (I could not independently verify this myself — the file is in a sandbox-denied directory for this planning session; **re-verify with a fresh grep before executing**). If confirmed absent, hand Federico this exact patch text (new lines, not edits to existing ones — unlike every prior domain, which was missing at most one flag):

```
# was route: ninebox.getGrid / getEmployeeDetail / getBenchStrength / getDashboardKpis /
# listCalibrations / getCalibration / myCalibrations (TS tRPC) — NOW MOOT: these 7 TS read
# procedures were deleted 2026-07-29; the C# read path is the only implementation left.
NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP=true

# was route: ninebox.createCalibration / addCalibrationMember / removeCalibrationMember (TS tRPC)
# — NOW MOOT: these 3 TS write procedures were deleted 2026-07-29; the C# write path is the only
# implementation left. (submitCalibrationVote/finalizeCalibration remain TS-live, unrelated
# zero-consumer dead code, untouched by this deletion.)
NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP=true
```

- [ ] **Step 18: Verification**

Run, in order, and confirm each passes before considering this task done:

1. `tsc --noEmit` scoped to `@tims/api` (or the repo's equivalent package-level typecheck script) — must pass with zero errors, confirming Step 1/2/3's deletions left no dangling references (`z`, `buildBenchStrength`, `buildQuadrantDistribution`, `gridPlacement`, and the 6 deleted schema exports must all show as genuinely unused, not silently broken).
2. `tsc --noEmit` scoped to `@tims/web` — must pass with zero errors, confirming Step 4/5/6's rewrite compiles and every FE call site (`talent/nine-box/page.tsx`, `committee-members-panel.tsx`, `dashboard/committee-tasks-dashboard.tsx`) still resolves the 10 hook names with compatible shapes.
3. `npx vitest run` (repo root) — must pass. **Get REAL before/after counts by actually running it once before this task's edits and once after** (do not assert a number without verifying — this exact mistake has already been made twice in this migration). Confirm the net test-count delta matches: −2 whole test files' worth of `it`s removed from `tests/access/membership-admin-committee.test.ts` (Step 12: the `'listCalibrations endpoint'` block, 3 `it`s, and `'calibration member management'` block, 7 `it`s — 10 total), −5 `it`s removed from `tests/access/scope-wiring-talent.test.ts` (Step 13d: the `myCalibrations` describe block), with 2 renamed (not removed) `it`s in the same file (Step 13b/13c) not changing the count.
4. Re-run `scripts/parity/surfaces.test.ts`'s specific assertions (Step 8) in isolation to confirm the 4 numeric/structural changes are internally consistent with each other and with the Step 7 shrunk entry.

---

## Self-Review

**Spec coverage:**
- ✅ All 10 dead procedures identified and deletion-planned (7 reads: `getGrid`, `getEmployeeDetail`, `listCalibrations`, `getCalibration`, `myCalibrations`, `getBenchStrength`, `getDashboardKpis`; 3 writes: `createCalibration`, `addCalibrationMember`, `removeCalibrationMember`) — Step 1.
- ✅ Router import block fixed with exact before/after — Step 2.
- ✅ `ninebox.schemas.ts`'s 6 dead exports deleted after confirming zero other importers — Step 3.
- ✅ `ninebox.helpers.ts` orphan status confirmed, explicitly left untouched — Step 16.
- ✅ FE wrapper full C#-only rewrite, all 10 hooks + 2 utility exports preserved by name/shape, types hand-declared per the `string`-not-enum constraint — Step 4.
- ✅ `committee-members-panel.tsx`'s dead invalidate line removed, entire `utils`/`trpc` import removed (confirmed zero other uses in this file) — Step 5.
- ✅ `trpc-types.ts`'s `CalibrationDetail`/`CalibrationMember` deleted after confirming zero real consumers repo-wide — Step 6.
- ✅ `scripts/parity/surfaces.ts` shrunk 11→4, doc-comment rewritten — Step 7.
- ✅ `scripts/parity/surfaces.test.ts`'s 4 assertions fixed with real (not cached/assumed) current values pulled from `main` — Step 8.
- ✅ `cutover.sh`'s both rows updated to `CONFIRMED_LIVE` with corrected notes (stale "drop TS ninebox router" language fixed) — Step 9.
- ✅ `README-cutover.md`'s both rows updated; worked-example/no-op-list sections confirmed untouched — Step 10.
- ✅ `REMAINING-WORK.md`'s tally sentence incremented and nine-box's clause added, using the real current sentence from `main` — Step 11.
- ✅ `membership-admin-committee.test.ts`'s 2 describe blocks + unused helper const deleted — Step 12.
- ✅ `scope-wiring-talent.test.ts`'s header comment, 2 vacuous-pass renames, and the `myCalibrations` block deletion — Step 13; `submitCalibrationVote` test explicitly confirmed unaffected.
- ✅ Cross-reference staleness checks: `client.ts` repointed to `dei.ts` (Step 14), `manifest.ts` fixed (Step 15), `engagement.ts`/`dei.ts`/`tests/tier1`/`write-surfaces.ts`/parity READMEs all explicitly confirmed with file:line evidence (Step 16).
- ✅ `.env.example` hand-off with exact patch text for 2 brand-new lines (Step 17), flagged as unverified due to sandbox restriction.
- ✅ Verification step with explicit "run it for real, don't assume" instruction (Step 18).

**Placeholder scan:** No `TODO`, `...`, `<fill in>`, or paraphrased/elided code blocks anywhere in this plan — every before/after quote above is the complete, verbatim text (confirmed by direct `Read`/`git show` against either this worktree or `main`, whichever was authoritative for that file).

**Type consistency:** `quadrant`/`status` are `string` everywhere in the rewritten wrapper (Step 4), never narrowed to a union, matching the Prisma schema's plain `String` columns (verified directly against `packages/db/prisma/schema/ninebox.prisma`). Hand-declared types were cross-checked against `@tims/shared`'s exports (`packages/shared/src/ninebox.ts`) — none of the 7 reads' full output shapes has an exported result type there to reuse (only the internal kernel pieces do, e.g. `BenchStrengthResult`'s 4 fields match `BenchStrengthOutput` minus `period`, but it's hand-declared inline rather than imported to avoid an unnecessary cross-package type dependency with no other consumer). `RemoveCalibrationMemberOutput = { success: boolean }` matches literal-widening of the router's `return { success: true }`.

**Known limitation flagged to the reader:** the `.env.example` absence claim (Step 17) could not be independently verified in this session due to a sandbox permission restriction on that file's directory — re-verify with a fresh grep before treating it as "add new lines" rather than "patch existing lines."

### Critical Files for Implementation
- packages/api/src/routers/ninebox.ts
- apps/web/lib/platform-api/ninebox.ts
- scripts/parity/surfaces.ts
- scripts/parity/surfaces.test.ts
- tests/access/scope-wiring-talent.test.ts