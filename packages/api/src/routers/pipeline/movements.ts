import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { pipelineService } from '../../services/pipeline.service';

export const pipelineMovementsRouter = router({
  getBoard: permissionProcedure('pipeline', 'read')
    .input(z.object({
      vacancyId: z.string().uuid(),
      status: z.enum(['active', 'rejected', 'all']).default('active'),
    }))
    .query(({ ctx, input }) => pipelineService.getBoard(ctx.user.organizationId, input.vacancyId, input.status)),

  moveCandidate: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationId: z.string().uuid(),
      toStageId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(({ ctx, input }) =>
      pipelineService.moveCandidate(ctx.user.organizationId, ctx.user.id, input.applicationId, input.toStageId, input.reason),
    ),

  bulkMove: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationIds: z.array(z.string().uuid()).min(1).max(50),
      toStageId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(({ ctx, input }) =>
      pipelineService.bulkMove(ctx.user.organizationId, ctx.user.id, input.applicationIds, input.toStageId, input.reason),
    ),

  rejectCandidate: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationId: z.string().uuid(),
      reason: z.string().min(1).max(500),
      feedback: z.string().max(2000).optional(),
    }))
    .mutation(({ ctx, input }) =>
      pipelineService.rejectCandidate(ctx.user.organizationId, input.applicationId, input.reason, input.feedback),
    ),

  getMovementHistory: permissionProcedure('pipeline', 'read')
    .input(z.object({ applicationId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      pipelineService.getMovementHistory(ctx.user.organizationId, input.applicationId),
    ),
});
