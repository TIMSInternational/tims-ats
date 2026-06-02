import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { pipelineService } from '../../services/pipeline.service';

const checklistItemSchema = z.object({
  key: z.string().max(100),
  label: z.string().max(200),
  completed: z.boolean().default(false),
  completedBy: z.string().uuid().optional(),
  completedAt: z.string().datetime().optional(),
});

export const pipelineStagesRouter = router({
  listStages: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(({ ctx, input }) => pipelineService.listStages(ctx.user.organizationId, input.vacancyId)),

  createStage: permissionProcedure('pipeline', 'create')
    .input(z.object({
      vacancyId: z.string().uuid(),
      name: z.string().min(1).max(100),
      order: z.number().int().min(0),
      slaHours: z.number().int().min(0).optional(),
      checklist: z.array(checklistItemSchema).max(30).optional(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(({ ctx, input }) => pipelineService.createStage(ctx.user.organizationId, input)),

  updateStage: permissionProcedure('pipeline', 'update')
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      order: z.number().int().min(0).optional(),
      slaHours: z.number().int().min(0).nullish(),
      checklist: z.array(checklistItemSchema).max(30).nullish(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return pipelineService.updateStage(ctx.user.organizationId, id, data);
    }),

  deleteStage: permissionProcedure('pipeline', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => pipelineService.deleteStage(ctx.user.organizationId, input.id)),

  getStageChecklist: permissionProcedure('pipeline', 'read')
    .input(z.object({ stageId: z.string().uuid() }))
    .query(({ ctx, input }) => pipelineService.getStageChecklist(ctx.user.organizationId, input.stageId)),

  updateChecklist: permissionProcedure('pipeline', 'update')
    .input(z.object({
      stageId: z.string().uuid(),
      checklist: z.array(checklistItemSchema).max(30),
    }))
    .mutation(({ ctx, input }) =>
      pipelineService.updateChecklist(ctx.user.organizationId, input.stageId, input.checklist),
    ),
});
