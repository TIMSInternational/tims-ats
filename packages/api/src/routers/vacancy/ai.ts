import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { generateVacancyDescription, checkInclusiveLanguage as checkInclusive } from '@tims/ai';

export const vacancyAiRouter = router({
  generateDescription: permissionProcedure('vacancy', 'create')
    .input(z.object({
      title: z.string().min(1).max(200),
      context: z.string().max(2000).optional(),
    }))
    .mutation(({ ctx, input }) =>
      generateVacancyDescription(ctx.user.organizationId, input.title, input.context),
    ),

  checkInclusiveLanguage: permissionProcedure('vacancy', 'read')
    .input(z.object({ text: z.string().min(1).max(5000) }))
    .mutation(({ ctx, input }) =>
      checkInclusive(ctx.user.organizationId, input.text),
    ),
});
