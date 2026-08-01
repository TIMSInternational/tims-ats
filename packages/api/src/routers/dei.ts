import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { deiService } from '../services/dei.service';

// ---------------------------------------------------------------------------
// DEI router — thin controller. Demographic metrics are backed by the
// EmployeeDemographics table via deiService (aggregates only, never individual
// self-ID rows — CLAUDE.md §7).
//
// TS-DELETION (2026-07-31): NEXT_PUBLIC_DEI_READ_VIA_CSHARP was confirmed live in prod, so 9 of
// the original 11 procedures here (getDashboardKpis, getGenderRepresentation,
// getAgeDistribution, getNationalityDiversity, getPayEquity, getLeadershipDiversity,
// getHiringFunnel, getPromotionEquity, getInclusionIndex) were dead code — every FE call site
// went through apps/web/lib/platform-api/dei.ts's wrapper hooks, which now call the C# service
// unconditionally — and have been deleted. getEthnicityDistribution and getDisabilityDistribution
// stay: they have ZERO FE consumers (no wrapper, no call site) and were never part of this
// cutover — pre-existing dead code, out of scope. generateReport (real, 2026-07-31: renders
// getEthnicityDistribution + getDisabilityDistribution into an actual xlsx/pdf document via
// deiService.generateReport, see dei-report-builder.ts) is unrelated and also stays.
// ---------------------------------------------------------------------------

export const deiRouter = router({
  // ── Demographic distributions (real, demographics-backed) ──────────
  getEthnicityDistribution: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getEthnicityDistribution(ctx.user.organizationId),
  ),

  getDisabilityDistribution: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getDisabilityDistribution(ctx.user.organizationId),
  ),

  // ── Report (real — aggregate-only xlsx/pdf export) ──────────────────
  generateReport: permissionProcedure('dei', 'export')
    .input(
      z.object({
        format: z.enum(['pdf', 'xlsx']).default('pdf'),
        sections: z.array(z.string().max(100)).max(100).optional(),
      }),
    )
    .mutation(({ ctx, input }) => deiService.generateReport(ctx.user.organizationId, input)),
});
