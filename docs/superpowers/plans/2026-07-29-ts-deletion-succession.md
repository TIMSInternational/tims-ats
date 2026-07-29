# TS Deletion: succession (10 of 14 procedures) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-dead TS fallback for succession's 10 wrapped-and-live procedures (8 reads gated on `NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP`, 2 writes gated on `NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP`, both confirmed live in prod) and truth up every doc/tooling reference that assumed a live TS side existed. This is the 5th domain through this pattern (after reporting, evaluation360, team-intel, billing-usage).

**Architecture:** The router (`packages/api/src/routers/succession.ts`) keeps 4 procedures with zero FE consumers (`getCriticalRole`, `addCriticalRole`, `removeSuccessor`, `updateSuccessorReadiness` — pre-existing dead code unrelated to this migration, confirmed via full-repo grep, out of scope) so it **cannot be deleted**, unlike reporting/evaluation360's whole-router precedent — this is surgical in-file deletion, same shape as team-intel/billing-usage. Unlike those two, though, the FE wrapper (`apps/web/lib/platform-api/succession.ts`) wraps **100% of its content** around the 10 in-scope procedures (confirmed: all 10 exported hooks map 1:1 to the 10 deleted procedures, zero hooks reference the 4 out-of-scope ones) — so the wrapper gets a **full-file rewrite** (C#-only, hand-declared/reused-from-`@tims/shared` types), matching reporting.ts/evaluation360.ts's rewrite shape, not billing.ts's partial-edit shape. Succession has no dedicated service/repository file (all DB access is inline in the router) — there is no separate file to preserve as a rollback safety net; the safety net here is simply that the router itself survives for its 4 remaining procedures, and the `@tims/shared` builder functions stay in place, still directly exercised by their own fixture tests.

**Tech Stack:** tRPC (`packages/api`), Next.js/React Query (`apps/web`), TypeScript strict mode, Prisma (`@tims/db`).

## Global Constraints

