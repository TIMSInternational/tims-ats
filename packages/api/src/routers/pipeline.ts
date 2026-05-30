import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

const checklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  completed: z.boolean().default(false),
  completedBy: z.string().uuid().optional(),
  completedAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const pipelineRouter = router({
  // 5.1 — Get the Kanban board for a vacancy (stages + applications)
  getBoard: permissionProcedure('pipeline', 'read')
    .input(z.object({
      vacancyId: z.string().uuid(),
      status: z.enum(['active', 'rejected', 'all']).default('active'),
    }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      const applicationWhere: any = {
        vacancyId: input.vacancyId,
        organizationId: ctx.user.organizationId,
      };
      if (input.status !== 'all') {
        applicationWhere.status = input.status;
      }

      const stages = await db.pipelineStage.findMany({
        where: { vacancyId: input.vacancyId, organizationId: ctx.user.organizationId },
        orderBy: { order: 'asc' },
        include: {
          applications: {
            where: applicationWhere,
            orderBy: { appliedAt: 'desc' },
            include: {
              candidate: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  avatar: true,
                  currentTitle: true,
                  currentCompany: true,
                },
              },
            },
          },
        },
      });

      return {
        vacancyId: input.vacancyId,
        stages: stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          order: stage.order,
          slaHours: stage.slaHours,
          checklist: stage.checklist,
          isDefault: stage.isDefault,
          applications: stage.applications,
          count: stage.applications.length,
        })),
      };
    }),

  // 5.2 — List stages for a vacancy
  listStages: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.pipelineStage.findMany({
        where: { vacancyId: input.vacancyId, organizationId: ctx.user.organizationId },
        orderBy: { order: 'asc' },
        include: {
          _count: { select: { applications: true } },
        },
      });
    }),

  // 5.3 — Create a pipeline stage
  createStage: permissionProcedure('pipeline', 'create')
    .input(z.object({
      vacancyId: z.string().uuid(),
      name: z.string().min(1).max(100),
      order: z.number().int().min(0),
      slaHours: z.number().int().min(0).optional(),
      checklist: z.array(checklistItemSchema).optional(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.pipelineStage.create({
        data: {
          organizationId: ctx.user.organizationId,
          vacancyId: input.vacancyId,
          name: input.name,
          order: input.order,
          slaHours: input.slaHours,
          checklist: input.checklist as any ?? undefined,
          isDefault: input.isDefault,
        },
      });
    }),

  // 5.4 — Update a pipeline stage
  updateStage: permissionProcedure('pipeline', 'update')
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      order: z.number().int().min(0).optional(),
      slaHours: z.number().int().min(0).nullish(),
      checklist: z.array(checklistItemSchema).nullish(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });
      if (!stage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
      }

      const { id, ...data } = input;

      return db.pipelineStage.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.order !== undefined && { order: data.order }),
          ...(data.slaHours !== undefined && { slaHours: data.slaHours }),
          ...(data.checklist !== undefined && { checklist: data.checklist as any }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        },
      });
    }),

  // 5.5 — Delete a pipeline stage
  deleteStage: permissionProcedure('pipeline', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: { _count: { select: { applications: true } } },
      });
      if (!stage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
      }
      if (stage._count.applications > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No se puede eliminar una etapa con candidatos. Muevelos primero.',
        });
      }

      await db.pipelineStage.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // 5.6 — Move a candidate (application) to a different stage
  moveCandidate: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationId: z.string().uuid(),
      toStageId: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const application = await db.application.findFirst({
        where: { id: input.applicationId, organizationId: ctx.user.organizationId },
      });
      if (!application) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });
      }

      // Verify target stage belongs to same vacancy
      const targetStage = await db.pipelineStage.findFirst({
        where: { id: input.toStageId, vacancyId: application.vacancyId },
      });
      if (!targetStage) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'La etapa destino no pertenece a esta vacante' });
      }

      return db.$transaction(async (tx) => {
        // Record the movement
        await tx.stageMovement.create({
          data: {
            organizationId: ctx.user.organizationId,
            applicationId: input.applicationId,
            fromStageId: application.currentStageId,
            toStageId: input.toStageId,
            movedBy: ctx.user.id,
            reason: input.reason,
          },
        });

        // Update application's current stage
        return tx.application.update({
          where: { id: input.applicationId },
          data: { currentStageId: input.toStageId },
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            },
            currentStage: true,
          },
        });
      });
    }),

  // 5.7 — Bulk move candidates to a stage
  bulkMove: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationIds: z.array(z.string().uuid()).min(1).max(50),
      toStageId: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const applications = await db.application.findMany({
        where: {
          id: { in: input.applicationIds },
          organizationId: ctx.user.organizationId,
        },
      });
      if (applications.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicaciones no encontradas' });
      }

      // Verify all belong to same vacancy and target stage is valid
      const vacancyIds = [...new Set(applications.map((a) => a.vacancyId))];
      if (vacancyIds.length > 1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Todas las aplicaciones deben pertenecer a la misma vacante' });
      }

      const targetStage = await db.pipelineStage.findFirst({
        where: { id: input.toStageId, vacancyId: vacancyIds[0] },
      });
      if (!targetStage) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'La etapa destino no pertenece a esta vacante' });
      }

      return db.$transaction(async (tx) => {
        // Record movements
        await tx.stageMovement.createMany({
          data: applications.map((app) => ({
            organizationId: ctx.user.organizationId,
            applicationId: app.id,
            fromStageId: app.currentStageId,
            toStageId: input.toStageId,
            movedBy: ctx.user.id,
            reason: input.reason,
          })),
        });

        // Update all applications
        await tx.application.updateMany({
          where: { id: { in: input.applicationIds } },
          data: { currentStageId: input.toStageId },
        });

        return { moved: applications.length };
      });
    }),

  // 5.8 — Reject a candidate's application
  rejectCandidate: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationId: z.string().uuid(),
      reason: z.string().min(1),
      feedback: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const application = await db.application.findFirst({
        where: {
          id: input.applicationId,
          organizationId: ctx.user.organizationId,
          status: 'active',
        },
      });
      if (!application) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada o ya fue rechazada' });
      }

      return db.application.update({
        where: { id: input.applicationId },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectedReason: input.reason,
          feedback: input.feedback,
        },
        include: {
          candidate: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });
    }),

  // 5.9 — Get movement history for an application
  getMovementHistory: permissionProcedure('pipeline', 'read')
    .input(z.object({
      applicationId: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const application = await db.application.findFirst({
        where: { id: input.applicationId, organizationId: ctx.user.organizationId },
      });
      if (!application) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });
      }

      return db.stageMovement.findMany({
        where: { applicationId: input.applicationId },
        orderBy: { movedAt: 'asc' },
        include: {
          fromStage: { select: { id: true, name: true, order: true } },
          toStage: { select: { id: true, name: true, order: true } },
          actor: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });
    }),

  // 5.10 — Get checklist for a stage
  getStageChecklist: permissionProcedure('pipeline', 'read')
    .input(z.object({ stageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.stageId, organizationId: ctx.user.organizationId },
      });
      if (!stage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
      }

      return {
        stageId: stage.id,
        stageName: stage.name,
        checklist: (stage.checklist as any[]) ?? [],
      };
    }),

  // 5.11 — Update checklist for a stage
  updateChecklist: permissionProcedure('pipeline', 'update')
    .input(z.object({
      stageId: z.string().uuid(),
      checklist: z.array(checklistItemSchema),
    }))
    .mutation(async ({ ctx, input }) => {
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.stageId, organizationId: ctx.user.organizationId },
      });
      if (!stage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
      }

      return db.pipelineStage.update({
        where: { id: input.stageId },
        data: { checklist: input.checklist as any },
      });
    }),

  // 5.12 — Get SLA status for applications in a vacancy
  getSlaStatus: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      const stages = await db.pipelineStage.findMany({
        where: { vacancyId: input.vacancyId },
        orderBy: { order: 'asc' },
      });

      const applications = await db.application.findMany({
        where: { vacancyId: input.vacancyId, status: 'active' },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true } },
          movements: { orderBy: { movedAt: 'desc' }, take: 1 },
        },
      });

      const now = new Date();

      const slaItems = applications.map((app) => {
        const stage = stages.find((s) => s.id === app.currentStageId);
        const lastMovement = app.movements[0];
        const enteredStageAt = lastMovement?.movedAt ?? app.appliedAt;
        const hoursInStage = Math.floor((now.getTime() - enteredStageAt.getTime()) / (1000 * 60 * 60));
        const slaHours = stage?.slaHours;
        const isOverdue = slaHours != null && hoursInStage > slaHours;

        return {
          applicationId: app.id,
          candidateId: app.candidate.id,
          candidateName: `${app.candidate.firstName} ${app.candidate.lastName}`,
          stageId: app.currentStageId,
          stageName: stage?.name ?? 'Desconocida',
          enteredStageAt,
          hoursInStage,
          slaHours,
          isOverdue,
        };
      });

      return {
        vacancyId: input.vacancyId,
        totalActive: slaItems.length,
        overdueCount: slaItems.filter((s) => s.isOverdue).length,
        items: slaItems,
      };
    }),

  // 5.13 — Get next best action for a candidate (AI stub)
  getNextBestAction: permissionProcedure('pipeline', 'read')
    .input(z.object({ applicationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const application = await db.application.findFirst({
        where: { id: input.applicationId, organizationId: ctx.user.organizationId },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true } },
          currentStage: { select: { id: true, name: true, order: true } },
        },
      });
      if (!application) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });
      }

      // Stub — will be replaced with AWS Bedrock call
      return {
        applicationId: input.applicationId,
        candidateName: `${application.candidate.firstName} ${application.candidate.lastName}`,
        currentStage: application.currentStage.name,
        recommendation: 'Programar entrevista tecnica',
        confidence: 0.82,
        reasoning: 'El candidato ha completado la revision inicial y cumple con los requisitos minimos. El siguiente paso recomendado es una entrevista tecnica.',
        suggestedActions: [
          { action: 'schedule_interview', label: 'Programar entrevista', priority: 'high' },
          { action: 'request_assessment', label: 'Solicitar evaluacion', priority: 'medium' },
          { action: 'move_to_next_stage', label: 'Avanzar a siguiente etapa', priority: 'medium' },
        ],
        model: 'stub',
      };
    }),

  // 5.14 — Get funnel analytics for a vacancy
  getFunnel: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      const stages = await db.pipelineStage.findMany({
        where: { vacancyId: input.vacancyId },
        orderBy: { order: 'asc' },
      });

      // Count applications that have ever been in each stage (via movements)
      const stageStats = await Promise.all(
        stages.map(async (stage) => {
          const [currentCount, everReachedCount] = await Promise.all([
            // Currently in this stage
            db.application.count({
              where: { vacancyId: input.vacancyId, currentStageId: stage.id, status: 'active' },
            }),
            // Ever moved into this stage (or currently here)
            db.stageMovement.count({
              where: { toStageId: stage.id, application: { vacancyId: input.vacancyId } },
            }),
          ]);

          return {
            stageId: stage.id,
            stageName: stage.name,
            order: stage.order,
            currentCount,
            everReachedCount,
          };
        }),
      );

      const totalApplications = await db.application.count({
        where: { vacancyId: input.vacancyId },
      });
      const rejectedCount = await db.application.count({
        where: { vacancyId: input.vacancyId, status: 'rejected' },
      });

      // Calculate conversion rates between adjacent stages
      const funnel = stageStats.map((stage, idx) => {
        const prevCount = idx === 0 ? totalApplications : stageStats[idx - 1].everReachedCount;
        const conversionRate = prevCount > 0 ? Math.round((stage.everReachedCount / prevCount) * 100) : 0;

        return {
          ...stage,
          conversionRate,
        };
      });

      return {
        vacancyId: input.vacancyId,
        totalApplications,
        rejectedCount,
        funnel,
      };
    }),
});
