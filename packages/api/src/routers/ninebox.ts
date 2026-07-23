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

export const nineboxRouter = router({
  // ── Grid ─────────────────────────────────────────────────────────────

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

  getAxisBreakdown: permissionProcedure('ninebox', 'read')
    .input(getAxisBreakdownInput)
    .query(async ({ ctx, input }) => {
      // Point-read keyed on a target userId → subject-scope it.
      await assertSubjectInScope(
        ctx.access,
        ctx.user.id,
        input.userId,
        'No puedes ver esta evaluacion',
      );

      const evaluation = await db.nineBoxEvaluation.findFirstOrThrow({
        where: {
          organizationId: ctx.user.organizationId,
          userId: input.userId,
          period: input.period,
        },
      });

      return {
        userId: input.userId,
        period: input.period,
        potentialScore: evaluation.potentialScore,
        performanceScore: evaluation.performanceScore,
        quadrant: evaluation.quadrant,
        confidence: evaluation.confidence,
        axisBreakdown: evaluation.axisBreakdown,
      };
    }),

  getMovementHistory: permissionProcedure('ninebox', 'read')
    .input(getMovementHistoryInput)
    .query(async ({ ctx, input }) => {
      // Row-level read → compose the evaluation scope fragment; the input
      // userId/companyId filters only intersect within the caller's grant.
      const scopeWhere = (await scopeWhereFor('nineBoxEvaluation', ctx.access, ctx.user.id)) as Prisma.NineBoxEvaluationWhereInput;

      const evaluations = await db.nineBoxEvaluation.findMany({
        where: {
          AND: [
            {
              organizationId: ctx.user.organizationId,
              ...(input.userId && { userId: input.userId }),
              ...(input.companyId && { user: { companyId: input.companyId } }),
            },
            scopeWhere,
          ],
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ userId: 'asc' }, { evaluatedAt: 'asc' }],
      });

      // Pure kernel (@tims/shared) — per-user consecutive quadrant-change movements over the
      // pre-ordered (userId asc, evaluatedAt asc) rows, golden-fixtured both stacks.
      const movements = computeMovements(
        evaluations.map((ev) => ({
          userId: ev.userId,
          firstName: ev.user.firstName,
          lastName: ev.user.lastName,
          period: ev.period,
          quadrant: ev.quadrant,
        })),
      );

      return { movements, totalMovements: movements.length };
    }),

  // Stub: simulate placement changes
  simulate: permissionProcedure('ninebox', 'read')
    .input(simulateInput)
    .query(async ({ input }) => {
      // TODO: integrate with scoring engine. Pure kernel (@tims/shared) — golden-fixtured both stacks.
      return {
        userId: input.userId,
        ...simulateBands(input.newPotentialScore, input.newPerformanceScore),
        _stub: true,
      };
    }),

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

  submitCalibrationVote: permissionProcedure('ninebox', 'update')
    .input(submitCalibrationVoteInput)
    .mutation(async ({ ctx, input }) => {
      // Committee-membership rule (mirrors interview submitScorecard): a vote
      // may only be cast by a MEMBER of the calibration session's committee.
      // (a) the session must exist within the org (NOT_FOUND otherwise — does
      //     not confirm the id to outsiders).
      const session = await db.calibrationSession.findFirst({
        where: { id: input.sessionId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de calibracion no encontrada' });
      }
      // (b) the VOTER (ctx.user.id — never input; the upsert keys voterId off
      //     ctx so a non-member can't forge a row) must be a committee member.
      const membership = await db.calibrationMember.findFirst({
        where: { sessionId: input.sessionId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Solo un miembro del comite puede votar',
        });
      }
      // (c) the EVALUATED user must be a real member of this org (codex: an
      //     unvalidated FK let votes target arbitrary/cross-tenant user ids).
      //     Deliberately NOT subject-scoped: committee panels calibrate across
      //     teams — session MEMBERSHIP is the authority, not the voter's team.
      const evaluated = await db.user.findFirst({
        where: { id: input.evaluatedUserId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!evaluated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario evaluado no encontrado' });
      }

      return db.calibrationVote.upsert({
        where: {
          sessionId_evaluatedUserId_voterId: {
            sessionId: input.sessionId,
            evaluatedUserId: input.evaluatedUserId,
            voterId: ctx.user.id,
          },
        },
        create: {
          sessionId: input.sessionId,
          evaluatedUserId: input.evaluatedUserId,
          voterId: ctx.user.id,
          quadrant: input.quadrant,
          justification: input.justification,
        },
        update: {
          quadrant: input.quadrant,
          justification: input.justification,
        },
      });
    }),

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

  finalizeCalibration: permissionProcedure('ninebox', 'update')
    .input(finalizeCalibrationInput)
    .mutation(async ({ ctx, input }) => {
      // Finalizing a session is an org-governance lifecycle act, not a
      // committee-member grant → org/company scope only.
      requireOrgScope(ctx.access);

      return db.calibrationSession.update({
        where: {
          id: input.sessionId,
          organizationId: ctx.user.organizationId,
        },
        data: {
          status: 'finalized',
          completedAt: new Date(),
        },
      });
    }),

  // ── Plans & Analytics ────────────────────────────────────────────────

  getQuadrantPlan: permissionProcedure('ninebox', 'read')
    .input(getQuadrantPlanInput)
    .query(async ({ input }) => {
      return resolveQuadrantPlan(input.quadrant);
    }),

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
