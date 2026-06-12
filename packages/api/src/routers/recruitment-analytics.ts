import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { recruitmentAnalyticsService } from '../services/recruitment-analytics.service';
import { requireOrgScope } from '../access';

// Codex F3 (Wave 2.5 slice 3): these aggregates query ORG-WIDE pipeline/offer
// data. Until they are scope-aware (follow-up in REMAINING-WORK), narrow-scoped
// roles (team/unit/own vacancy:read) must not read them — fail closed via the
// shared org-gate (Wave 2.5 slice 4 promoted requireOrgScope to access/org-gate).

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
    .query(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return recruitmentAnalyticsService.getKpis(ctx.user.organizationId, input?.period);
    }),

  getFunnel: permissionProcedure('vacancy', 'read').query(({ ctx }) => {
    requireOrgScope(ctx.access);
    return recruitmentAnalyticsService.getFunnel(ctx.user.organizationId);
  }),

  getSourceBreakdown: permissionProcedure('vacancy', 'read')
    .input(periodInput)
    .query(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return recruitmentAnalyticsService.getSourceBreakdown(ctx.user.organizationId, input?.period);
    }),

  getTrend: permissionProcedure('vacancy', 'read').query(({ ctx }) => {
    requireOrgScope(ctx.access);
    return recruitmentAnalyticsService.getTrend(ctx.user.organizationId);
  }),

  getLostByDelay: permissionProcedure('vacancy', 'read')
    .input(periodInput)
    .query(({ ctx, input }) => {
      requireOrgScope(ctx.access);
      return recruitmentAnalyticsService.getLostByDelay(ctx.user.organizationId, input?.period);
    }),

  getRecruiterSla: permissionProcedure('vacancy', 'read').query(({ ctx }) => {
    requireOrgScope(ctx.access);
    return recruitmentAnalyticsService.getRecruiterSla(ctx.user.organizationId);
  }),
});
