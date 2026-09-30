import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { interviewAiService } from '../../services/interview-ai.service';
import { assertScoped } from '../../access';
import { scorecardVisibilityService } from '../../services/scorecard-visibility.service';

// ---------------------------------------------------------------------------
// Interview AI router — thin controller over interviewAiService. All three
// endpoints make REAL gated Bedrock calls (@tims/ai invokeAgent); the previous
// mock-AI stubs (canned questions, fabricated summaries persisted to the DB,
// fake "low risk" bias verdicts) are gone (rule #4). All are mutations: each
// call spends AI budget, so none may fire as an auto-fetching query.
// ---------------------------------------------------------------------------

const interviewIdInput = z.object({ interviewId: z.string().uuid() });

export const interviewAiRouter = router({
  // 8.8 — Generate a role+candidate-tailored interview guide
  generateGuide: permissionProcedure('interview', 'read')
    .input(interviewIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return interviewAiService.generateGuide(ctx.user.organizationId, input.interviewId);
    }),

  // 8.9 — Generate an interview summary grounded in submitted scorecards
  generateSummary: permissionProcedure('interview', 'create')
    .input(interviewIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);
      // Derived from every scorecard — refused while the caller is a blinded panel evaluator.
      await scorecardVisibilityService.assertNotBlinded(ctx.user.organizationId, input.interviewId, ctx.user.id);
      return interviewAiService.generateSummary(ctx.user.organizationId, input.interviewId);
    }),

  // 8.10 — Analyze scorecards for evaluation bias
  detectBias: permissionProcedure('interview', 'read')
    .input(interviewIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);
      // Derived from every scorecard — refused while the caller is a blinded panel evaluator.
      await scorecardVisibilityService.assertNotBlinded(ctx.user.organizationId, input.interviewId, ctx.user.id);
      return interviewAiService.detectBias(ctx.user.organizationId, input.interviewId);
    }),
});
