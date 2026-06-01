import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const pipelineMovementsRouter = router({
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
});
