import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';

export const nineboxRouter = router({
  // ── Grid ─────────────────────────────────────────────────────────────

  getGrid: permissionProcedure('ninebox', 'read')
    .input(
      z.object({
        period: z.string(),
        companyId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build user filter based on scope
      let userFilter: Record<string, unknown> = {};
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

      const evaluations = await db.nineBoxEvaluation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          period: input.period,
          ...userFilter,
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

      // Map quadrant names to grid keys (potential-performance)
      const quadrantToGrid: Record<string, string> = {
        star: '3-3',
        high_potential: '3-2',
        enigma: '3-1',
        solid_performer: '2-3',
        consistent_performer: '2-3',
        core_player: '2-2',
        inconsistent: '2-1',
        workhouse: '1-3',
        underperformer: '1-2',
        risk: '1-1',
      };

      const grid: Record<string, typeof evaluations> = {};
      for (const evaluation of evaluations) {
        const key = quadrantToGrid[evaluation.quadrant] ?? evaluation.quadrant;
        if (!grid[key]) {
          grid[key] = [];
        }
        grid[key].push(evaluation);
      }

      return { period: input.period, grid, totalEvaluations: evaluations.length };
    }),

  getEmployeeDetail: permissionProcedure('ninebox', 'read')
    .input(
      z.object({
        userId: z.string().uuid(),
        period: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
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
    .input(
      z.object({
        userId: z.string().uuid(),
        period: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
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
    .input(
      z.object({
        userId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const evaluations = await db.nineBoxEvaluation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input.userId && { userId: input.userId }),
          ...(input.companyId && { user: { companyId: input.companyId } }),
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ userId: 'asc' }, { evaluatedAt: 'asc' }],
      });

      // Group by user and compute movements
      const movements: Array<{
        userId: string;
        userName: string;
        from: { period: string; quadrant: string };
        to: { period: string; quadrant: string };
      }> = [];

      const byUser = new Map<string, typeof evaluations>();
      for (const ev of evaluations) {
        const list = byUser.get(ev.userId) ?? [];
        list.push(ev);
        byUser.set(ev.userId, list);
      }

      for (const [, userEvals] of byUser) {
        for (let i = 1; i < userEvals.length; i++) {
          const prev = userEvals[i - 1];
          const curr = userEvals[i];
          if (prev.quadrant !== curr.quadrant) {
            movements.push({
              userId: curr.userId,
              userName: `${curr.user.firstName} ${curr.user.lastName}`,
              from: { period: prev.period, quadrant: prev.quadrant },
              to: { period: curr.period, quadrant: curr.quadrant },
            });
          }
        }
      }

      return { movements, totalMovements: movements.length };
    }),

  // Stub: simulate placement changes
  simulate: permissionProcedure('ninebox', 'read')
    .input(
      z.object({
        userId: z.string().uuid(),
        newPotentialScore: z.number().min(0).max(100),
        newPerformanceScore: z.number().min(0).max(100),
      }),
    )
    .query(async ({ input }) => {
      // TODO: integrate with scoring engine
      const potentialBand =
        input.newPotentialScore >= 67 ? 'high' : input.newPotentialScore >= 34 ? 'medium' : 'low';
      const performanceBand =
        input.newPerformanceScore >= 67
          ? 'high'
          : input.newPerformanceScore >= 34
            ? 'medium'
            : 'low';

      const quadrantMap: Record<string, Record<string, string>> = {
        high: { high: 'star', medium: 'high_potential', low: 'enigma' },
        medium: { high: 'solid_performer', medium: 'core_player', low: 'inconsistent' },
        low: { high: 'workhouse', medium: 'underperformer', low: 'risk' },
      };

      return {
        userId: input.userId,
        simulatedQuadrant: quadrantMap[potentialBand][performanceBand],
        potentialBand,
        performanceBand,
        _stub: true,
      };
    }),

  // ── Calibration ──────────────────────────────────────────────────────

  createCalibration: permissionProcedure('ninebox', 'create')
    .input(
      z.object({
        period: z.string(),
        scheduledAt: z.string().datetime().optional(),
        memberIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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

  getCalibration: permissionProcedure('ninebox', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
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

  submitCalibrationVote: permissionProcedure('ninebox', 'update')
    .input(
      z.object({
        sessionId: z.string().uuid(),
        evaluatedUserId: z.string().uuid(),
        quadrant: z.string(),
        justification: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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

  finalizeCalibration: permissionProcedure('ninebox', 'update')
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
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
    .input(z.object({ quadrant: z.string() }))
    .query(async ({ input }) => {
      // Standard development plans per quadrant
      const plans: Record<string, { title: string; actions: string[] }> = {
        star: {
          title: 'Retener y Acelerar',
          actions: [
            'Asignar proyectos de alta visibilidad',
            'Incluir en plan de sucesion',
            'Ofrecer mentoria ejecutiva',
          ],
        },
        high_potential: {
          title: 'Desarrollar Rendimiento',
          actions: [
            'Establecer metas desafiantes',
            'Asignar coaching de desempeno',
            'Rotacion de roles',
          ],
        },
        enigma: {
          title: 'Evaluar y Orientar',
          actions: [
            'Asignar mentor',
            'Revisar encaje de rol',
            'Establecer metas a corto plazo',
          ],
        },
        solid_performer: {
          title: 'Reconocer y Desarrollar',
          actions: [
            'Reconocimiento publico',
            'Plan de capacitacion en liderazgo',
            'Proyectos cross-funcionales',
          ],
        },
        core_player: {
          title: 'Motivar y Crecer',
          actions: [
            'Feedback regular',
            'Capacitacion tecnica',
            'Metas de estiramiento',
          ],
        },
        inconsistent: {
          title: 'Diagnosticar y Apoyar',
          actions: [
            'Identificar barreras',
            'Plan de mejora con seguimiento',
            'Evaluar motivacion',
          ],
        },
        workhouse: {
          title: 'Valorar Consistencia',
          actions: [
            'Reconocer contribuciones',
            'Evaluar interes en crecimiento',
            'Capacitacion selectiva',
          ],
        },
        underperformer: {
          title: 'Plan de Mejora',
          actions: [
            'Plan de mejora formal (PIP)',
            'Coaching intensivo',
            'Revision en 90 dias',
          ],
        },
        risk: {
          title: 'Accion Inmediata',
          actions: [
            'Conversacion de retroalimentacion directa',
            'PIP con plazos estrictos',
            'Evaluar reubicacion o salida',
          ],
        },
      };

      return plans[input.quadrant] ?? { title: 'Sin plan definido', actions: [] };
    }),

  getBenchStrength: permissionProcedure('ninebox', 'read')
    .input(z.object({ period: z.string() }))
    .query(async ({ ctx, input }) => {
      const evaluations = await db.nineBoxEvaluation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          period: input.period,
        },
        select: { quadrant: true },
      });

      const distribution: Record<string, number> = {};
      for (const ev of evaluations) {
        distribution[ev.quadrant] = (distribution[ev.quadrant] ?? 0) + 1;
      }

      const total = evaluations.length;
      const highPotentialCount =
        (distribution['star'] ?? 0) +
        (distribution['high_potential'] ?? 0) +
        (distribution['enigma'] ?? 0);

      return {
        period: input.period,
        total,
        distribution,
        highPotentialRatio: total > 0 ? Math.round((highPotentialCount / total) * 100) : 0,
        benchStrength: highPotentialCount,
      };
    }),

  // ── Dashboard KPIs ───────────────────────────────────────────────────

  getDashboardKpis: permissionProcedure('ninebox', 'read')
    .input(z.object({ period: z.string() }))
    .query(async ({ ctx, input }) => {
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

      const distribution: Record<string, number> = {};
      for (const ev of evaluations) {
        distribution[ev.quadrant] = (distribution[ev.quadrant] ?? 0) + 1;
      }

      return {
        period: input.period,
        totalEvaluations,
        calibrationSessions,
        activeCalibrations,
        distribution,
      };
    }),
});
