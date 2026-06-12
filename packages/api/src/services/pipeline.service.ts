import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { pipelineRepository } from '../repositories/pipeline.repository';

// ---------------------------------------------------------------------------
// Pipeline Service — business logic, no db imports
// ---------------------------------------------------------------------------

export const pipelineService = {
  // Board
  async getBoard(orgId: string, vacancyId: string, status: string) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });

    const stages = await pipelineRepository.getBoard(orgId, vacancyId, status);

    return {
      vacancyId,
      stages: stages.map((stage) => ({
        ...stage,
        count: stage.applications.length,
      })),
    };
  },

  // Move
  async moveCandidate(orgId: string, userId: string, applicationId: string, toStageId: string, reason?: string) {
    const application = await pipelineRepository.findApplication(orgId, applicationId);
    if (!application) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });

    const targetStage = await pipelineRepository.stageExistsForVacancy(toStageId, application.vacancyId);
    if (!targetStage) throw new TRPCError({ code: 'BAD_REQUEST', message: 'La etapa destino no pertenece a esta vacante' });

    return pipelineRepository.moveCandidate(orgId, userId, applicationId, application.currentStageId, toStageId, reason);
  },

  // Bulk move — scopeWhere is computed in the router (access machinery is not
  // imported in services) and is REQUIRED: a defaulted fragment would fail open.
  async bulkMove(
    orgId: string,
    userId: string,
    applicationIds: string[],
    toStageId: string,
    scopeWhere: Prisma.ApplicationWhereInput,
    reason?: string,
  ) {
    const uniqueIds = [...new Set(applicationIds)];
    const inScopeCount = await pipelineRepository.countApplicationsInScope(orgId, uniqueIds, scopeWhere);
    if (inScopeCount !== uniqueIds.length) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });
    }

    const applications = await pipelineRepository.findApplications(orgId, uniqueIds);
    if (applications.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicaciones no encontradas' });

    const vacancyIds = [...new Set(applications.map((a) => a.vacancyId))];
    if (vacancyIds.length > 1) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Todas las aplicaciones deben pertenecer a la misma vacante' });

    const targetStage = await pipelineRepository.stageExistsForVacancy(toStageId, vacancyIds[0]);
    if (!targetStage) throw new TRPCError({ code: 'BAD_REQUEST', message: 'La etapa destino no pertenece a esta vacante' });

    return pipelineRepository.bulkMove(orgId, userId, applications, toStageId, reason);
  },

  // Reject
  async rejectCandidate(orgId: string, applicationId: string, reason: string, feedback?: string) {
    const application = await pipelineRepository.findApplication(orgId, applicationId);
    if (!application || application.status !== 'active') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada o ya fue rechazada' });
    }
    return pipelineRepository.rejectApplication(applicationId, reason, feedback);
  },

  // Movement history
  async getMovementHistory(orgId: string, applicationId: string) {
    const application = await pipelineRepository.findApplication(orgId, applicationId);
    if (!application) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });
    return pipelineRepository.getMovementHistory(applicationId);
  },

  // Stages
  async listStages(orgId: string, vacancyId: string) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
    return pipelineRepository.listStages(orgId, vacancyId);
  },

  async createStage(orgId: string, input: {
    vacancyId: string; name: string; order: number;
    slaHours?: number; checklist?: unknown; isDefault: boolean;
  }) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, input.vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
    return pipelineRepository.createStage(orgId, input);
  },

  // Thin lookup used by routers to get a stage's parent vacancyId so they can
  // probe 'vacancy' scope before delegating the full mutation. Returns null when
  // the stage does not exist or does not belong to the org.
  async getStageVacancyId(orgId: string, stageId: string): Promise<string | null> {
    const stage = await pipelineRepository.findStage(orgId, stageId);
    return stage?.vacancyId ?? null;
  },

  async updateStage(orgId: string, stageId: string, data: Record<string, unknown>) {
    const stage = await pipelineRepository.findStage(orgId, stageId);
    if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
    return pipelineRepository.updateStage(stageId, data);
  },

  async deleteStage(orgId: string, stageId: string) {
    const stage = await pipelineRepository.getStageWithApplicationCount(orgId, stageId);
    if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
    if (stage._count.applications > 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'No se puede eliminar una etapa con candidatos. Muevelos primero.' });
    }
    await pipelineRepository.deleteStage(stageId);
    return { success: true };
  },

  async getStageChecklist(orgId: string, stageId: string) {
    const stage = await pipelineRepository.getStageChecklist(orgId, stageId);
    if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
    return { stageId: stage.id, stageName: stage.name, checklist: (stage.checklist as Array<Record<string, unknown>>) ?? [] };
  },

  async updateChecklist(orgId: string, stageId: string, checklist: unknown) {
    const stage = await pipelineRepository.findStage(orgId, stageId);
    if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
    return pipelineRepository.updateChecklist(stageId, checklist);
  },

  // Analytics — SLA
  async getSlaStatus(orgId: string, vacancyId: string) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });

    const stages = await pipelineRepository.getStagesForVacancy(vacancyId);
    const applications = await pipelineRepository.getActiveApplicationsWithMovements(vacancyId);
    const now = new Date();

    const items = applications.map((app) => {
      const stage = stages.find((s) => s.id === app.currentStageId);
      const enteredStageAt = app.movements[0]?.movedAt ?? app.appliedAt;
      const hoursInStage = Math.floor((now.getTime() - enteredStageAt.getTime()) / (1000 * 60 * 60));
      const isOverdue = stage?.slaHours != null && hoursInStage > stage.slaHours;

      return {
        applicationId: app.id,
        candidateId: app.candidate.id,
        candidateName: `${app.candidate.firstName} ${app.candidate.lastName}`,
        stageId: app.currentStageId,
        stageName: stage?.name ?? 'Desconocida',
        enteredStageAt,
        hoursInStage,
        slaHours: stage?.slaHours ?? null,
        isOverdue,
      };
    });

    return {
      vacancyId,
      totalActive: items.length,
      overdueCount: items.filter((s) => s.isOverdue).length,
      items,
    };
  },

  // Analytics — Next best action (stub)
  async getNextBestAction(orgId: string, applicationId: string) {
    const app = await pipelineRepository.getApplicationForAction(orgId, applicationId);
    if (!app) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });

    return {
      applicationId,
      candidateName: `${app.candidate.firstName} ${app.candidate.lastName}`,
      currentStage: app.currentStage.name,
      recommendation: 'Programar entrevista tecnica',
      confidence: 0.82,
      suggestedActions: [
        { action: 'schedule_interview', label: 'Programar entrevista', priority: 'high' },
        { action: 'request_assessment', label: 'Solicitar evaluacion', priority: 'medium' },
      ],
      model: 'stub',
    };
  },

  // Analytics — Funnel
  async getFunnel(orgId: string, vacancyId: string) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });

    const stages = await pipelineRepository.getStagesForVacancy(vacancyId);
    const funnelCounts = await pipelineRepository.getFunnelCounts(vacancyId, stages);
    const { total: totalApplications, rejected: rejectedCount } = await pipelineRepository.getApplicationCounts(vacancyId);

    const funnel = stages.map((stage, idx) => {
      const counts = funnelCounts.find((f) => f.stageId === stage.id);
      const prevCount = idx === 0 ? totalApplications : (funnelCounts[idx - 1]?.everReachedCount ?? 0);
      const everReached = counts?.everReachedCount ?? 0;
      const conversionRate = prevCount > 0 ? Math.round((everReached / prevCount) * 100) : 0;

      return {
        stageId: stage.id,
        stageName: stage.name,
        order: stage.order,
        currentCount: counts?.currentCount ?? 0,
        everReachedCount: everReached,
        conversionRate,
      };
    });

    return { vacancyId, totalApplications, rejectedCount, funnel };
  },
};
