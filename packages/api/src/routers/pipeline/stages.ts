import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

const checklistItemSchema = z.object({
  key: z.string().max(100),
  label: z.string().max(200),
  completed: z.boolean().default(false),
  completedBy: z.string().uuid().optional(),
  completedAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Stages sub-router
// ---------------------------------------------------------------------------

export const pipelineStagesRouter = router({
  // 5.2 — List stages for a vacancy
  listStages: permissionProcedure('pipeline', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.pipelineStage.findMany({
        where: { vacancyId: input.vacancyId, organizationId: ctx.user.organizationId },
        orderBy: { order: 'asc' },
        include: {
          _count: { select: { applications: true } },
        },
      });
    }),

  // 5.3 — Create a pipeline stage
  createStage: permissionProcedure('pipeline', 'create')
    .input(z.object({
      vacancyId: z.string().uuid(),
      name: z.string().min(1).max(100),
      order: z.number().int().min(0),
      slaHours: z.number().int().min(0).optional(),
      checklist: z.array(checklistItemSchema).optional(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.pipelineStage.create({
        data: {
          organizationId: ctx.user.organizationId,
          vacancyId: input.vacancyId,
          name: input.name,
          order: input.order,
          slaHours: input.slaHours,
          checklist: input.checklist as unknown as Prisma.JsonArray ?? undefined,
          isDefault: input.isDefault,
        },
      });
    }),

  // 5.4 — Update a pipeline stage
  updateStage: permissionProcedure('pipeline', 'update')
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      order: z.number().int().min(0).optional(),
      slaHours: z.number().int().min(0).nullish(),
      checklist: z.array(checklistItemSchema).nullish(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });
      if (!stage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
      }

      const { id, ...data } = input;

      return db.pipelineStage.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.order !== undefined && { order: data.order }),
          ...(data.slaHours !== undefined && { slaHours: data.slaHours }),
          ...(data.checklist !== undefined && { checklist: data.checklist as unknown as Prisma.JsonArray }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        },
      });
    }),

  // 5.5 — Delete a pipeline stage
  deleteStage: permissionProcedure('pipeline', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: { _count: { select: { applications: true } } },
      });
      if (!stage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
      }
      if (stage._count.applications > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No se puede eliminar una etapa con candidatos. Muevelos primero.',
        });
      }

      await db.pipelineStage.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // 5.10 — Get checklist for a stage
  getStageChecklist: permissionProcedure('pipeline', 'read')
    .input(z.object({ stageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.stageId, organizationId: ctx.user.organizationId },
      });
      if (!stage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
      }

      return {
        stageId: stage.id,
        stageName: stage.name,
        checklist: (stage.checklist as Array<Record<string, unknown>>) ?? [],
      };
    }),

  // 5.11 — Update checklist for a stage
  updateChecklist: permissionProcedure('pipeline', 'update')
    .input(z.object({
      stageId: z.string().uuid(),
      checklist: z.array(checklistItemSchema),
    }))
    .mutation(async ({ ctx, input }) => {
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.stageId, organizationId: ctx.user.organizationId },
      });
      if (!stage) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Etapa no encontrada' });
      }

      return db.pipelineStage.update({
        where: { id: input.stageId },
        data: { checklist: input.checklist as unknown as Prisma.JsonArray },
      });
    }),
});
