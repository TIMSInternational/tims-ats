import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { recruitmentAnalyticsService } from '../services/recruitment-analytics.service';

// ---------------------------------------------------------------------------
// Recruitment analytics router — thin controller over real pipeline/offer
// aggregates. Cost-per-hire, quality-of-hire and ML predictions have no data
// source yet and intentionally have NO endpoint (UI shows honest empty states).
// ---------------------------------------------------------------------------

const periodInput = z
  .object({ period: z.enum(['7D', '30D', '90D', '6M', '1Y']).default('30D') })
  .optional();

export const recruitmentAnalyticsRouter = router({
  getKpis: permissionProcedure('vacancy', 'read')
    .input(periodInput)
    .query(({ ctx, input }) =>
      recruitmentAnalyticsService.getKpis(ctx.user.organizationId, input?.period),
    ),

  getFunnel: permissionProcedure('vacancy', 'read').query(({ ctx }) =>
    recruitmentAnalyticsService.getFunnel(ctx.user.organizationId),
  ),

  getSourceBreakdown: permissionProcedure('vacancy', 'read')
    .input(periodInput)
    .query(({ ctx, input }) =>
      recruitmentAnalyticsService.getSourceBreakdown(ctx.user.organizationId, input?.period),
    ),

  getTrend: permissionProcedure('vacancy', 'read').query(({ ctx }) =>
    recruitmentAnalyticsService.getTrend(ctx.user.organizationId),
  ),

  getLostByDelay: permissionProcedure('vacancy', 'read')
    .input(periodInput)
    .query(({ ctx, input }) =>
      recruitmentAnalyticsService.getLostByDelay(ctx.user.organizationId, input?.period),
    ),

  getRecruiterSla: permissionProcedure('vacancy', 'read').query(({ ctx }) =>
    recruitmentAnalyticsService.getRecruiterSla(ctx.user.organizationId),
  ),
});
