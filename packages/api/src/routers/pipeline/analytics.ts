import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { pipelineService } from '../../services/pipeline.service';
import { assertScoped } from '../../access';

export const pipelineAnalyticsRouter = router({
  // getSlaStatus and getFunnel are per-vacancy — probe the vacancy first.
  getSlaStatus: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.getSlaStatus(ctx.user.organizationId, input.vacancyId);
    }),

  // getNextBestAction is per-application — probe the application first.
  getNextBestAction: permissionProcedure('pipeline', 'read')
    .input(z.object({ applicationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.getNextBestAction(ctx.user.organizationId, input.applicationId);
    }),

  getFunnel: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.getFunnel(ctx.user.organizationId, input.vacancyId);
    }),
});
