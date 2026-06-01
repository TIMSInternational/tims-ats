import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const pipelineAnalyticsRouter = router({
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

      // Stub -- will be replaced with AWS Bedrock call
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
