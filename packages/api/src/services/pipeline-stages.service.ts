import { TRPCError } from '@trpc/server';
import { pipelineRepository } from '../repositories/pipeline.repository';

// ---------------------------------------------------------------------------
// Pipeline Stages Service — stage config business logic, no db imports.
// Split from pipeline.service.ts (CLAUDE.md 300-line service cap).
// ---------------------------------------------------------------------------

export const pipelineStagesService = {
  async listStages(orgId: string, vacancyId: string) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
    return pipelineRepository.listStages(orgId, vacancyId);
  },

  async createStage(
    orgId: string,
    input: {
      vacancyId: string;
      name: string;
      order: number;
      slaHours?: number;
      checklist?: unknown;
      isDefault: boolean;
    },
  ) {
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
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No se puede eliminar una etapa con candidatos. Muevelos primero.',
      });
    }
    await pipelineRepository.deleteStage(stageId);
    return { success: true };
  },

  async getStageChecklist(orgId: string, stageId: string) {
    const stage = await pipelineRepository.getStageChecklist(orgId, stageId);
    if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
    return {
      stageId: stage.id,
      stageName: stage.name,
      checklist: (stage.checklist as Array<Record<string, unknown>>) ?? [],
    };
  },

  async updateChecklist(orgId: string, stageId: string, checklist: unknown) {
    const stage = await pipelineRepository.findStage(orgId, stageId);
    if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
    return pipelineRepository.updateChecklist(stageId, checklist);
  },
};