- Do NOT delete `packages/api/src/routers/succession.ts` itself, and do NOT touch `getCriticalRole`, `addCriticalRole`, `removeSuccessor`, `updateSuccessorReadiness` — confirmed zero FE call sites, pre-existing dead code unrelated to this migration, out of scope.
- `packages/api/src/routers/succession.ts` has NO dedicated service/repository file to preserve — nothing to add to a "do not touch" list at that layer.
- Keep `packages/shared/src/succession.ts`'s exports (`buildCompetencyCoverage`, `buildSuccessionKpis`, `buildExitSimulation`, `buildSuggestedSuccessors`, `buildCompGapAlerts`, and their type exports) unmodified — several are directly reused as the FE wrapper's new hand-declared-free types (see Task 1 Step 3), and 5 dedicated fixture test files (`tests/succession/*-fixtures.test.ts`) exercise them directly, independent of the router.
- `tsc --noEmit` must pass on both `@tims/api` and `@tims/web` after this change.
- Full `npx vitest run` (repo root) must pass, not just `tsc`.
- **The `scripts/parity/surfaces.ts` `succession` entry must be SHRUNK, not removed** — unlike every prior domain in this migration, one of its 9 registered endpoints (`critical-role` → `succession.getCriticalRole`) maps to a procedure that stays in the router. This is the first domain where the parity harness keeps a real, still-meaningful check for this surface after the deletion.
- **Because succession's read-side parity check stays partially real** (not a 100% no-op like reporting/evaluation360/team-intel/billing-usage), its `cutover.sh`/`README-cutover.md` status should NOT become `TS_DELETED` (that status means "no TS side left to diff against ANYWHERE for this surface", which would be false here) and its `parity_command` stays `verify` (not `NONE`) — use `CONFIRMED_LIVE` instead (mirroring team-intel's ORIGINAL pre-deletion status designation, extended with a note that 8-of-9 read procedures are additionally now TS-deleted). Do NOT add `succession` to `README-cutover.md`'s "why not X for this walkthrough" no-op list — its `--verify-only` is not a no-op.
- `succession-write`'s cutover status: `write-surfaces.ts`'s `successionSurface` tests the C# HTTP endpoints directly (confirmed via grep — zero `tsProcedure`-style TS dependency), so it is completely unaffected by this deletion regardless of which 2-of-5 mutations lose their TS code. Its status should simply be corrected from stale `FLIP_READY` to `CONFIRMED_LIVE` (the flag genuinely is live — an opportunistic truth-up, not something this specific deletion causes), with no `parity_command` change.
- `.env.example` has a `NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP` line to patch (per every prior domain's `.env.*`-edit-denial hand-off) but is **missing a `NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP` line entirely** (a pre-existing gap predating this task) — hand Federico both the read-flag patch AND a note to add the missing write-flag line.
- `apps/web/app/(admin)/talent/nine-box/page.tsx` also imports and calls `useSuccessionCriticalRoles` (a second call site beyond `talent/succession/`) — confirm this page still compiles and behaves identically after the wrapper rewrite (same exported name/shape, so it should need zero changes, but this is the one cross-domain consumer to double-check).

---

### Task 1: Delete the dead TS code + truth-up parity/cutover tooling

**Files:**

- Modify: `packages/api/src/routers/succession.ts` (delete 8 read + 2 write procedures + their now-unused imports; keep 4 procedures + their imports)
- Modify: `apps/web/lib/platform-api/succession.ts` (full-file rewrite: C#-only, hand-declared/`@tims/shared`-sourced types)
- Modify: `apps/web/app/(admin)/talent/succession/add-successor-modal.tsx` (remove 6 dead `utils.succession.*.invalidate()` calls + now-unused `utils`/`trpc` import)
- Modify: `apps/web/app/(admin)/talent/succession/succession-pipeline.tsx` (remove 2 dead invalidate calls + now-unused `utils`/`trpc` import)
- Modify: `apps/web/app/(admin)/talent/succession/request-adjustment-modal.tsx` (remove 1 dead invalidate call ONLY — `utils`/`trpc` stay, still used by compensation-domain invalidates in the same file)
- Modify: `scripts/parity/surfaces.ts` (shrink the `succession` entry to its 1 surviving endpoint; rewrite its doc-comment block)
- Modify: `scripts/parity/surfaces.test.ts` (update the 2 assertions that hardcode succession's old 9-endpoint shape)
- Modify: `scripts/deploy/cutover.sh` (succession read status: `FLIP_READY`→`CONFIRMED_LIVE` with a note; succession-write status: `FLIP_READY`→`CONFIRMED_LIVE`, no other change)
- Modify: `scripts/deploy/README-cutover.md` (both table rows' status column)
- Modify: `docs/REMAINING-WORK.md` (deletion tally: 4→5, note succession is a _partial_ deletion)
- Modify: `tests/tier1/s1-succession-wiring.test.ts` (remove the now-false `'invalidates the affected queries'` test)
- Modify: `tests/access/scope-wiring-talent.test.ts` (remove/adjust 2 assertions that hardcode now-deleted router behavior)
- Delete: `tests/succession/suggested-successors.test.ts` (tests only the deleted `getSuggestedSuccessors` procedure via a live tRPC caller)
- Delete: `tests/succession/comp-gap.test.ts` (tests only the deleted `getCompGapAlerts`/`updateCriticalRoleBand` procedures via a live tRPC caller)
- Test: `tests/succession/{comp-gap,competency-coverage,succession-kpis,suggested-successors,exit-simulation}-fixtures.test.ts` need ZERO changes — all 5 import `@tims/shared`'s builder functions directly, never the router.

**Interfaces:**

- Consumes: nothing from earlier tasks (first and only task).
- Produces: all 10 hook names (`useSuccessionDashboardKpis`, `useSuccessionCriticalRoles`, `useSuccessionCompetencyCoverage`, `useSuccessionFlightRisk`, `useSuccessionRolesWithoutSuccessor`, `useSuccessionCompGapAlerts`, `useSuccessionSuggestedSuccessors`, `useSuccessionSimulateExit`, `useSuccessionAddSuccessor`, `useSuccessionUpdateCriticalRoleBand`) stay identical in name, params, and return shape — every FE call site (including `nine-box/page.tsx`'s `useSuccessionCriticalRoles` call) needs zero changes.

- [ ] **Step 1: Delete the 8 dead read procedures + 2 dead write procedures from the router**

In `packages/api/src/routers/succession.ts`, delete (bottom-to-top, to keep other line numbers stable while editing):

**a) The `// ── Dashboard KPIs ──` section (its only procedure, `getDashboardKpis`):**

```typescript
  // ── Dashboard KPIs ───────────────────────────────────────────────────

  getDashboardKpis: permissionProcedure('succession', 'read')
    .query(async ({ ctx }) => {
      // Org-rollup dashboard aggregate → interim org-gate (slice-6 follow-up).
      requireOrgScope(ctx.access);

      const orgId = ctx.user.organizationId;

      const [totalRoles, totalSuccessors, rolesWithoutSuccessor, highFlightRisk] =
        await Promise.all([
          db.criticalRole.count({ where: { organizationId: orgId } }),
          db.successor.count({ where: { organizationId: orgId } }),
          db.criticalRole.count({
            where: { organizationId: orgId, successors: { none: {} } },
          }),
          db.criticalRole.count({
            where: { organizationId: orgId, flightRisk: { gte: 0.7 } },
          }),
        ]);

      const [readyNow, ready1to2Years] = await Promise.all([
        db.successor.count({
          where: { organizationId: orgId, readiness: 'ready_now' },
        }),
        db.successor.count({
          where: {
            organizationId: orgId,
            readiness: { in: ['ready_1_year', 'ready_2_years'] },
          },
        }),
      ]);

      // Pure KPI rollup (coverageRate/avgSuccessorsPerRole) → @tims/shared (golden-parity with the C# port).
      return buildSuccessionKpis({
        totalCriticalRoles: totalRoles,
        totalSuccessors,
        rolesWithoutSuccessor,
        readyNowCount: readyNow,
        ready1to2YearsCount: ready1to2Years,
        highFlightRiskRoles: highFlightRisk,
      });
    }),
});
```

replaced by just the router's closing:

```typescript
});
```

(i.e. `getSuggestedSuccessors`'s procedure — wait, `simulateExit`'s closing `}),` from Step 1b below — becomes the last procedure; the router then closes with a single `});`.)

**b) The entire `// ── Analytics ──` section (`getFlightRisk`, `getCompetencyCoverage`, `getRolesWithoutSuccessor`, `getCompGapAlerts`, `getSuggestedSuccessors`, `simulateExit` — all 6 procedures + the section header):**

```typescript
  // ── Analytics ────────────────────────────────────────────────────────

  getFlightRisk: permissionProcedure('succession', 'read')
    .input(
      z.object({
        // 0.7 = high-risk threshold (matches getDashboardKpis highFlightRiskRoles count)
        threshold: z.number().min(0).max(1).default(0.7),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      // Org-rollup risk register across all critical roles → interim org-gate.
      requireOrgScope(ctx.access);
      const threshold = input?.threshold ?? 0.7;
      return db.criticalRole.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          flightRisk: { gte: threshold },
        },
        include: {
          currentHolder: {
            select: { id: true, firstName: true, lastName: true, avatar: true },
          },
          _count: { select: { successors: true } },
        },
        orderBy: { flightRisk: 'desc' },
      });
    }),

  getCompetencyCoverage: permissionProcedure('succession', 'read')
    .query(async ({ ctx }) => {
      // Org-rollup coverage report across all roles → interim org-gate.
      requireOrgScope(ctx.access);
      const roles = await db.criticalRole.findMany({
        where: { organizationId: ctx.user.organizationId },
        include: {
          successors: {
            select: { readiness: true },
          },
        },
      });

      // Pure per-role coverage rollup → @tims/shared (golden-parity with the C# port).
      return buildCompetencyCoverage(roles);
    }),

  getRolesWithoutSuccessor: permissionProcedure('succession', 'read')
    .query(async ({ ctx }) => {
      // Org-rollup gap report across all roles → interim org-gate.
      requireOrgScope(ctx.access);
      return db.criticalRole.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          successors: { none: {} },
        },
        include: {
          currentHolder: {
            select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true },
          },
        },
        orderBy: { criticality: 'asc' },
      });
    }),

  // Sprint 1.4 Task 4 — Compensation <-> Succession readiness check.
  // READ-ONLY: flags a `ready_now` Successor whose current compensation is
  // well below their target role's salary band midpoint. Threshold below is
  // a documented starting point, not a spec-mandated rule — adjust freely.
  //
  // EmployeeCompensation is NOT a history table: @@unique([organizationId,
  // userId]) guarantees exactly one "current" row per user, so this is a
  // plain lookup-by-unique-key, not an "order by most recent" query.
  getCompGapAlerts: permissionProcedure('succession', 'read')
    .query(async ({ ctx }) => {
      // Org-rollup alert list across all roles → interim org-gate, same
      // pattern as getFlightRisk/getRolesWithoutSuccessor/getDashboardKpis.
      requireOrgScope(ctx.access);
      const orgId = ctx.user.organizationId;

      // §21 field-auth: employeeCompensation.currentSalary/currency is restricted
      // data (classification.ts) and succession:read is NOT the gate for it.
      // Today's seeded matrix happens to grant succession:read only to roles that
      // also hold compensation:read, so there is no active exploit — but nothing
      // in this endpoint enforced that until now. Secondary in-body permission
      // check, same pattern as vacancy/crud.ts's create mutation checking
      // vacancy:publish beyond its own procedure gate: a future role granted
      // succession:read without compensation:read must still be refused here.
      const compAccess = await buildAccessForUser(
        {
          id: ctx.user.id,
          organizationId: ctx.user.organizationId,
          roles: ctx.user.roles,
          isPlatformOwner: ctx.user.isPlatformOwner,
        },
        'compensation',
        'read',
      );
      if (!compAccess.allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'No tiene permiso para ver datos de compensacion',
        });
      }

      // Codex hardening: succession:read may be org-wide while compensation:read is
      // NARROW (team/unit/own). selectFor above governs WHICH columns leave the DB,
      // but NOT which ROWS — so also apply the employeeCompensation ROW scope as a
      // filter, else a narrow-comp caller reads org-wide salary comp-gaps. compAccess
      // is the compensation decision (narrowed to the allowed variant here); attach
      // the request-local anchor loader (ctx.access.anchors is per-USER and
      // module-independent → correct for the compensation entity too). At org/company
      // comp scope scopeWhereFor early-returns {} → the AND below is a no-op
      // (behavior-identical to today); at narrow scope with a null loader it fail-closes
      // FORBIDDEN (desired), else it intersects to the caller's subject set.
      const compScopeWhere = await scopeWhereFor(
        'employeeCompensation',
        { ...compAccess, anchors: ctx.access.anchors },
        ctx.user.id,
      );

      // Only roles that opted into a target band can ever produce an alert.
      // §21: explicit `select` (not `include`) — Successor.developmentPlan alone
      // can run up to 20k chars and nothing here reads it.
      const roles = await db.criticalRole.findMany({
        where: { organizationId: orgId, targetBandLevel: { not: null } },
        select: {
          id: true,
          title: true,
          targetBandLevel: true,
          successors: {
            where: { readiness: 'ready_now' },
            select: {
              id: true,
              userId: true,
              user: {
                select: { id: true, firstName: true, lastName: true, avatar: true },
              },
            },
          },
        },
      });

      const candidateRoles = roles.filter((r) => r.successors.length > 0);
      if (candidateRoles.length === 0) return [];

      // Soft string match: targetBandLevel -> SalaryBand.level (no FK).
      const levels = Array.from(
        new Set(candidateRoles.map((r) => r.targetBandLevel).filter((l): l is string => !!l)),
      );
      const bands = await db.salaryBand.findMany({
        where: { organizationId: orgId, level: { in: levels } },
        select: { level: true, midSalary: true },
      });
      const userIds = Array.from(
        new Set(candidateRoles.flatMap((r) => r.successors.map((s) => s.userId))),
      );
      // §21 field-auth: build the select from selectFor(compAccess.roles) BEFORE
      // the query so currentSalary/currency only LEAVE the DB for roles actually
      // entitled to them (never select a sensitive field and null it afterward —
      // db.md / api-security.md), same pattern as compensation.ts's
      // simulateAdjustment/listPendingAdjustments.
      // Exactly one row per (organizationId, userId) — a plain lookup, not an
      // "order by most recent" query (no history table for current comp).
      const compSel = selectFor(compAccess.roles, 'employeeCompensation');
      const compensations = await db.employeeCompensation.findMany({
        // AND (never spread) the userId-narrowing base with the comp scope fragment:
        // a plain spread would COLLIDE with the base `userId: { in }` key.
        where: {
          organizationId: orgId,
          AND: [
            { userId: { in: userIds } },
            compScopeWhere as Prisma.EmployeeCompensationWhereInput,
          ],
        },
        select: {
          id: true,
          userId: true,
          ...(compSel.currentSalary ? { currentSalary: true } : {}),
          ...(compSel.currency ? { currency: true } : {}),
        },
      });
      // Dynamic select means currentSalary/currency may be entirely absent from a
      // row (role not entitled) — read via a typed lens that tolerates absence,
      // same pattern as simulateAdjustment's compRec cast.
      const compByUser = new Map(
        compensations.map((c) => {
          const rec = c as { id: string; userId: string; currentSalary?: number; currency?: string };
          return [rec.userId, rec] as const;
        }),
      );

      // Pure detection loop → @tims/shared (golden-parity with the C# port). It returns the alerts AND
      // the employeeCompensation record ids actually EXPOSED via those alerts — the audit trail below
      // logs exactly these, not every row initially queried.
      const { alerts, auditedCompIds } = buildCompGapAlerts(
        candidateRoles,
        bands,
        Array.from(compByUser.values()),
      );

      // §21 matrix: getCompGapAlerts reads employeeCompensation (restricted, FULL+AUDIT).
      // One audit-log row per EXPOSED record (the ones whose salary data the caller
      // actually received), not per row initially queried. Audit BEFORE returning so a
      // fail-closed audit-write failure aborts pre-serialization (same as simulateAdjustment).
      const actorId = ctx.user.impersonatorId ?? ctx.user.id;
      const ipAddress = ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip');
      const userAgent = ctx.headers.get('user-agent');
      await Promise.all(
        auditedCompIds.map((recordId) =>
          logDataAccess({
            organizationId: orgId,
            actorId,
            entity: 'employeeCompensation',
            recordId,
            action: 'read',
            ipAddress,
            userAgent,
          }),
        ),
      );

      return alerts;
    }),

  // Sprint 1.4 Task 1 — Nine Box → Succession suggested-successor query.
  // READ-ONLY: this NEVER creates/updates/deletes a Successor row. It only
  // surfaces a suggestion; a human must still open the Add Successor modal
  // and confirm submit (the modal is pre-filled, not auto-submitted).
  getSuggestedSuccessors: permissionProcedure('succession', 'read')
    .input(z.object({ criticalRoleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // By-id read on the parent role → scope-probe it (same pattern as
      // addSuccessor/simulateExit): a narrow-scoped caller can't fish for
      // suggestions on a role outside their grant.
      await assertScoped(
        'criticalRole',
        input.criticalRoleId,
        ctx.access,
        ctx.user.id,
        ctx.user.organizationId,
      );

      const scopeWhere = (await scopeWhereFor(
        'nineBoxEvaluation',
        ctx.access,
        ctx.user.id,
      )) as Prisma.NineBoxEvaluationWhereInput;

      // NineBoxEvaluation accumulates one row per (user, period). Order by
      // evaluatedAt desc and keep only the FIRST row seen per user below —
      // that is each user's most-recent evaluation. A stale old "star"
      // placement from an earlier period must never resurface once a later
      // evaluation moved that person to a different quadrant.
      // Secondary tiebreaker on createdAt desc: the unique constraint is
      // (organizationId, userId, period) — NOT evaluatedAt — so two rows for
      // the same user (different periods, e.g. a backfill/correction) can
      // legitimately share an identical evaluatedAt. Without a deterministic
      // secondary sort, which row Postgres returns first for that tie is
      // undefined. createdAt (row-insertion time) breaks the tie
      // deterministically toward whichever row was recorded most recently.
      const evaluations = await db.nineBoxEvaluation.findMany({
        where: {
          AND: [{ organizationId: ctx.user.organizationId }, scopeWhere],
        },
        select: {
          userId: true,
          quadrant: true,
          potentialScore: true,
          performanceScore: true,
          evaluatedAt: true,
          user: {
            select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true },
          },
        },
        orderBy: [{ evaluatedAt: 'desc' }, { createdAt: 'desc' }],
      });

      // Exclude anyone already a Successor for this role (the confirmed
      // @@unique([criticalRoleId, userId]) constraint on Successor).
      const existing = await db.successor.findMany({
        where: { criticalRoleId: input.criticalRoleId, organizationId: ctx.user.organizationId },
        select: { userId: true },
      });

      // Pure first-seen dedup + star/high_potential filter + ranking → @tims/shared (golden-parity with
      // the C# port). The heuristic (star → ready_now, high_potential → ready_1_year) lives in the kernel;
      // this is only a suggestion — HR reviews and can change readiness before confirming in the modal.
      return buildSuggestedSuccessors(
        evaluations,
        existing.map((s) => s.userId),
      );
    }),

  // Stub: simulate the impact of a key person exit
  simulateExit: permissionProcedure('succession', 'read')
    .input(z.object({ criticalRoleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // By-id read → scope-probe the role.
      await assertScoped(
        'criticalRole',
        input.criticalRoleId,
        ctx.access,
        ctx.user.id,
        ctx.user.organizationId,
      );
      const successorScope = await scopeWhereFor('successor', ctx.access, ctx.user.id);
      const role = await db.criticalRole.findFirstOrThrow({
        where: { id: input.criticalRoleId, organizationId: ctx.user.organizationId },
        include: {
          currentHolder: {
            select: { id: true, firstName: true, lastName: true },
          },
          successors: {
            where: successorScope as Prisma.SuccessorWhereInput,
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, jobTitle: true },
              },
            },
            orderBy: { readiness: 'asc' },
          },
        },
      });

      // Pure exit-impact decision (risk + recommendation) → @tims/shared (golden-parity with the C# port).
      const { riskLevel, recommendation, readyNowCount, pipelineCount } = buildExitSimulation(
        role.successors,
      );

      return {
        role: { id: role.id, title: role.title, criticality: role.criticality },
        currentHolder: role.currentHolder,
        riskLevel,
        recommendation,
        successors: role.successors,
        readyNowCount,
        pipelineCount,
      };
    }),

```

(delete the whole block, including the `// ── Analytics ──` header line and the trailing blank line right after `simulateExit`'s closing `}),` — the next content is Step 1a's `// ── Dashboard KPIs ──` header, ALSO deleted by this plan, so after both 1a and 1b the router flows directly from `updateCriticalRoleBand`'s closing `}),` to the final `});`.)

**c) `updateCriticalRoleBand` (keep the `// ── Successors ──` section header since `removeSuccessor`/`updateSuccessorReadiness` remain under it):**

```typescript
  // Sprint 1.4 Task 4 — minimal single-field mutation to set a Critical
  // Role's target salary band level (soft string match to SalaryBand.level,
  // no FK). Deliberately NOT a general CriticalRole editor: no CriticalRole
  // create/edit form exists in this app today, and building one is out of
  // scope for this task (see brief's scope-correction note).
  updateCriticalRoleBand: permissionProcedure('succession', 'update')
    .input(
      z.object({
        criticalRoleId: z.string().uuid(),
        targetBandLevel: z.string().max(50).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped(
        'criticalRole',
        input.criticalRoleId,
        ctx.access,
        ctx.user.id,
        ctx.user.organizationId,
      );
      return db.criticalRole.update({
        where: { id: input.criticalRoleId, organizationId: ctx.user.organizationId },
        data: { targetBandLevel: input.targetBandLevel },
        select: { id: true, targetBandLevel: true },
      });
    }),

```

**d) `addSuccessor` (keep the `// ── Successors ──` section header above it since `removeSuccessor`/`updateSuccessorReadiness` remain under it too):**

```typescript
  addSuccessor: permissionProcedure('succession', 'create')
    .input(
      z.object({
        criticalRoleId: z.string().uuid(),
        userId: z.string().uuid(),
        readiness: z.enum(['ready_now', 'ready_1_year', 'ready_2_years', 'developing']),
        type: z.enum(['internal', 'external']),
        developmentPlan: z.string().max(20000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The parent critical role must be in the caller's grant…
      await assertScoped(
        'criticalRole',
        input.criticalRoleId,
        ctx.access,
        ctx.user.id,
        ctx.user.organizationId,
      );
      // …and the proposed successor must be a user in the caller's subject set.
      await assertSubjectInScope(
        ctx.access,
        ctx.user.id,
        input.userId,
        'No puedes agregar este sucesor',
      );
      // Codex H1 hardening (both-stacks parity with the C# strangler port): assertSubjectInScope no-ops for
      // organization/company scope (it enforces SCOPE, not org membership), so an org-scoped caller could
      // otherwise persist a cross-tenant userId (the successors.userId FK check bypasses RLS). Verify the target
      // user is a member of the caller's org before the INSERT; a cross-org user → FORBIDDEN (never persisted).
      const targetUser = await db.user.findFirst({
        where: { id: input.userId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!targetUser) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No puedes agregar este sucesor' });
      }
      return db.successor.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          addedById: ctx.user.id,
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, avatar: true },
          },
        },
      });
    }),

```

**e) `listCriticalRoles` (keep the `// ── Critical Roles ──` section header above it since `getCriticalRole`/`addCriticalRole` remain under it):**

```typescript
  listCriticalRoles: permissionProcedure('succession', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        criticality: z.string().max(100).optional(),
        search: z.string().max(200).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const filters = input ?? {};
      // Row-level read → compose the criticalRole scope fragment (anchored on
      // the role's currentHolderId). Input filters only intersect.
      const scopeWhere = (await scopeWhereFor('criticalRole', ctx.access, ctx.user.id)) as Prisma.CriticalRoleWhereInput;
      // Codex: nested successors are people rows with their own policy — a
      // role visible via its holder must not expose out-of-scope successors.
      const successorScope = await scopeWhereFor('successor', ctx.access, ctx.user.id);
      return db.criticalRole.findMany({
        where: {
          AND: [
            {
              organizationId: ctx.user.organizationId,
              ...(filters.companyId && { companyId: filters.companyId }),
              ...(filters.unitId && { unitId: filters.unitId }),
              ...(filters.criticality && { criticality: filters.criticality }),
              ...(filters.search && {
                title: { contains: filters.search, mode: 'insensitive' as const },
              }),
            },
            scopeWhere,
          ],
        },
        include: {
          currentHolder: {
            select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true },
          },
          successors: {
            where: successorScope as Prisma.SuccessorWhereInput,
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { title: 'asc' },
      });
    }),

```

After all 5 sub-steps, the router reads (in order): imports → `successionRouter = router({` → `// ── Critical Roles ──` header → `getCriticalRole` → `addCriticalRole` → `// ── Successors ──` header → `removeSuccessor` → `updateSuccessorReadiness` → `});`.

- [ ] **Step 2: Remove the now-unused imports from the router**

Change:

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import {
  buildCompetencyCoverage,
  buildSuccessionKpis,
  buildExitSimulation,
  buildSuggestedSuccessors,
  buildCompGapAlerts,
} from '@tims/shared';
import {
  scopeWhereFor,
  assertScoped,
  assertSubjectInScope,
  requireOrgScope,
  buildAccessForUser,
  selectFor,
  logDataAccess,
} from '../access';
```

to:

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, requireOrgScope } from '../access';
```

(`z`/`TRPCError`/`router`/`permissionProcedure`/`db`/`Prisma` stay — used by the 4 surviving procedures. The entire `@tims/shared` import block is removed — `buildCompetencyCoverage`/`buildSuccessionKpis`/`buildExitSimulation`/`buildSuggestedSuccessors`/`buildCompGapAlerts` had zero remaining call sites in this file after Step 1. From `../access`: `scopeWhereFor` stays [used by `getCriticalRole`], `assertScoped` stays [used by `getCriticalRole`, `removeSuccessor`, `updateSuccessorReadiness`], `requireOrgScope` stays [used by `addCriticalRole`]; `assertSubjectInScope`/`buildAccessForUser`/`selectFor`/`logDataAccess` are removed — zero remaining call sites.)

- [ ] **Step 3: Rewrite the FE wrapper as C#-only**

Replace the ENTIRE contents of `apps/web/lib/platform-api/succession.ts` with:

```typescript
'use client';

// C#-only succession reads + writes. The 8 TS tRPC read procedures
// (getDashboardKpis/listCriticalRoles/getCompetencyCoverage/getFlightRisk/
// getRolesWithoutSuccessor/getCompGapAlerts/getSuggestedSuccessors/simulateExit) and 2 TS tRPC
// write procedures (addSuccessor/updateCriticalRoleBand) have been deleted — there is no TS
// fallback path left for any of the 10 hooks below. NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP and
// NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP are both confirmed live in prod; this file calls the C#
// service unconditionally rather than gating on either flag.
//
// getCriticalRole (the one read with zero FE consumers) still has a live TS implementation in
// packages/api/src/routers/succession.ts — it was never wrapped here and stays untouched.

import { useMutation, useQuery } from '@tanstack/react-query';
import type { SuccessionKpiView, CoverageRow, SuggestedSuccessor, CompGapAlert, ExitRiskLevel } from '@tims/shared';
import { platformGet, platformPatch, platformPost } from './client';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to `number`.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

// DateTime fields serialize as canonical Node-ISO strings (…fffZ). Reconstruct real Date objects
// so every shape below is byte-identical to what the deleted tRPC procedures used to return.
const toDate = (v: unknown): Date => new Date(v as string);

export interface SuccessorItem {
  id: string;
  organizationId: string;
  criticalRoleId: string;
  userId: string;
  readiness: 'ready_now' | 'ready_1_year' | 'ready_2_years' | 'developing';
  type: 'internal' | 'external';
  developmentPlan: string | null;
  addedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; firstName: string; lastName: string; avatar: string | null; jobTitle: string | null };
}

const mapListSuccessor = (s: {
  id: string;
  organizationId: string;
  criticalRoleId: string;
  userId: string;
  readiness: string;
  type: string;
  developmentPlan?: string | null;
  addedById?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  user: { id: string; firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null };
}): SuccessorItem => ({
  id: s.id,
  organizationId: s.organizationId,
  criticalRoleId: s.criticalRoleId,
  userId: s.userId,
  readiness: s.readiness as SuccessorItem['readiness'],
  type: s.type as SuccessorItem['type'],
  developmentPlan: s.developmentPlan ?? null,
  addedById: s.addedById ?? null,
  createdAt: toDate(s.createdAt),
  updatedAt: toDate(s.updatedAt),
  user: {
    id: s.user.id,
    firstName: s.user.firstName,
    lastName: s.user.lastName,
    avatar: s.user.avatar ?? null,
    jobTitle: s.user.jobTitle ?? null,
  },
});

export interface CriticalRoleListItem {
  id: string;
  organizationId: string;
  title: string;
  positionId: string | null;
  currentHolderId: string | null;
  companyId: string | null;
  unitId: string | null;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  flightRisk: number | null;
  targetBandLevel: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentHolder: {
    id: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
    jobTitle: string | null;
  } | null;
  successors: SuccessorItem[];
}
type ListCriticalRolesOutput = CriticalRoleListItem[];

export interface FlightRiskItem {
  id: string;
  organizationId: string;
  title: string;
  positionId: string | null;
  currentHolderId: string | null;
  companyId: string | null;
  unitId: string | null;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  flightRisk: number | null;
  targetBandLevel: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentHolder: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  _count: { successors: number };
}
type FlightRiskOutput = FlightRiskItem[];

export interface RoleWithoutSuccessorItem {
  id: string;
  organizationId: string;
  title: string;
  positionId: string | null;
  currentHolderId: string | null;
  companyId: string | null;
  unitId: string | null;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  flightRisk: number | null;
  targetBandLevel: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentHolder: {
    id: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
    jobTitle: string | null;
  } | null;
}
type RolesWithoutSuccessorOutput = RoleWithoutSuccessorItem[];

export interface SimulateExitOutput {
  role: { id: string; title: string; criticality: 'critical' | 'high' | 'medium' | 'low' };
  currentHolder: { id: string; firstName: string; lastName: string } | null;
  riskLevel: ExitRiskLevel;
  recommendation: string;
  successors: SuccessorItem[];
  readyNowCount: number;
  pipelineCount: number;
}

export interface AddSuccessorOutput {
  id: string;
  organizationId: string;
  criticalRoleId: string;
  userId: string;
  readiness: 'ready_now' | 'ready_1_year' | 'ready_2_years' | 'developing';
  type: 'internal' | 'external';
  developmentPlan: string | null;
  addedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; firstName: string; lastName: string; avatar: string | null };
}

export interface UpdateCriticalRoleBandOutput {
  id: string;
  targetBandLevel: string | null;
}

/** STAFF org-rollup: the succession KPI dashboard tile counts. GET /succession/dashboard-kpis. */
export function useSuccessionDashboardKpis() {
  return useQuery<SuccessionKpiView>({
    queryKey: ['platform-api', 'succession', 'dashboard-kpis'],
    queryFn: async () => {
      const raw = await platformGet('/succession/dashboard-kpis');
      return {
        totalCriticalRoles: num(raw.totalCriticalRoles),
        totalSuccessors: num(raw.totalSuccessors),
        rolesWithoutSuccessor: num(raw.rolesWithoutSuccessor),
        coverageRate: num(raw.coverageRate),
        readyNowCount: num(raw.readyNowCount),
        ready1to2YearsCount: num(raw.ready1to2YearsCount),
        highFlightRiskRoles: num(raw.highFlightRiskRoles),
        avgSuccessorsPerRole: num(raw.avgSuccessorsPerRole),
      };
    },
  });
}

/** STAFF row-scoped: critical roles (scope-filtered) + their in-scope successors. GET /succession/critical-roles. */
export function useSuccessionCriticalRoles(filters?: {
  companyId?: string;
  unitId?: string;
  criticality?: string;
  search?: string;
}) {
  return useQuery<ListCriticalRolesOutput>({
    queryKey: ['platform-api', 'succession', 'critical-roles', filters ?? {}],
    queryFn: async () => {
      const raw = await platformGet('/succession/critical-roles', {
        companyId: filters?.companyId,
        unitId: filters?.unitId,
        criticality: filters?.criticality,
        search: filters?.search,
      });
      return raw.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        title: r.title,
        positionId: r.positionId ?? null,
        currentHolderId: r.currentHolderId ?? null,
        companyId: r.companyId ?? null,
        unitId: r.unitId ?? null,
        criticality: r.criticality as CriticalRoleListItem['criticality'],
        flightRisk: numOrNull(r.flightRisk),
        targetBandLevel: r.targetBandLevel ?? null,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
        currentHolder: r.currentHolder
          ? {
              id: r.currentHolder.id,
              firstName: r.currentHolder.firstName,
              lastName: r.currentHolder.lastName,
              avatar: r.currentHolder.avatar ?? null,
              jobTitle: r.currentHolder.jobTitle ?? null,
            }
          : null,
        successors: r.successors.map(mapListSuccessor),
      }));
    },
  });
}

/** STAFF org-rollup: per-role competency-coverage rows. GET /succession/competency-coverage. */
export function useSuccessionCompetencyCoverage() {
  return useQuery<CoverageRow[]>({
    queryKey: ['platform-api', 'succession', 'competency-coverage'],
    queryFn: async () => {
      const raw = await platformGet('/succession/competency-coverage');
      return raw.map((row) => ({
        roleId: row.roleId,
        title: row.title,
        criticality: row.criticality,
        totalSuccessors: num(row.totalSuccessors),
        readyNow: num(row.readyNow),
        readySoon: num(row.readySoon),
        developing: num(row.developing),
        coverageStatus: row.coverageStatus as CoverageRow['coverageStatus'],
      }));
    },
  });
}

/** STAFF org-rollup: the flight-risk register. GET /succession/flight-risk. */
export function useSuccessionFlightRisk(input?: { threshold?: number }) {
  return useQuery<FlightRiskOutput>({
    queryKey: ['platform-api', 'succession', 'flight-risk', input?.threshold ?? null],
    queryFn: async () => {
      const raw = await platformGet('/succession/flight-risk', { threshold: input?.threshold });
      return raw.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        title: r.title,
        positionId: r.positionId ?? null,
        currentHolderId: r.currentHolderId ?? null,
        companyId: r.companyId ?? null,
        unitId: r.unitId ?? null,
        criticality: r.criticality as FlightRiskItem['criticality'],
        flightRisk: numOrNull(r.flightRisk),
        targetBandLevel: r.targetBandLevel ?? null,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
        currentHolder: r.currentHolder
          ? {
              id: r.currentHolder.id,
              firstName: r.currentHolder.firstName,
              lastName: r.currentHolder.lastName,
              avatar: r.currentHolder.avatar ?? null,
            }
          : null,
        _count: { successors: num(r._count.successors) },
      }));
    },
  });
}

/** STAFF org-rollup: critical roles with no successor. GET /succession/roles-without-successor. */
export function useSuccessionRolesWithoutSuccessor() {
  return useQuery<RolesWithoutSuccessorOutput>({
    queryKey: ['platform-api', 'succession', 'roles-without-successor'],
    queryFn: async () => {
      const raw = await platformGet('/succession/roles-without-successor');
      return raw.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        title: r.title,
        positionId: r.positionId ?? null,
        currentHolderId: r.currentHolderId ?? null,
        companyId: r.companyId ?? null,
        unitId: r.unitId ?? null,
        criticality: r.criticality as RoleWithoutSuccessorItem['criticality'],
        flightRisk: numOrNull(r.flightRisk),
        targetBandLevel: r.targetBandLevel ?? null,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
        currentHolder: r.currentHolder
          ? {
              id: r.currentHolder.id,
              firstName: r.currentHolder.firstName,
              lastName: r.currentHolder.lastName,
              avatar: r.currentHolder.avatar ?? null,
              jobTitle: r.currentHolder.jobTitle ?? null,
            }
          : null,
      }));
    },
  });
}

/** STAFF org-rollup: comp-gap alerts. GET /succession/comp-gap-alerts. */
export function useSuccessionCompGapAlerts() {
  return useQuery<CompGapAlert[]>({
    queryKey: ['platform-api', 'succession', 'comp-gap-alerts'],
    queryFn: async () => {
      const raw = await platformGet('/succession/comp-gap-alerts');
      return raw.map((a) => ({
        successorId: a.successorId,
        roleId: a.roleId,
        roleTitle: a.roleTitle,
        userId: a.userId,
        user: {
          id: a.user.id,
          firstName: a.user.firstName,
          lastName: a.user.lastName,
          avatar: a.user.avatar ?? null,
        },
        currentSalary: num(a.currentSalary),
        currency: a.currency,
        midSalary: num(a.midSalary),
        bandLevel: a.bandLevel,
        gapPercent: num(a.gapPercent),
      }));
    },
  });
}

/** STAFF by-id: ranked suggested successors for a critical role. GET /succession/critical-roles/{criticalRoleId}/suggested-successors. */
export function useSuccessionSuggestedSuccessors(criticalRoleId: string) {
  const enabledId = !!criticalRoleId;
  return useQuery<SuggestedSuccessor[]>({
    queryKey: ['platform-api', 'succession', 'suggested-successors', criticalRoleId],
    enabled: enabledId,
    queryFn: async () => {
      const raw = await platformGet('/succession/critical-roles/{criticalRoleId}/suggested-successors', undefined, {
        criticalRoleId,
      });
      return raw.map((s) => ({
        userId: s.userId,
        user: {
          id: s.user.id,
          firstName: s.user.firstName,
          lastName: s.user.lastName,
          avatar: s.user.avatar ?? null,
          jobTitle: s.user.jobTitle ?? null,
        },
        quadrant: s.quadrant,
        potentialScore: num(s.potentialScore),
        performanceScore: num(s.performanceScore),
        suggestedReadiness: s.suggestedReadiness as SuggestedSuccessor['suggestedReadiness'],
      }));
    },
  });
}

/** STAFF by-id: exit-impact simulation for a critical role. GET /succession/critical-roles/{criticalRoleId}/simulate-exit. */
export function useSuccessionSimulateExit(criticalRoleId: string) {
  const enabledId = !!criticalRoleId;
  return useQuery<SimulateExitOutput>({
    queryKey: ['platform-api', 'succession', 'simulate-exit', criticalRoleId],
    enabled: enabledId,
    queryFn: async () => {
      const raw = await platformGet('/succession/critical-roles/{criticalRoleId}/simulate-exit', undefined, {
        criticalRoleId,
      });
      return {
        role: {
          id: raw.role.id,
          title: raw.role.title,
          criticality: raw.role.criticality as SimulateExitOutput['role']['criticality'],
        },
        currentHolder: raw.currentHolder
          ? {
              id: raw.currentHolder.id,
              firstName: raw.currentHolder.firstName,
              lastName: raw.currentHolder.lastName,
            }
          : null,
        riskLevel: raw.riskLevel as ExitRiskLevel,
        recommendation: raw.recommendation,
        successors: raw.successors.map((s) => ({
          id: s.id,
          organizationId: s.organizationId,
          criticalRoleId: s.criticalRoleId,
          userId: s.userId,
          readiness: s.readiness as SuccessorItem['readiness'],
          type: s.type as SuccessorItem['type'],
          developmentPlan: s.developmentPlan ?? null,
          addedById: s.addedById ?? null,
          createdAt: toDate(s.createdAt),
          updatedAt: toDate(s.updatedAt),
          user: {
            id: s.user.id,
            firstName: s.user.firstName,
            lastName: s.user.lastName,
            avatar: null,
            jobTitle: s.user.jobTitle ?? null,
          },
        })),
        readyNowCount: num(raw.readyNowCount),
        pipelineCount: num(raw.pipelineCount),
      };
    },
  });
}

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  options: MutationOptions | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

interface AddSuccessorInputShape {
  criticalRoleId: string;
  userId: string;
  readiness: string;
  type: string;
  developmentPlan?: string;
}

/** STAFF: add a successor to a critical role (1 call site: add-successor-modal.tsx). */
export function useSuccessionAddSuccessor(options?: MutationOptions) {
  return useCSharpMutation(async (input: AddSuccessorInputShape) => {
    const raw = await platformPost(
      '/succession/critical-roles/{criticalRoleId}/successors',
      {
        userId: input.userId,
        readiness: input.readiness,
        type: input.type,
        developmentPlan: input.developmentPlan,
      },
      { criticalRoleId: input.criticalRoleId },
    );
    return {
      id: raw.id,
      organizationId: raw.organizationId,
      criticalRoleId: raw.criticalRoleId,
      userId: raw.userId,
      readiness: raw.readiness as AddSuccessorOutput['readiness'],
      type: raw.type as AddSuccessorOutput['type'],
      developmentPlan: raw.developmentPlan ?? null,
      addedById: raw.addedById ?? null,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt),
      user: {
        id: raw.user.id,
        firstName: raw.user.firstName,
        lastName: raw.user.lastName,
        avatar: raw.user.avatar ?? null,
      },
    } satisfies AddSuccessorOutput;
  }, options);
}

interface UpdateCriticalRoleBandInputShape {
  criticalRoleId: string;
  targetBandLevel: string | null;
}

/** STAFF: set a critical role's target salary band level (1 call site: succession-pipeline.tsx). */
export function useSuccessionUpdateCriticalRoleBand(options?: MutationOptions) {
  return useCSharpMutation(async (input: UpdateCriticalRoleBandInputShape) => {
    const raw = await platformPatch(
      '/succession/critical-roles/{criticalRoleId}/band',
      { targetBandLevel: input.targetBandLevel },
      { criticalRoleId: input.criticalRoleId },
    );
    return { id: raw.id, targetBandLevel: raw.targetBandLevel } satisfies UpdateCriticalRoleBandOutput;
  }, options);
}
```

(Note: `simulateExit`'s successor mapping originally read `avatar` from `s.user.avatar` in some paths — the ORIGINAL wrapper's `simulateExit` successor-user object did NOT include `avatar` in its select at all [check: the router's `simulateExit` procedure selects `{ id, firstName, lastName, jobTitle }` for successor users, no avatar field] — so the mapped output's `user.avatar` should be `null` always for this one hook specifically, matching the ORIGINAL wrapper's behavior exactly. This is preserved above.)

- [ ] **Step 4: Remove the dead invalidate calls from `add-successor-modal.tsx`**

Change:

```typescript
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
```

to:

```typescript
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
```

Change:

```typescript
const { t } = useI18n();
const utils = trpc.useUtils();
const queryClient = useQueryClient();
```

to:

```typescript
const { t } = useI18n();
const queryClient = useQueryClient();
```

Change:

```typescript
const submit = useSuccessionAddSuccessor({
  onSuccess: () => {
    utils.succession.listCriticalRoles.invalidate();
    utils.succession.getDashboardKpis.invalidate();
    utils.succession.getCompetencyCoverage.invalidate();
    utils.succession.getRolesWithoutSuccessor.invalidate();
    // Sprint 1.4 Task 1 → Task 4 cross-feature handoff: adding a suggested
    // successor (from the Nine Box panel) must live-refresh both the
    // comp-gap check (now sees the new ready_now successor) and the
    // suggestion list itself (must drop the just-added candidate).
    utils.succession.getCompGapAlerts.invalidate();
    utils.succession.getSuggestedSuccessors.invalidate();
    // Cutover parity: also refresh the C# platform-api succession reads (prefix match covers all
    // eight) so a flag-on cache stays coherent. No-op while the reads route through tRPC.
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
    toast(t.succession.addSuccessorSuccess, { type: 'success' });
    onClose();
  },
  onError: (err) => toast(err.message, { type: 'error' }),
});
```

to:

```typescript
const submit = useSuccessionAddSuccessor({
  onSuccess: () => {
    // The TS tRPC succession reads have been deleted — the platform-api query keys are the
    // only read path left to invalidate.
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
    toast(t.succession.addSuccessorSuccess, { type: 'success' });
    onClose();
  },
  onError: (err) => toast(err.message, { type: 'error' }),
});
```

- [ ] **Step 5: Remove the dead invalidate calls from `succession-pipeline.tsx`**

Change:

```typescript
import { trpc } from '../../../../lib/trpc';
```

— delete this import line entirely (grep the file first to confirm `trpc` has zero other uses beyond `trpc.useUtils()`).

Change:

```typescript
const utils = trpc.useUtils();
const queryClient = useQueryClient();
```

to:

```typescript
const queryClient = useQueryClient();
```

Change:

```typescript
const updateBand = useSuccessionUpdateCriticalRoleBand({
  onSuccess: () => {
    utils.succession.listCriticalRoles.invalidate();
    utils.succession.getCompGapAlerts.invalidate();
    // Cutover parity: refresh the C# platform-api succession reads. No-op under tRPC.
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
    toast(t.targetBandUpdateSuccess, { type: 'success' });
  },
  onError: () => toast(t.targetBandUpdateError, { type: 'error' }),
});
```

to:

```typescript
const updateBand = useSuccessionUpdateCriticalRoleBand({
  onSuccess: () => {
    // The TS tRPC succession reads have been deleted — the platform-api query key is the only
    // read path left to invalidate.
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
    toast(t.targetBandUpdateSuccess, { type: 'success' });
  },
  onError: () => toast(t.targetBandUpdateError, { type: 'error' }),
});
```

- [ ] **Step 6: Remove ONLY the one dead succession invalidate call from `request-adjustment-modal.tsx`**

`utils`/`trpc` MUST stay in this file — `utils.compensation.*` calls are still live/untouched. Change:

```typescript
const submit = useCompensationCreateAdjustment({
  onSuccess: () => {
    utils.succession.getCompGapAlerts.invalidate();
    utils.compensation.listPendingAdjustments.invalidate();
    utils.compensation.getDashboardKpis.invalidate();
    // Cutover parity: refresh the C# platform-api succession reads (comp-gap) AND the
    // compensation reads (listPendingAdjustments is driven by this create). No-op under tRPC.
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'compensation'] });
    toast(t.succession.requestAdjustmentSuccess, { type: 'success' });
    onClose();
  },
  onError: (err) => toast(err.message, { type: 'error' }),
});
```

to:

```typescript
const submit = useCompensationCreateAdjustment({
  onSuccess: () => {
    utils.compensation.listPendingAdjustments.invalidate();
    utils.compensation.getDashboardKpis.invalidate();
    // Cutover parity: refresh the C# platform-api succession (comp-gap, TS tRPC read deleted)
    // AND compensation reads (listPendingAdjustments is driven by this create).
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'compensation'] });
    toast(t.succession.requestAdjustmentSuccess, { type: 'success' });
    onClose();
  },
  onError: (err) => toast(err.message, { type: 'error' }),
});
```

- [ ] **Step 7: Shrink the `succession` parity-harness surface entry to its 1 surviving endpoint**

In `scripts/parity/surfaces.ts`, change the entire `succession` entry (currently 9 endpoints):

```typescript
  succession: {
    key: 'succession',
    flag: 'Platform__SuccessionReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'critical-roles',
        csharpPath: '/succession/critical-roles',
        tsProcedure: 'succession.listCriticalRoles',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'flight-risk',
        csharpPath: '/succession/flight-risk',
        tsProcedure: 'succession.getFlightRisk',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'competency-coverage',
        csharpPath: '/succession/competency-coverage',
        tsProcedure: 'succession.getCompetencyCoverage',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // TS has no orderBy here; C# orders by roleId → canonicalize both by roleId before diffing.
        normalize: { dropNullish: true, sortArraysBy: 'roleId' },
      },
      {
        name: 'roles-without-successor',
        csharpPath: '/succession/roles-without-successor',
        tsProcedure: 'succession.getRolesWithoutSuccessor',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'comp-gap-alerts',
        csharpPath: '/succession/comp-gap-alerts',
        tsProcedure: 'succession.getCompGapAlerts',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'dashboard-kpis',
        csharpPath: '/succession/dashboard-kpis',
        tsProcedure: 'succession.getDashboardKpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id: getCriticalRole/getSuggestedSuccessors/simulateExit = permissionProcedure('succession',
      // 'read') + assertScoped('criticalRole', id) — an IDOR-safe probe that returns 404 (NOT 403) for
      // out-of-scope. Org-A target = cr1 ('Parity Critical Role A1', holder super). super/hr_admin (org) → 200;
      // hrbp out-of-scope → 404 → OMITTED (404 isn't representable in 200|403 and isn't an RBAC-permission
      // signal). Mode-A IDOR: org-A token → org-B critical role → 404 (assertScoped ScopedNotFound). NOTE the
      // TS param name differs (`id` for getCriticalRole; `criticalRoleId` for the other two).
      {
        name: 'critical-role',
        csharpPath: '/succession/critical-roles/{id}',
        tsProcedure: 'succession.getCriticalRole',
        input: { id: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        // nested successors[] (≤1 seeded) → canonicalize any array by id before diffing.
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'suggested-successors',
        csharpPath: '/succession/critical-roles/{id}/suggested-successors',
        tsProcedure: 'succession.getSuggestedSuccessors',
        input: { criticalRoleId: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        // ranked candidate list (from nine-box evals) — deterministic kernel; sort by userId to be safe.
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'simulate-exit',
        csharpPath: '/succession/critical-roles/{id}/simulate-exit',
        tsProcedure: 'succession.simulateExit',
        input: { criticalRoleId: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
    ],
  },
```

to:

```typescript
  succession: {
    key: 'succession',
    flag: 'Platform__SuccessionReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      // UPDATE 2026-07-29: 8 of the original 9 endpoints here (critical-roles, flight-risk,
      // competency-coverage, roles-without-successor, comp-gap-alerts, dashboard-kpis,
      // suggested-successors, simulate-exit) were removed alongside the TS-deletion of their
      // procedures — packages/api/src/routers/succession.ts's listCriticalRoles/getFlightRisk/
      // getCompetencyCoverage/getRolesWithoutSuccessor/getCompGapAlerts/getDashboardKpis/
      // getSuggestedSuccessors/simulateExit and their FE tRPC fallback
      // (apps/web/lib/platform-api/succession.ts) have been deleted — there is no TS side left
      // to diff against for those 8. This surface stays registered (rather than removed
      // outright, unlike team-intel/billing-usage) because getCriticalRole below is NOT
      // deleted — it has zero FE consumers so was never wrapped, but its TS implementation is
      // still live, so `verify succession` still runs one REAL parity/RLS/RBAC check.
      {
        name: 'critical-role',
        csharpPath: '/succession/critical-roles/{id}',
        tsProcedure: 'succession.getCriticalRole',
        input: { id: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        // nested successors[] (≤1 seeded) → canonicalize any array by id before diffing.
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
    ],
  },
```

Also rewrite the doc-comment block directly above `succession: {` (the `// ── succession ──...` heading through the paragraph ending "...the harness surfaced that drift."):

```typescript
// ── succession ──────────────────────────────────────────────────────────────────────────────
// 6 of the 9 succession reads (the 3 by-id critical-roles/{id}, suggested-successors, simulate-exit
// are a Tier-2 follow-up needing the harness Mode-A id extension). All org-scoped Mode B. One flag
// Platform:SuccessionReadEnabled. RBAC (hr_admin succession:read@org [+ compensation:read@org from the
// compensation seed, for the comp-gap secondary check], hrbp @unit): critical-roles uses scopeWhereFor
// (hrbp → 200-empty, faithful — hrbp holds unit-scoped succession read); the org-rollup reads (flight-risk,
// competency-coverage, roles-without-successor, comp-gap-alerts, dashboard-kpis) → requireOrgScope →
// hrbp 403. super_admin bypasses.
// (The critical_roles.target_band_level + nine_box_evaluations.updated_at columns that these reads / the
// nine-box reads select were missing from prod and have been migrated in — the harness surfaced that drift.)
```

to:

```typescript
// ── succession ──────────────────────────────────────────────────────────────────────────────
// UPDATE 2026-07-29: 8 of the original 9 registered succession reads had their TS procedures
// deleted (NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP confirmed live in prod) — only `critical-role`
// (getCriticalRole) survives below, since it's the one read with zero FE consumers, so its TS
// side was never a cutover candidate and stays live. RBAC: hr_admin succession:read@org, hrbp
// @unit — getCriticalRole uses assertScoped (an IDOR-safe by-id probe returning 404, not 403,
// for out-of-scope — see the endpoint's own comment).
```

- [ ] **Step 8: Fix the 2 hardcoded-shape assertions in `scripts/parity/surfaces.test.ts`**

Change:

```typescript
expect(SURFACES['succession'].flag).toBe('Platform__SuccessionReadEnabled');
expect(SURFACES['succession'].endpoints.map((e) => e.name)).toContain('comp-gap-alerts');
expect(SURFACES['succession'].endpoints).toHaveLength(9);
```

to:

```typescript
expect(SURFACES['succession'].flag).toBe('Platform__SuccessionReadEnabled');
expect(SURFACES['succession'].endpoints.map((e) => e.name)).toContain('critical-role');
expect(SURFACES['succession'].endpoints).toHaveLength(1);
```

Change (in the same file, the by-id count test):

```typescript
const expected: Record<string, string> = {
  'compensation/employee': 'employee',
  'ninebox/employee': 'employee',
  'ninebox/axis-breakdown': 'employee',
  'ninebox/calibration': 'calibration',
  'succession/critical-role': 'critical-role',
  'succession/suggested-successors': 'critical-role',
  'succession/simulate-exit': 'critical-role',
};
```

to:

```typescript
const expected: Record<string, string> = {
  'compensation/employee': 'employee',
  'ninebox/employee': 'employee',
  'ninebox/axis-breakdown': 'employee',
  'ninebox/calibration': 'calibration',
  'succession/critical-role': 'critical-role',
};
```

and change:

```typescript
expect(byIdCount).toBe(7);
```

to:

```typescript
expect(byIdCount).toBe(5);
```

(7 minus the 2 removed succession by-id endpoints — `suggested-successors` and `simulate-exit` — equals 5; `critical-role` is unaffected and stays counted.)

- [ ] **Step 9: Remove the now-false test in `tests/tier1/s1-succession-wiring.test.ts`**

Delete this entire `it` block:

```typescript
it('invalidates the affected queries', () => {
  expect(modal).toMatch(/utils\.succession\.listCriticalRoles\.invalidate/);
  expect(modal).toMatch(/utils\.succession\.getDashboardKpis\.invalidate/);
  expect(modal).toMatch(/utils\.succession\.getCompetencyCoverage\.invalidate/);
  expect(modal).toMatch(/utils\.succession\.getRolesWithoutSuccessor\.invalidate/);
  // Sprint 1.4 Task 1 -> Task 4 cross-feature handoff: adding a suggested
  // successor must live-refresh the comp-gap check and drop the candidate
  // from the suggestion list, not just wait for next reload.
  expect(modal).toMatch(/utils\.succession\.getCompGapAlerts\.invalidate/);
  expect(modal).toMatch(/utils\.succession\.getSuggestedSuccessors\.invalidate/);
});
```

(the other 4 `it` blocks in this file — `'calls the real mutation...'`, `'renders inside the shared Modal'`, `'host opens the modal...'`, `'no inline style or any'`, `'new i18n keys exist...'` — are unaffected by Step 4's invalidate-call removal and stay untouched.)

- [ ] **Step 10: Fix 2 hardcoded-shape assertions in `tests/access/scope-wiring-talent.test.ts`**

Delete this `it` block entirely — the behavior it tests (`listCriticalRoles` composing a `criticalRole` scope fragment via `scopeWhereFor`) no longer exists in the router (the only remaining critical-role-scoped procedure, `getCriticalRole`, uses `assertScoped`, not `scopeWhereFor`):

```typescript
it('composes the criticalRole fragment', () => {
  expect(src()).toMatch(/scopeWhereFor\('criticalRole'/);
});
```

Change (the `successorScope` count, which drops from 3 occurrences — `listCriticalRoles`, `getCriticalRole`, `simulateExit` — to 1, since only `getCriticalRole` survives):

```typescript
it('succession nested successors carry the successor fragment (3 includes)', () => {
  const src = readFileSync(join(ROOT, 'packages/api/src/routers/succession.ts'), 'utf8');
  expect((src.match(/where:\s*successorScope/g) ?? []).length).toBeGreaterThanOrEqual(3);
});
```

to:

```typescript
it('succession nested successors carry the successor fragment', () => {
  const src = readFileSync(join(ROOT, 'packages/api/src/routers/succession.ts'), 'utf8');
  expect((src.match(/where:\s*successorScope/g) ?? []).length).toBeGreaterThanOrEqual(1);
});
```

(The `'successor mutations are scope-probed'`, `'org-governance / rollup endpoints gated via requireOrgScope'`, the "no fragment spread" loop, and the other `describe` blocks in this file are unaffected — all reference patterns that survive in `getCriticalRole`/`addCriticalRole`/`removeSuccessor`/`updateSuccessorReadiness`.)

- [ ] **Step 11: Delete the 2 test files that exclusively test deleted procedures**

```bash
rm tests/succession/suggested-successors.test.ts
rm tests/succession/comp-gap.test.ts
```

(Both build a live tRPC caller against `successionRouter` and call `getSuggestedSuccessors`/`getCompGapAlerts`/`updateCriticalRoleBand` directly — all now-deleted. Do NOT touch `tests/succession/{comp-gap,competency-coverage,succession-kpis,suggested-successors,exit-simulation}-fixtures.test.ts` — all 5 import `@tims/shared`'s builder functions directly and never reference the router.)

- [ ] **Step 12: Update `scripts/deploy/cutover.sh`'s succession + succession-write case branches**

Change:

```bash
    succession)
      echo "read|SuccessionReadEnabled|verify|succession|NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4."
      ;;
```

to:

```bash
    succession)
      echo "read|SuccessionReadEnabled|verify|succession|NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase A #4. UPDATE 2026-07-29: flag confirmed live in prod; 8 of 9 registered read procedures (all but getCriticalRole, which has zero FE consumers) have ALSO had their TS side deleted — scripts/parity/surfaces.ts's 'succession' entry now registers only getCriticalRole's endpoint. --verify-only still runs a REAL (smaller) check, unlike reporting/evaluation360/team-intel/billing-usage's now-fully-no-op surfaces — do not treat this as TS_DELETED."
      ;;
```

Change:

```bash
    succession-write)
      echo "write|SuccessionWriteEnabled|verify-write|succession|NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP|FLIP_READY|Runbook §6 Phase B #9 — FLIP-READY: drop TS succession router, flip critical_roles/successors."
      ;;
```

to:

```bash
    succession-write)
      echo "write|SuccessionWriteEnabled|verify-write|succession|NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase B #9. UPDATE 2026-07-29: flag confirmed live in prod. 2 of 5 mutations (addSuccessor, updateCriticalRoleBand) have had their TS side deleted; the other 3 (addCriticalRole, removeSuccessor, updateSuccessorReadiness) have zero FE consumers and are untouched, unrelated dead code. scripts/parity/write-surfaces.ts's successionSurface tests the C# HTTP endpoints directly regardless of TS state — verify-write is fully unaffected either way."
      ;;
```

- [ ] **Step 13: Update `scripts/deploy/README-cutover.md`'s two table rows**

Change:

```
| `succession`          | read  | `SuccessionReadEnabled`     | `verify succession`          | `NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP`     | FLIP-READY  |
```

to:

```
| `succession`          | read  | `SuccessionReadEnabled`     | `verify succession`          | `NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP`     | CONFIRMED LIVE (partial TS deletion — 8/9 procedures, see cutover.sh) |
```

Change:

```
| `succession-write`    | write | `SuccessionWriteEnabled`    | `verify-write succession`    | `NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP`    | FLIP-READY  |
```

to:

```
| `succession-write`    | write | `SuccessionWriteEnabled`    | `verify-write succession`    | `NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP`    | CONFIRMED LIVE |
```

Do NOT touch the "Why not `reporting` for this walkthrough" prose block — succession's `--verify-only` stays a real, non-no-op check, so it does not join that paragraph's list of fully-no-op surfaces.

- [ ] **Step 14: Update `docs/REMAINING-WORK.md`'s deletion tally**

Read the file first to confirm the exact current wording (it currently reads "5 of the now-12" — wait, confirm the exact current number after the billing-usage task's edit before changing it) and update it to include succession, phrased as a _partial_ deletion (unlike reporting/evaluation360/team-intel/billing-usage's full deletions):

The sentence should end up describing: reporting and evaluation360 (2026-07-28, fully deleted), team-intel and billing-usage (2026-07-29, fully deleted), and succession (2026-07-29 or later, **partially** deleted — 8 of 9 read procedures + 2 of 5 write procedures; `getCriticalRole` and 3 zero-consumer write mutations remain untouched, unrelated dead code) — remove `succession` from the "remaining live surfaces" list, leaving `nine-box, compensation, engagement write`.

- [ ] **Step 15: Verify — type-check both packages**

Run:

```bash
cd packages/api && npx tsc --noEmit
```

Expected: PASS, no errors.

Run:

```bash
cd apps/web && npx tsc --noEmit
```

Expected: PASS, no errors (confirms `nine-box/page.tsx`'s `useSuccessionCriticalRoles` call site, `add-successor-modal.tsx`, `succession-pipeline.tsx`, and `request-adjustment-modal.tsx` all still type-check).

- [ ] **Step 16: Verify — full test suite**

Run from repo root:

```bash
npx vitest run
```

Expected: PASS. Get the exact before/after test counts (run once before starting this task's edits if you haven't already established a baseline, and once after) and show the arithmetic explicitly in your report: 2 tests removed from `s1-succession-wiring.test.ts`, 1 test removed + 2 tests adjusted (not removed) in `scope-wiring-talent.test.ts`, 2 whole assertions adjusted (not removed) in `surfaces.test.ts`, and however many tests existed in the 2 fully-deleted files (`suggested-successors.test.ts`, `comp-gap.test.ts`) — count them precisely rather than assuming a round number (a prior domain's implementer got this wrong and had to correct it in a review round).

- [ ] **Step 17: Commit**

```bash
git add packages/api/src/routers/succession.ts apps/web/lib/platform-api/succession.ts \
  apps/web/app/\(admin\)/talent/succession/add-successor-modal.tsx \
  apps/web/app/\(admin\)/talent/succession/succession-pipeline.tsx \
  apps/web/app/\(admin\)/talent/succession/request-adjustment-modal.tsx \
  scripts/parity/surfaces.ts scripts/parity/surfaces.test.ts \
  scripts/deploy/cutover.sh scripts/deploy/README-cutover.md docs/REMAINING-WORK.md \
  tests/tier1/s1-succession-wiring.test.ts tests/access/scope-wiring-talent.test.ts
git rm tests/succession/suggested-successors.test.ts tests/succession/comp-gap.test.ts
git commit -m "refactor(succession): delete dead TS reads/writes (8+2 of 14 procedures) + truth-up cutover tooling

NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP and NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP
have both been live in prod; these procedures and their FE fallback
were the only remaining tRPC consumers. Router stays alive for
getCriticalRole/addCriticalRole/removeSuccessor/updateSuccessorReadiness
(zero FE consumers, unrelated dead code). Unlike every prior domain,
the parity-harness surface is SHRUNK (not removed) since getCriticalRole
keeps a real, live parity check — status is CONFIRMED_LIVE, not
TS_DELETED.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 18: Hand Federico the `.env.example` patch + a missing-line note (do not apply directly — this repo denies AI edits to `.env.*` files)**

Tell Federico the following patch is ready to apply to `.env.example` (around the `NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP` line), changing:

```
# Per-surface flag: route ALL EIGHT FE-consumed succession reads (getDashboardKpis /
# listCriticalRoles / getCompetencyCoverage / getFlightRisk / getRolesWithoutSuccessor /
# getCompGapAlerts / getSuggestedSuccessors / simulateExit) to the C# service. Mirrors the
# backend `Platform:SuccessionReadEnabled` flag that gates all nine routes. Requires
# NEXT_PUBLIC_TIMS_PLATFORM_API_URL to also be set. Anything other than the exact string
# 'true' (including unset) keeps the tRPC path. Default off.
NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP=false
```

to:

```
# Per-surface flag: was route the eight FE-consumed succession reads to the C# service —
# NOW MOOT for those eight. The TS tRPC procedures have been deleted (2026-07-29); the C#
# read path is the sole implementation for them regardless of this flag's value.
# getCriticalRole (zero FE consumers) still has a live TS side and is unaffected either way.
NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP=true
```

Also tell Federico that `.env.example` has never had a `NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP` line at all (a pre-existing gap predating this task, confirmed via exhaustive search) — recommend adding one alongside the read-flag patch, e.g.:

```
# Per-surface flag: was route addSuccessor/updateCriticalRoleBand to the C# service — NOW
# MOOT. The TS tRPC procedures have been deleted (2026-07-29); the C# write path is the sole
# implementation regardless of this flag's value. addCriticalRole/removeSuccessor/
# updateSuccessorReadiness have zero FE consumers and are unaffected either way.
NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP=true
```

## Self-Review

**Spec coverage:** Router deletion (Steps 1-2), full wrapper rewrite (Step 3), FE dead-invalidate cleanup across 3 files (Steps 4-6), parity-harness shrink + its own test file (Steps 7-8), 2 test-file fixes + 2 test-file deletions (Steps 9-11), cutover.sh + README-cutover.md + REMAINING-WORK.md truth-up with the CONFIRMED_LIVE-not-TS_DELETED judgment call explicitly justified (Steps 12-14), full verification (Steps 15-16), commit (Step 17), `.env.example` + missing-write-flag hand-off (Step 18) — every constraint at the top has a corresponding step.

**Placeholder scan:** No TBD/TODO/"add appropriate X" language — every step shows exact before/after code. Step 14 asks to "read the file first to confirm exact current wording" since the plan itself notes the number may have shifted since this plan was written — an explicit instruction, not a placeholder.

**Type consistency:** All 10 hook names, their parameter shapes, and their `queryKey`s are unchanged from the original wrapper. `SuccessionKpiView`/`CoverageRow`/`SuggestedSuccessor`/`CompGapAlert`/`ExitRiskLevel` are reused directly from `@tims/shared` (verified field-for-field against `packages/shared/src/succession.ts`) rather than re-declared, avoiding drift; `CriticalRoleListItem`/`FlightRiskItem`/`RoleWithoutSuccessorItem`/`SimulateExitOutput`/`AddSuccessorOutput`/`UpdateCriticalRoleBandOutput`/`SuccessorItem` are hand-declared since no shared-kernel equivalent exists for these (they're raw Prisma-shaped reads/writes, not pure-function outputs) — each field checked against the router's actual Prisma query shape.
