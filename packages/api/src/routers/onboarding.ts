import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

// Verify every referenced user id belongs to the caller's org (prevents attaching
// onboarding records to another tenant's users / leaking their names via includes).
async function assertUsersInOrg(orgId: string, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const count = await db.user.count({ where: { id: { in: ids }, organizationId: orgId } });
  if (count !== ids.length) {
    throw new Error('Usuario referenciado no encontrado en esta organizacion');
  }
}

export const onboardingRouter = router({
  // 10.1 — List onboarding plans for the organization
  list: permissionProcedure('onboarding', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        status: z.enum(['active', 'completed', 'cancelled']).optional(),
        phase: z.string().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, status, phase, search } = input;

      const where = {
        organizationId: ctx.user.organizationId,
        ...(status ? { status } : {}),
        ...(phase ? { phase } : {}),
        ...(search
          ? {
              user: {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' as const } },
                  { lastName: { contains: search, mode: 'insensitive' as const } },
                ],
              },
            }
          : {}),
      };

      const plans = await db.onboardingPlan.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true } },
          buddy: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          tasks: { select: { id: true, completed: true, responsible: true, phase: true } },
          checkIns: { select: { id: true, status: true, type: true, scheduledDate: true, completedAt: true } },
        },
      });

      let nextCursor: string | undefined;
      if (plans.length > limit) {
        const nextItem = plans.pop();
        nextCursor = nextItem?.id;
      }

      return { plans, nextCursor };
    }),

  // 10.2 — Get onboarding plan by ID
  getById: permissionProcedure('onboarding', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const plan = await db.onboardingPlan.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.user.organizationId,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
          buddy: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          tasks: {
            orderBy: { order: 'asc' },
            include: {
              completedBy: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          checkIns: {
            orderBy: { scheduledDate: 'asc' },
            include: {
              completedBy: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });

      if (!plan) {
        throw new Error('Plan de onboarding no encontrado');
      }

      return plan;
    }),

  // 10.3 — Create onboarding plan
  create: permissionProcedure('onboarding', 'create')
    .input(
      z.object({
        userId: z.string().uuid(),
        buddyId: z.string().uuid().optional(),
        startDate: z.coerce.date(),
        phase: z.string().default('day1_30'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify referenced users belong to the caller's org (no cross-tenant refs)
      await assertUsersInOrg(ctx.user.organizationId, [input.userId, input.buddyId]);

      return db.onboardingPlan.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          buddy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    }),

  // 10.4 — Update onboarding plan (phase, status, buddy, risk)
  updatePlan: permissionProcedure('onboarding', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        phase: z.string().optional(),
        status: z.enum(['active', 'completed', 'cancelled']).optional(),
        buddyId: z.string().uuid().nullish(),
        riskScore: z.number().min(0).max(100).optional(),
        completedAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Verify the plan belongs to the caller's org (IDOR prevention)
      const plan = await db.onboardingPlan.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!plan) throw new Error('Plan de onboarding no encontrado');
      if (data.buddyId) await assertUsersInOrg(ctx.user.organizationId, [data.buddyId]);

      return db.onboardingPlan.update({
        where: { id },
        data: {
          ...data,
          ...(data.status === 'completed' && !data.completedAt
            ? { completedAt: new Date() }
            : {}),
        },
      });
    }),

  // 10.5 — List tasks for a plan
  listTasks: permissionProcedure('onboarding', 'read')
    .input(
      z.object({
        planId: z.string().uuid(),
        phase: z.string().optional(),
        completed: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return db.onboardingTask.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          planId: input.planId,
          ...(input.phase ? { phase: input.phase } : {}),
          ...(input.completed !== undefined ? { completed: input.completed } : {}),
        },
        orderBy: { order: 'asc' },
        include: {
          completedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    }),

  // 10.6 — Create task
  createTask: permissionProcedure('onboarding', 'create')
    .input(
      z.object({
        planId: z.string().uuid(),
        title: z.string().min(1).max(500),
        description: z.string().optional(),
        responsible: z.string(),
        phase: z.string(),
        dueDate: z.coerce.date().optional(),
        order: z.number().int().default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the parent plan belongs to the caller's org (IDOR prevention)
      const plan = await db.onboardingPlan.findFirst({
        where: { id: input.planId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!plan) throw new Error('Plan de onboarding no encontrado');

      return db.onboardingTask.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // 10.7 — Update task (toggle complete, edit fields)
  updateTask: permissionProcedure('onboarding', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional(),
        responsible: z.string().optional(),
        phase: z.string().optional(),
        dueDate: z.coerce.date().nullish(),
        completed: z.boolean().optional(),
        order: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, completed, ...rest } = input;

      // Verify the task belongs to the caller's org (IDOR prevention)
      const task = await db.onboardingTask.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!task) throw new Error('Tarea de onboarding no encontrada');

      return db.onboardingTask.update({
        where: { id },
        data: {
          ...rest,
          ...(completed !== undefined
            ? {
                completed,
                completedAt: completed ? new Date() : null,
                completedById: completed ? ctx.user.id : null,
              }
            : {}),
        },
      });
    }),

  // 10.8 — Get tasks by responsible party
  getTasksByResponsible: permissionProcedure('onboarding', 'read')
    .input(
      z.object({
        responsible: z.string(),
        completed: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return db.onboardingTask.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          responsible: input.responsible,
          ...(input.completed !== undefined ? { completed: input.completed } : {}),
        },
        orderBy: { dueDate: 'asc' },
        include: {
          plan: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
          },
        },
      });
    }),

  // 10.9 — List documents for a plan (stub — no OnboardingDocument model yet)
  listDocuments: permissionProcedure('onboarding', 'read')
    .input(z.object({ planId: z.string().uuid() }))
    .query(async () => {
      // TODO: implement when OnboardingDocument model is added to the schema
      return [];
    }),

  // 10.10 — Request a document from the new hire (stub)
  requestDocument: permissionProcedure('onboarding', 'create')
    .input(
      z.object({
        planId: z.string().uuid(),
        name: z.string(),
        description: z.string().optional(),
        dueDate: z.coerce.date().optional(),
      })
    )
    .mutation(async () => {
      // TODO: implement when OnboardingDocument model is added to the schema
      return { success: true, message: 'Documento solicitado (pendiente de implementacion)' };
    }),

  // 10.11 — Get check-ins for a plan
  getCheckIns: permissionProcedure('onboarding', 'read')
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.onboardingCheckIn.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          planId: input.planId,
        },
        orderBy: { scheduledDate: 'asc' },
        include: {
          completedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    }),

  // 10.12 — Complete a check-in
  completeCheckIn: permissionProcedure('onboarding', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        notes: z.string().optional(),
        score: z.number().int().min(1).max(10).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Verify the check-in belongs to the caller's org (IDOR prevention)
      const checkIn = await db.onboardingCheckIn.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!checkIn) throw new Error('Check-in de onboarding no encontrado');

      return db.onboardingCheckIn.update({
        where: { id },
        data: {
          ...data,
          status: 'completed',
          completedAt: new Date(),
          completedById: ctx.user.id,
        },
      });
    }),

  // 10.13 — Get risk score for a plan
  getRiskScore: permissionProcedure('onboarding', 'read')
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const plan = await db.onboardingPlan.findFirst({
        where: {
          id: input.planId,
          organizationId: ctx.user.organizationId,
        },
        select: { riskScore: true, phase: true, status: true },
      });

      if (!plan) {
        throw new Error('Plan de onboarding no encontrado');
      }

      // Compute a dynamic risk based on overdue tasks
      const overdueTasks = await db.onboardingTask.count({
        where: {
          planId: input.planId,
          organizationId: ctx.user.organizationId,
          completed: false,
          dueDate: { lt: new Date() },
        },
      });

      const totalTasks = await db.onboardingTask.count({
        where: {
          planId: input.planId,
          organizationId: ctx.user.organizationId,
        },
      });

      const pendingCheckIns = await db.onboardingCheckIn.count({
        where: {
          planId: input.planId,
          organizationId: ctx.user.organizationId,
          status: 'pending',
          scheduledDate: { lt: new Date() },
        },
      });

      const calculatedRisk = totalTasks > 0
        ? Math.min(100, Math.round(((overdueTasks * 2 + pendingCheckIns) / (totalTasks + 1)) * 100))
        : plan.riskScore ?? 0;

      return {
        planId: input.planId,
        riskScore: plan.riskScore ?? calculatedRisk,
        calculatedRisk,
        overdueTasks,
        pendingCheckIns,
        phase: plan.phase,
        status: plan.status,
      };
    }),

  // 10.14 — Get personalized learning route (stub — future AI integration)
  getLearningRoute: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .query(async () => {
      // TODO: integrate with AI / learning module
      return {
        modules: [],
        message: 'La ruta de aprendizaje personalizada estara disponible proximamente',
      };
    }),

  // 10.15 — Dashboard KPIs
  getDashboardKpis: permissionProcedure('onboarding', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [activePlans, completedPlans, totalTasks, completedTasks, pendingCheckIns] =
      await Promise.all([
        db.onboardingPlan.count({
          where: { organizationId: orgId, status: 'active' },
        }),
        db.onboardingPlan.count({
          where: { organizationId: orgId, status: 'completed' },
        }),
        db.onboardingTask.count({
          where: { organizationId: orgId },
        }),
        db.onboardingTask.count({
          where: { organizationId: orgId, completed: true },
        }),
        db.onboardingCheckIn.count({
          where: {
            organizationId: orgId,
            status: 'pending',
            scheduledDate: { lt: new Date() },
          },
        }),
      ]);

    const avgRisk = await db.onboardingPlan.aggregate({
      where: { organizationId: orgId, status: 'active', riskScore: { not: null } },
      _avg: { riskScore: true },
    });

    return {
      activePlans,
      completedPlans,
      totalTasks,
      completedTasks,
      taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      overdueCheckIns: pendingCheckIns,
      averageRiskScore: avgRisk._avg.riskScore ?? 0,
    };
  }),
});
