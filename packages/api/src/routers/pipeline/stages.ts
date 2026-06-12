import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { TRPCError } from '@trpc/server';
import { pipelineService } from '../../services/pipeline.service';
import { assertScoped } from '../../access';

const checklistItemSchema = z.object({
  key: z.string().max(100),
  label: z.string().max(200),
  completed: z.boolean().default(false),
  completedBy: z.string().uuid().optional(),
  completedAt: z.string().datetime().optional(),
});

// Helper: fetch a stage's parent vacancyId then scope-probe the vacancy.
// Throws NOT_FOUND if the stage is not org-owned or the vacancy is out of scope.
async function probeStageVacancy(
  orgId: string,
  stageId: string,
  access: Parameters<typeof assertScoped>[2],
  userId: string,
): Promise<void> {
  const vacancyId = await pipelineService.getStageVacancyId(orgId, stageId);
  if (!vacancyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
  }
  await assertScoped('vacancy', vacancyId, access, userId, orgId);
}

export const pipelineStagesRouter = router({
  listStages: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.listStages(ctx.user.organizationId, input.vacancyId);
    }),

  createStage: permissionProcedure('pipeline', 'create')
    .input(z.object({
      vacancyId: z.string().uuid(),
      name: z.string().min(1).max(100),
      order: z.number().int().min(0),
      slaHours: z.number().int().min(0).optional(),
      checklist: z.array(checklistItemSchema).max(30).optional(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.createStage(ctx.user.organizationId, input);
    }),

  // Fetch-then-probe: stageId → vacancyId → probe vacancy scope.
  // A PipelineStage always has a non-null vacancyId (schema: required FK, no org-global templates).
  updateStage: permissionProcedure('pipeline', 'update')
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      order: z.number().int().min(0).optional(),
      slaHours: z.number().int().min(0).nullish(),
      checklist: z.array(checklistItemSchema).max(30).nullish(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await probeStageVacancy(ctx.user.organizationId, input.id, ctx.access, ctx.user.id);
      const { id, ...data } = input;
      return pipelineService.updateStage(ctx.user.organizationId, id, data);
    }),

  deleteStage: permissionProcedure('pipeline', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await probeStageVacancy(ctx.user.organizationId, input.id, ctx.access, ctx.user.id);
      return pipelineService.deleteStage(ctx.user.organizationId, input.id);
    }),

  getStageChecklist: permissionProcedure('pipeline', 'read')
    .input(z.object({ stageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await probeStageVacancy(ctx.user.organizationId, input.stageId, ctx.access, ctx.user.id);
      return pipelineService.getStageChecklist(ctx.user.organizationId, input.stageId);
    }),

  updateChecklist: permissionProcedure('pipeline', 'update')
    .input(z.object({
      stageId: z.string().uuid(),
      checklist: z.array(checklistItemSchema).max(30),
    }))
    .mutation(async ({ ctx, input }) => {
      await probeStageVacancy(ctx.user.organizationId, input.stageId, ctx.access, ctx.user.id);
      return pipelineService.updateChecklist(ctx.user.organizationId, input.stageId, input.checklist);
    }),
});
