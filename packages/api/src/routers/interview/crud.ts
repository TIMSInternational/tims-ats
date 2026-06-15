import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { emailService } from '../../services/email.service';
import { scopeWhereFor, assertScoped } from '../../access';

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
      const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);

      const where: Prisma.InterviewWhereInput = {
        AND: [
          { organizationId: ctx.user.organizationId },
          scopeWhere as Prisma.InterviewWhereInput,
          {
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
          },
        ],
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
      // Probe first — the subsequent findFirst uses `include` (no `select`),
      // and Prisma does not support mixing AND scope fragments with `include` in
      // a way that is type-safe; the two-query pattern (probe + fetch) keeps the
      // full include block intact while still enforcing scope.
      await assertScoped('interview', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

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

      // Probe parent vacancy and candidate through scope — ensures the scheduling
      // user can reach those resources under their current scope, not just org-wide.
      // Evaluator count check uses plain org check (users are not scope-filtered).
      const uniqueEvaluators = [...new Set(evaluatorIds)];
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, orgId);
      // Codex re-review: the candidate must ALSO be scope-probed — an org-only
      // check let a narrow-scoped scheduler pull any org candidate's PII into
      // the interview + invitation email. A candidate applying to the probed
      // vacancy has an in-scope application, so legit flows pass.
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, orgId);
      const evaluatorCount = await db.user.count({
        where: { id: { in: uniqueEvaluators }, organizationId: orgId },
      });
      if (evaluatorCount !== uniqueEvaluators.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluador no encontrado en esta organizacion' });
      }
      if (input.applicationId) {
        await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, orgId);
        // Integrity: the application must bind the SAME candidate and vacancy.
        const bound = await db.application.findFirst({
          where: { id: input.applicationId, organizationId: orgId, candidateId: input.candidateId, vacancyId: input.vacancyId },
          select: { id: true },
        });
        if (!bound) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'La aplicacion no corresponde al candidato y la vacante indicados' });
        }
      } else {
        // Codex round-3: an omitted applicationId must not bypass the
        // candidate↔vacancy binding. Auto-resolve and persist the application
        // when one exists (data-quality improvement, behavior-neutral). When
        // NONE exists: org-scope callers keep today's interview-first workflow
        // (the schedule modal pairs any searched candidate with any vacancy);
        // narrow scopes are rejected fail-closed — their only justification
        // for reaching the candidate is an application path.
        const boundApp = await db.application.findFirst({
          where: { organizationId: orgId, candidateId: input.candidateId, vacancyId: input.vacancyId },
          select: { id: true },
        });
        if (boundApp) {
          data.applicationId = boundApp.id;
        } else if (ctx.access.scope !== 'organization' && ctx.access.scope !== 'company') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'El candidato no tiene aplicacion a esta vacante' });
        }
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
      const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);

      // Compose scope into the business findFirst — it also fetches status/type
      // fields used by the reschedule-guard and email below, so we cannot replace
      // it with a bare assertScoped (would lose those fields).
      const existing = await db.interview.findFirst({
        where: {
          AND: [
            { id, organizationId: ctx.user.organizationId },
            scopeWhere as Prisma.InterviewWhereInput,
          ],
        },
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
  // ── Evaluator (committee panel) management on an EXISTING interview ───
  // Populates InterviewEvaluator, the anchor panelInterviewIds() reads.
  addEvaluator: permissionProcedure('interview', 'update')
    .input(z.object({
      interviewId: z.string().uuid(),
      userId: z.string().uuid(),
      role: z.string().max(50).default('evaluator'),
    }))
    .mutation(async ({ ctx, input }) => {
      // SCOPED probe — replaces the prior org-only parent existence check. The
      // InterviewEvaluator row is a committee-arm anchor (grants future read
      // access), so a narrow (team-scoped) caller must NOT be able to grab an
      // out-of-scope interview by id and self-add as evaluator. assertScoped
      // throws NOT_FOUND unless the interview is already in the caller's scope.
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);
      try {
        return await db.$transaction(async (tx) => {
          const user = await tx.user.findFirst({
            where: { id: input.userId, organizationId: ctx.user.organizationId },
            select: { id: true },
          });
          if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
          return tx.interviewEvaluator.create({
            data: { interviewId: input.interviewId, userId: input.userId, role: input.role },
            select: { id: true },
          });
        });
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'El evaluador ya esta asignado a esta entrevista' });
        }
        throw err;
      }
    }),

  removeEvaluator: permissionProcedure('interview', 'update')
    .input(z.object({ interviewId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // SCOPED probe — same escalation guard as addEvaluator: a narrow caller
      // must not manage the panel of an out-of-scope interview by id.
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);
      const result = await db.interviewEvaluator.deleteMany({
        where: { interviewId: input.interviewId, userId: input.userId },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluador no encontrado' });
      return { success: true };
    }),

  cancel: permissionProcedure('interview', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        cancelReason: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // assertScoped replaces the bare org-check findFirst — cancel only uses
      // the probe result as an existence check (no fields from it are consumed).
      await assertScoped('interview', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

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
