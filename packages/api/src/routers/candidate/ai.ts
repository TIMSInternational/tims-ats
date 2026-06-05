import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateAiService } from '../../services/candidate-ai.service';

export const candidateAiRouter = router({
  // Screen a candidate against a vacancy via the gated candidate-screener agent
  // and persist the result as a FitScore. Rate-limited to the AI tier ('screen'
  // keyword); permission 'update' because it writes a FitScore.
  screen: permissionProcedure('candidate', 'update')
    .input(z.object({
      candidateId: z.string().uuid(),
      vacancyId: z.string().uuid(),
    }))
    .mutation(({ ctx, input }) =>
      candidateAiService.screenCandidate(ctx.user.organizationId, input.candidateId, input.vacancyId),
    ),
});
