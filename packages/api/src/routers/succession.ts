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

export const successionRouter = router({
  // ── Critical Roles ───────────────────────────────────────────────────

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

  getCriticalRole: permissionProcedure('succession', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // By-id read → scope-probe the role (NOT_FOUND if out of the caller's grant).
      await assertScoped('criticalRole', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);
      const successorScope = await scopeWhereFor('successor', ctx.access, ctx.user.id);
      return db.criticalRole.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          currentHolder: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              jobTitle: true,
              email: true,
            },
          },
          successors: {
            where: successorScope as Prisma.SuccessorWhereInput,
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
              addedByUser: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    }),

  addCriticalRole: permissionProcedure('succession', 'create')
    .input(
      z.object({
        title: z.string().min(1).max(255),
        positionId: z.string().max(100).optional(),
        currentHolderId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        criticality: z.enum(['critical', 'high', 'medium', 'low']),
        flightRisk: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Defining an org-critical role is org governance, not a leader/hrbp
      // grant (matrix gives them read only) → org/company scope only.
      requireOrgScope(ctx.access);
      return db.criticalRole.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // ── Successors ───────────────────────────────────────────────────────

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

  removeSuccessor: permissionProcedure('succession', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('successor', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);
      return db.successor.delete({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });
    }),

  updateSuccessorReadiness: permissionProcedure('succession', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        readiness: z.enum(['ready_now', 'ready_1_year', 'ready_2_years', 'developing']),
        developmentPlan: z.string().max(20000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await assertScoped('successor', id, ctx.access, ctx.user.id, ctx.user.organizationId);
      return db.successor.update({
        where: { id, organizationId: ctx.user.organizationId },
        data,
      });
    }),

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
