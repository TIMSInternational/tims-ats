import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';

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
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

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
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

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
});
