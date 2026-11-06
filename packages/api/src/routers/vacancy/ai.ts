import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import {
  generateVacancyDescription,
  suggestVacancyCompetencies,
  checkInclusiveLanguage as checkInclusive,
} from '@tims/ai';

export const vacancyAiRouter = router({
  // mode 'variants' (default): the 3 description variants plus suggested competencies ("Generar con IA").
  // mode 'competencies': only the competencies, from the title and the description written so far
  // ("Sugerir competencias"). One procedure for both: the procedure ratchet forbids new ones.
  generateDescription: permissionProcedure('vacancy', 'create')
    .input(z.object({
      title: z.string().min(1).max(200),
      context: z.string().max(2000).optional(),
      mode: z.enum(['variants', 'competencies']).default('variants'),
      description: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) =>
      input.mode === 'competencies'
        ? {
            kind: 'competencies' as const,
            ...(await suggestVacancyCompetencies(ctx.user.organizationId, input.title, input.description)),
          }
        : {
            kind: 'variants' as const,
            ...(await generateVacancyDescription(ctx.user.organizationId, input.title, input.context)),
          },
    ),

  checkInclusiveLanguage: permissionProcedure('vacancy', 'read')
    .input(z.object({ text: z.string().min(1).max(5000) }))
    .mutation(({ ctx, input }) =>
      checkInclusive(ctx.user.organizationId, input.text),
    ),
});
