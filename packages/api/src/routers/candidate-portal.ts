import { z } from 'zod';
import { router, candidateProcedure } from '../trpc';
import { candidatePortalService } from '../services/candidate-portal.service';

// Authenticated candidate portal (Wave 1 Slice 2). The candidate is identified by
// their Supabase session email (ctx.supabaseAuth.email) — the org comes from the
// route slug as input. NO endpoint accepts an email/candidateId from the client;
// that would let one candidate read another's data.
const orgSlug = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug invalido');

export const candidatePortalRouter = router({
  // The signed-in candidate's applications at this org (newest first).
  myApplications: candidateProcedure
    .input(z.object({ orgSlug }))
    .query(({ ctx, input }) =>
      candidatePortalService.getMyApplications(ctx.supabaseAuth.email, input.orgSlug),
    ),

  // The signed-in candidate's offers at this org. Each carries a signingToken (or
  // null) for the /offers/sign/[token] deep-link — acceptance reuses that existing
  // public flow rather than an in-portal accept.
  myOffers: candidateProcedure
    .input(z.object({ orgSlug }))
    .query(({ ctx, input }) =>
      candidatePortalService.getMyOffers(ctx.supabaseAuth.email, input.orgSlug),
    ),

  // The signed-in candidate's upcoming interviews at this org (soonest first).
  myInterviews: candidateProcedure
    .input(z.object({ orgSlug }))
    .query(({ ctx, input }) =>
      candidatePortalService.getMyInterviews(ctx.supabaseAuth.email, input.orgSlug),
    ),

  // The stage timeline for one of the candidate's own applications.
  applicationStatus: candidateProcedure
    .input(z.object({ orgSlug, applicationId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      candidatePortalService.getApplicationStatus(
        ctx.supabaseAuth.email,
        input.orgSlug,
        input.applicationId,
      ),
    ),
});
