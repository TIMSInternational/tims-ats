import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import {
  scopeWhereFor,
  assertScoped,
  assertSubjectInScope,
  requireOrgScope,
} from '../access';

export const successionRouter = router({
  // ── Critical Roles ───────────────────────────────────────────────────

  listCriticalRoles: permissionProcedure('succession', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        criticality: z.string().optional(),
        search: z.string().optional(),
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
        positionId: z.string().optional(),
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
        developmentPlan: z.string().optional(),
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
        developmentPlan: z.string().optional(),
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

  // ── Analytics ────────────────────────────────────────────────────────

  getFlightRisk: permissionProcedure('succession', 'read')
    .input(
      z.object({
        threshold: z.number().min(0).max(1).default(0.5),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      // Org-rollup risk register across all critical roles → interim org-gate.
      requireOrgScope(ctx.access);
      const threshold = input?.threshold ?? 0.5;
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

      const coverage = roles.map((role) => {
        const totalSuccessors = role.successors.length;
        const readyNow = role.successors.filter((s) => s.readiness === 'ready_now').length;
        const readySoon = role.successors.filter(
          (s) => s.readiness === 'ready_1_year' || s.readiness === 'ready_2_years',
        ).length;

        return {
          roleId: role.id,
          title: role.title,
          criticality: role.criticality,
          totalSuccessors,
          readyNow,
          readySoon,
          developing: totalSuccessors - readyNow - readySoon,
          coverageStatus:
            readyNow >= 1 ? 'covered' : totalSuccessors >= 1 ? 'partial' : 'uncovered',
        };
      });

      return coverage;
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

      const readyNow = role.successors.filter((s) => s.readiness === 'ready_now');
      const readySoon = role.successors.filter(
        (s) => s.readiness === 'ready_1_year' || s.readiness === 'ready_2_years',
      );

      let riskLevel: string;
      let recommendation: string;

      if (readyNow.length >= 1) {
        riskLevel = 'low';
        recommendation = `Sucesor listo: ${readyNow[0].user.firstName} ${readyNow[0].user.lastName}`;
      } else if (readySoon.length >= 1) {
        riskLevel = 'medium';
        recommendation = `Sucesor disponible en 1-2 anos. Considerar plan de aceleracion.`;
      } else {
        riskLevel = 'high';
        recommendation = `Sin sucesores identificados. Iniciar busqueda inmediata.`;
      }

      return {
        role: { id: role.id, title: role.title, criticality: role.criticality },
        currentHolder: role.currentHolder,
        riskLevel,
        recommendation,
        successors: role.successors,
        readyNowCount: readyNow.length,
        pipelineCount: role.successors.length,
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

      const readyNow = await db.successor.count({
        where: { organizationId: orgId, readiness: 'ready_now' },
      });

      return {
        totalCriticalRoles: totalRoles,
        totalSuccessors,
        rolesWithoutSuccessor,
        coverageRate:
          totalRoles > 0
            ? Math.round(((totalRoles - rolesWithoutSuccessor) / totalRoles) * 100)
            : 0,
        readyNowCount: readyNow,
        highFlightRiskRoles: highFlightRisk,
        avgSuccessorsPerRole:
          totalRoles > 0 ? Math.round((totalSuccessors / totalRoles) * 10) / 10 : 0,
      };
    }),
});
