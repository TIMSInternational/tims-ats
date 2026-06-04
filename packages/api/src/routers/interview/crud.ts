import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { emailService } from '../../services/email.service';

export const interviewCrudRouter = router({
  // 8.1 — List interviews with filters
  list: permissionProcedure('interview', 'read')
    .input(
      z.object({
        vacancyId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        status: z.string().max(50).optional(),
        type: z.string().max(50).optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, ...filters } = input;

      const where: Prisma.InterviewWhereInput = {
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
        type: z.string().max(50),
        scheduledAt: z.date(),
        duration: z.number().int().min(15).max(480),
        location: z.string().max(500).optional(),
        meetingUrl: z.string().url().max(2048).optional(),
        notes: z.string().max(5000).optional(),
        evaluatorIds: z.array(z.string().uuid()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { evaluatorIds, ...data } = input;
      const orgId = ctx.user.organizationId;

      // Verify referenced resources belong to the caller's org. Without this, an
      // attacker could schedule against another tenant's candidate — leaking their
      // PII via the include AND emailing them an interview invitation.
      const uniqueEvaluators = [...new Set(evaluatorIds)];
      const [candidate, vacancy, evaluatorCount] = await Promise.all([
        db.candidate.findFirst({ where: { id: input.candidateId, organizationId: orgId }, select: { id: true } }),
        db.vacancy.findFirst({ where: { id: input.vacancyId, organizationId: orgId }, select: { id: true } }),
        db.user.count({ where: { id: { in: uniqueEvaluators }, organizationId: orgId } }),
      ]);
      if (!candidate) throw new Error('Candidato no encontrado en esta organizacion');
      if (!vacancy) throw new Error('Vacante no encontrada en esta organizacion');
      if (evaluatorCount !== uniqueEvaluators.length) {
        throw new Error('Evaluador no encontrado en esta organizacion');
      }
      if (input.applicationId) {
        const application = await db.application.findFirst({
          where: { id: input.applicationId, organizationId: orgId },
          select: { id: true },
        });
        if (!application) throw new Error('Aplicacion no encontrada en esta organizacion');
      }

      const interview = await db.interview.create({
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
          candidate: { select: { firstName: true, lastName: true, email: true } },
          vacancy: { select: { title: true } },
          evaluators: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });

      // Fire-and-forget: send interview invitation email
      const org = await db.organization.findFirst({
        where: { id: ctx.user.organizationId },
        select: { name: true, billingEmail: true },
      });
      if (interview.candidate?.email && org) {
        emailService.sendInterviewInvitation({
          candidateEmail: interview.candidate.email,
          candidateName: `${interview.candidate.firstName} ${interview.candidate.lastName}`,
          vacancyTitle: interview.vacancy?.title ?? '',
          companyName: org.name,
          interviewType: data.type,
          scheduledAt: data.scheduledAt,
          duration: data.duration,
          location: data.location ?? undefined,
          meetingUrl: data.meetingUrl ?? undefined,
          contactEmail: org.billingEmail ?? 'rrhh@timsinternational.com',
        });
      }

      return interview;
    }),

  // 8.4 — Reschedule an interview
  reschedule: permissionProcedure('interview', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        scheduledAt: z.date(),
        duration: z.number().int().min(15).max(480).optional(),
        location: z.string().max(500).optional(),
        meetingUrl: z.string().url().max(2048).optional(),
        notes: z.string().max(5000).optional(),
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

      const updated = await db.interview.update({
        where: { id },
        data: {
          ...data,
          status: 'rescheduled',
        },
        include: {
          candidate: { select: { firstName: true, lastName: true, email: true } },
          vacancy: { select: { title: true } },
        },
      });

      // Fire-and-forget: send reschedule notification
      const org = await db.organization.findFirst({
        where: { id: ctx.user.organizationId },
        select: { name: true, billingEmail: true },
      });
      if (updated.candidate?.email && org) {
        emailService.sendInterviewReschedule({
          candidateEmail: updated.candidate.email,
          candidateName: `${updated.candidate.firstName} ${updated.candidate.lastName}`,
          vacancyTitle: updated.vacancy?.title ?? '',
          companyName: org.name,
          interviewType: existing.type,
          oldScheduledAt: existing.scheduledAt,
          newScheduledAt: data.scheduledAt,
          scheduledAt: data.scheduledAt,
          duration: data.duration ?? existing.duration,
          location: data.location ?? existing.location ?? undefined,
          meetingUrl: data.meetingUrl ?? existing.meetingUrl ?? undefined,
          contactEmail: org.billingEmail ?? 'rrhh@timsinternational.com',
        });
      }

      return updated;
    }),

  // 8.5 — Cancel an interview
  cancel: permissionProcedure('interview', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        cancelReason: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.interview.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      const cancelled = await db.interview.update({
        where: { id: input.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: input.cancelReason,
        },
        include: {
          candidate: { select: { firstName: true, lastName: true, email: true } },
          vacancy: { select: { title: true } },
        },
      });

      // Fire-and-forget: send cancellation notification
      const org = await db.organization.findFirst({
        where: { id: ctx.user.organizationId },
        select: { name: true, billingEmail: true },
      });
      if (cancelled.candidate?.email && org) {
        emailService.sendInterviewCancellation({
          candidateEmail: cancelled.candidate.email,
          candidateName: `${cancelled.candidate.firstName} ${cancelled.candidate.lastName}`,
          vacancyTitle: cancelled.vacancy?.title ?? '',
          companyName: org.name,
          cancelReason: input.cancelReason,
          contactEmail: org.billingEmail ?? 'rrhh@timsinternational.com',
        });
      }

      return cancelled;
    }),
});
