import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const vacancyJobProfileRouter = router({
  // 4.13 — Get job profile for a vacancy
  getJobProfile: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify vacancy belongs to org
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.jobProfile.findUnique({
        where: { vacancyId: input.vacancyId },
      });
    }),

  // 4.14 — Update (or create) job profile for a vacancy
  updateJobProfile: permissionProcedure('vacancy', 'update')
    .input(z.object({
      vacancyId: z.string().uuid(),
      discTargets: z.record(z.unknown()).optional(),
      competencies: z.record(z.unknown()).optional(),
      pcaExpected: z.record(z.unknown()).nullish(),
      milExpected: z.record(z.unknown()).nullish(),
      kpis: z.unknown().nullish(),
      requirements: z.unknown().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
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
      });
    }),
});
