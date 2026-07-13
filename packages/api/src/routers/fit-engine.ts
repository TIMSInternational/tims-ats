import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { assertScoped } from '../access';
import { fitEngineService } from '../services/fit-engine.service';
import { explainFit } from '@tims/ai';

const weightsSchema = z
  .object({
    assessment: z.number().min(0).max(1),
    interview: z.number().min(0).max(1),
    experience: z.number().min(0).max(1),
    education: z.number().min(0).max(1),
    languages: z.number().min(0).max(1),
  })
  .refine(
    (w) => Math.abs(w.assessment + w.interview + w.experience + w.education + w.languages - 1) < 0.001,
    { message: 'Los pesos deben sumar 1.0' },
  );

export const fitEngineRouter = router({
  getRankingForVacancy: permissionProcedure('fit_engine', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return fitEngineService.getRankingForVacancy(ctx.user.organizationId, input.vacancyId);
    }),

  computeForVacancy: permissionProcedure('fit_engine', 'create')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return fitEngineService.computeForVacancy(ctx.user.organizationId, input.vacancyId);
    }),

  simulateWeights: permissionProcedure('fit_engine', 'read')
    .input(z.object({ vacancyId: z.string().uuid(), hypotheticalWeights: weightsSchema }))
    .query(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return fitEngineService.simulateWeights(ctx.user.organizationId, input.vacancyId, input.hypotheticalWeights);
    }),

  upsertRoleFamilyWeightProfile: permissionProcedure('fit_engine', 'update')
    .input(z.object({ name: z.string().min(1).max(100), weights: weightsSchema }))
    .mutation(({ ctx, input }) => fitEngineService.upsertWeightProfile(ctx.user.organizationId, input.name, input.weights)),

  listRoleFamilyWeightProfiles: permissionProcedure('fit_engine', 'read')
    .query(({ ctx }) => fitEngineService.listWeightProfiles(ctx.user.organizationId)),

  explainFit: permissionProcedure('fit_engine', 'read')
    .input(z.object({ candidateId: z.string().uuid(), vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      const data = await fitEngineService.getFitScoreForExplain(ctx.user.organizationId, input.candidateId, input.vacancyId);
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay FIT score calculado para este candidato' });
      const { result, model } = await explainFit(ctx.user.organizationId, data);
      return { narrative: result.narrative, model };
    }),
});
