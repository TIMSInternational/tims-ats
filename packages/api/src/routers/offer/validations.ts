import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const offerValidationsRouter = router({
  // 9.10 — List pre-employment validations
  listValidations: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.preemploymentValidation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
        },
        include: {
          completedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  // 9.11 — Update a pre-employment validation
  updateValidation: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['pending', 'passed', 'failed', 'waived']),
        result: z.record(z.unknown()).optional(),
        notes: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const validation = await db.preemploymentValidation.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });

      if (!validation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Validacion no encontrada' });
      }

      return db.preemploymentValidation.update({
        where: { id: input.id },
        data: {
          status: input.status,
          result: (input.result as Prisma.InputJsonValue) ?? undefined,
          notes: input.notes,
          completedById: ctx.user.id,
          completedAt: input.status !== 'pending' ? new Date() : null,
        },
      });
    }),

  // 9.12 — Upload medical exam (stub)
  uploadMedical: permissionProcedure('offer', 'create')
    .input(
      z.object({
        offerId: z.string().uuid(),
        fileName: z.string().max(255),
        fileType: z.string().max(100),
        fileSize: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.offerId, organizationId: ctx.user.organizationId },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      // Stub: return mock upload URL and create a pending validation
      const validation = await db.preemploymentValidation.create({
        data: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
          type: 'medical_exam',
          status: 'pending',
          isBlocking: true,
          notes: `Archivo: ${input.fileName}`,
        },
      });

      return {
        validation,
        uploadUrl: `https://storage.mock.tims.app/medical/${validation.id}/${input.fileName}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
    }),

  // 9.13 — Analyze medical exam (stub — mock AI)
  analyzeMedical: permissionProcedure('offer', 'read')
    .input(z.object({ validationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const validation = await db.preemploymentValidation.findFirst({
        where: {
          id: input.validationId,
          organizationId: ctx.user.organizationId,
          type: 'medical_exam',
        },
      });

      if (!validation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Validacion medica no encontrada' });
      }

      // Stub: return mock AI analysis
      return {
        validationId: input.validationId,
        analysis: {
          status: 'fit_for_duty',
          summary: 'El candidato cumple con los requisitos medicos para el puesto.',
          findings: [
            { category: 'general_health', result: 'normal', notes: 'Sin observaciones' },
            { category: 'vision', result: 'normal', notes: '20/20 ambos ojos' },
            { category: 'cardiovascular', result: 'normal', notes: 'Dentro de parametros' },
          ],
          restrictions: [],
          recommendations: ['Examen de seguimiento en 12 meses'],
        },
        generatedAt: new Date().toISOString(),
        model: 'mock-ai-v1',
      };
    }),

  // 9.14 — Get legal checklist for an offer
  getLegalChecklist: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.legalCheck.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
        },
        include: {
          completedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  // 9.15 — Update a legal check
  updateLegalCheck: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        completed: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const check = await db.legalCheck.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });

      if (!check) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verificacion legal no encontrada' });
      }

      return db.legalCheck.update({
        where: { id: input.id },
        data: {
          completed: input.completed,
          completedAt: input.completed ? new Date() : null,
          completedById: input.completed ? ctx.user.id : null,
        },
      });
    }),
});
