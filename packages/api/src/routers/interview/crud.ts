import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const interviewCrudRouter = router({
  // 8.1 — List interviews with filters
  list: permissionProcedure('interview', 'read')
    .input(
      z.object({
        vacancyId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        status: z.string().optional(),
        type: z.string().optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, ...filters } = input;

      const where: any = {
        organizationId: ctx.user.organizationId,
        ...(filters.vacancyId && { vacancyId: filters.vacancyId }),
        ...(filters.candidateId && { candidateId: filters.candidateId }),
        ...(filters.status && { status: filters.status }),
        ...(filters.type && { type: filters.type }),
        ...(filters.from || filters.to
          ? {
              scheduledAt: {
                ...(filters.from && { gte: filters.from }),
                ...(filters.to && { lte: filters.to }),
              },
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        db.interview.findMany({
          where,
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            },
            vacancy: { select: { id: true, title: true } },
            evaluators: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
              },
            },
          },
          orderBy: { scheduledAt: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.interview.count({ where }),
      ]);

      return { items, total, page, pageSize };
    }),

  // 8.2 — Get interview by ID
  getById: permissionProcedure('interview', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const interview = await db.interview.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          candidate: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true },
          },
          vacancy: { select: { id: true, title: true } },
          application: { select: { id: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          evaluators: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
          },
          scorecards: {
            include: {
              evaluator: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          summary: true,
        },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      return interview;
    }),

  // 8.3 — Schedule a new interview
  schedule: permissionProcedure('interview', 'create')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        vacancyId: z.string().uuid(),
        applicationId: z.string().uuid().optional(),
        type: z.string(),
        scheduledAt: z.date(),
        duration: z.number().int().min(15).max(480),
        location: z.string().optional(),
        meetingUrl: z.string().url().optional(),
        notes: z.string().optional(),
        evaluatorIds: z.array(z.string().uuid()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { evaluatorIds, ...data } = input;

      return db.interview.create({
        data: {
          ...data,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          status: 'scheduled',
          evaluators: {
            create: evaluatorIds.map((userId) => ({
              userId,
              role: 'evaluator',
              status: 'pending',
            })),
          },
        },
        include: {
          evaluators: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });
    }),

  // 8.4 — Reschedule an interview
  reschedule: permissionProcedure('interview', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        scheduledAt: z.date(),
        duration: z.number().int().min(15).max(480).optional(),
        location: z.string().optional(),
        meetingUrl: z.string().url().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await db.interview.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      if (existing.status === 'cancelled' || existing.status === 'completed') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No se puede reprogramar una entrevista cancelada o completada',
        });
      }

      return db.interview.update({
        where: { id },
        data: {
          ...data,
          status: 'rescheduled',
        },
      });
    }),

  // 8.5 — Cancel an interview
  cancel: permissionProcedure('interview', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        cancelReason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.interview.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      return db.interview.update({
        where: { id: input.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: input.cancelReason,
        },
      });
    }),
});
