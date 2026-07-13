import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { assertScoped } from '../../access';
import { EDUCATION_LEVELS } from '../../services/fit-engine.service';

// ---------------------------------------------------------------------------
// Typed Zod schemas for JSON fields (no z.unknown)
// ---------------------------------------------------------------------------

const discTargetsSchema = z.object({
  dominance: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
  influence: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
  steadiness: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
  compliance: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
}).optional();

const competencySchema = z.object({
  name: z.string().max(100),
  level: z.number().int().min(1).max(5),
});

const competenciesSchema = z.array(competencySchema).max(20).optional();

const pcaExpectedSchema = z.object({
  dominance: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
  influence: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
  steadiness: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
  compliance: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
}).nullish();

const milExpectedSchema = z.object({
  minScore: z.number().min(0).max(100),
}).nullish();

const kpiSchema = z.object({
  name: z.string().max(100),
  target: z.string().max(100),
}).optional();

const kpisSchema = z.array(kpiSchema.unwrap()).max(10).nullish();

const requirementSchema = z.object({
  text: z.string().max(500),
  isRequired: z.boolean().default(true),
});

const requirementsSchema = z.array(requirementSchema).max(20).nullish();

// FIT Engine's own structured requirements — separate from the free-text
// `requirements` checklist above. Consumed by fitEngineService.computeFitScore
// via fitEngineRepository.getVacancyForFit (jobProfile.fitRequirements), not
// by the free-text `requirements` field, which parseRequirements() cannot
// safely parse (arbitrary HR-authored prose, not structured data).
const fitRequirementsInputSchema = z.object({
  vacancyId: z.string().uuid(),
  minYearsExperience: z.number().min(0).max(60).optional(),
  requiredEducationLevel: z.enum(EDUCATION_LEVELS).optional(),
  requiredLanguages: z.array(z.string().min(1).max(50)).max(20).optional(),
});

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

const jobProfileSelect = {
  id: true,
  vacancyId: true,
  discTargets: true,
  competencies: true,
  pcaExpected: true,
  milExpected: true,
  kpis: true,
  requirements: true,
  fitRequirements: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ---------------------------------------------------------------------------
// Job Profile sub-router
// ---------------------------------------------------------------------------

export const vacancyJobProfileRouter = router({
  getJobProfile: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.jobProfile.findUnique({
        where: { vacancyId: input.vacancyId },
        select: jobProfileSelect,
      });
    }),

  updateJobProfile: permissionProcedure('vacancy', 'update')
    .input(z.object({
      vacancyId: z.string().uuid(),
      discTargets: discTargetsSchema,
      competencies: competenciesSchema,
      pcaExpected: pcaExpectedSchema,
      milExpected: milExpectedSchema,
      kpis: kpisSchema,
      requirements: requirementsSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const { vacancyId, ...data } = input;

      return db.jobProfile.upsert({
        where: { vacancyId },
        create: {
          organizationId: ctx.user.organizationId,
          vacancyId,
          discTargets: (data.discTargets ?? {}) as Prisma.InputJsonValue,
          competencies: (data.competencies ?? {}) as Prisma.InputJsonValue,
          pcaExpected: (data.pcaExpected as Prisma.InputJsonValue) ?? undefined,
          milExpected: (data.milExpected as Prisma.InputJsonValue) ?? undefined,
          kpis: (data.kpis as Prisma.InputJsonValue) ?? undefined,
          requirements: (data.requirements as Prisma.InputJsonValue) ?? undefined,
        },
        update: {
          ...(data.discTargets !== undefined && { discTargets: data.discTargets as Prisma.InputJsonValue }),
          ...(data.competencies !== undefined && { competencies: data.competencies as Prisma.InputJsonValue }),
          ...(data.pcaExpected !== undefined && { pcaExpected: data.pcaExpected as Prisma.InputJsonValue }),
          ...(data.milExpected !== undefined && { milExpected: data.milExpected as Prisma.InputJsonValue }),
          ...(data.kpis !== undefined && { kpis: data.kpis as Prisma.InputJsonValue }),
          ...(data.requirements !== undefined && { requirements: data.requirements as Prisma.InputJsonValue }),
        },
        select: jobProfileSelect,
      });
    }),

  updateFitRequirements: permissionProcedure('vacancy', 'update')
    .input(fitRequirementsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const { vacancyId, ...fields } = input;
      const fitRequirements = {
        ...(fields.minYearsExperience !== undefined && { minYearsExperience: fields.minYearsExperience }),
        ...(fields.requiredEducationLevel !== undefined && { requiredEducationLevel: fields.requiredEducationLevel }),
        ...(fields.requiredLanguages !== undefined && { requiredLanguages: fields.requiredLanguages }),
      } as Prisma.InputJsonValue;

      return db.jobProfile.upsert({
        where: { vacancyId },
        create: {
          organizationId: ctx.user.organizationId,
          vacancyId,
          fitRequirements,
        },
        update: { fitRequirements },
        select: { id: true, vacancyId: true, fitRequirements: true },
      });
    }),
});
