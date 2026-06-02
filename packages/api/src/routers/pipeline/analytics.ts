import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { pipelineService } from '../../services/pipeline.service';

export const pipelineAnalyticsRouter = router({
  getSlaStatus: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(({ ctx, input }) => pipelineService.getSlaStatus(ctx.user.organizationId, input.vacancyId)),

  getNextBestAction: permissionProcedure('pipeline', 'read')
    .input(z.object({ applicationId: z.string().uuid() }))
    .query(({ ctx, input }) => pipelineService.getNextBestAction(ctx.user.organizationId, input.applicationId)),

  getFunnel: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(({ ctx, input }) => pipelineService.getFunnel(ctx.user.organizationId, input.vacancyId)),
});
