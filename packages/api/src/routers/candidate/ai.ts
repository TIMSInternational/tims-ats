import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateAiService } from '../../services/candidate-ai.service';
import { assertScoped } from '../../access';

export const candidateAiRouter = router({
  // Screen a candidate against a vacancy via the gated candidate-screener agent
  // and persist the result as a FitScore. Rate-limited to the AI tier ('screen'
  // keyword); permission 'update' because it writes a FitScore.
  screen: permissionProcedure('candidate', 'update')
    .input(z.object({
      candidateId: z.string().uuid(),
      vacancyId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Codex F2: without these probes a narrow-scoped caller could screen
      // arbitrary org candidates/vacancies (AI read + FitScore write) by id.
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateAiService.screenCandidate(ctx.user.organizationId, input.candidateId, input.vacancyId);
    }),
});
