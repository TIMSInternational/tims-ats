import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const interviewRouter = router({
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

  // 8.6 — Get scorecard for a specific interview + evaluator
  getScorecard: permissionProcedure('interview', 'read')
    .input(
      z.object({
        interviewId: z.string().uuid(),
        evaluatorId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const evaluatorId = input.evaluatorId ?? ctx.user.id;

      const scorecard = await db.interviewScorecard.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
          evaluatorId,
        },
        include: {
          evaluator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });

      return scorecard;
    }),

  // 8.7 — Submit a scorecard
  submitScorecard: permissionProcedure('interview', 'create')
    .input(
      z.object({
        interviewId: z.string().uuid(),
        ratings: z.record(z.string(), z.number().min(1).max(5)),
        recommendation: z.enum(['strong_yes', 'yes', 'neutral', 'no', 'strong_no']),
        overallNotes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const interview = await db.interview.findFirst({
        where: { id: input.interviewId, organizationId: ctx.user.organizationId },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      return db.interviewScorecard.upsert({
        where: {
          interviewId_evaluatorId: {
            interviewId: input.interviewId,
            evaluatorId: ctx.user.id,
          },
        },
        create: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
          evaluatorId: ctx.user.id,
          ratings: input.ratings,
          recommendation: input.recommendation,
          overallNotes: input.overallNotes,
          submittedAt: new Date(),
        },
        update: {
          ratings: input.ratings,
          recommendation: input.recommendation,
          overallNotes: input.overallNotes,
          submittedAt: new Date(),
        },
      });
    }),

  // 8.8 — Get interview guide (stub — mock AI)
  getGuide: permissionProcedure('interview', 'read')
    .input(
      z.object({
        interviewId: z.string().uuid(),
        vacancyId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Stub: return a mock AI-generated interview guide
      return {
        interviewId: input.interviewId,
        sections: [
          {
            title: 'Introduccion',
            duration: 5,
            questions: [
              'Cuentame sobre tu experiencia profesional',
              'Que te motiva a aplicar a esta posicion?',
            ],
          },
          {
            title: 'Competencias Tecnicas',
            duration: 20,
            questions: [
              'Describe un proyecto complejo que hayas liderado',
              'Como manejas situaciones de alta presion?',
              'Que herramientas y metodologias prefieres usar?',
            ],
          },
          {
            title: 'Competencias Conductuales',
            duration: 15,
            questions: [
              'Dame un ejemplo de cuando resolviste un conflicto en equipo',
              'Como priorizas tareas cuando tienes multiples plazos?',
            ],
          },
          {
            title: 'Cierre',
            duration: 5,
            questions: [
              'Tienes alguna pregunta sobre la empresa o el rol?',
            ],
          },
        ],
        generatedAt: new Date().toISOString(),
        model: 'mock-ai-v1',
      };
    }),

  // 8.9 — Generate interview summary (stub — mock AI)
  generateSummary: permissionProcedure('interview', 'create')
    .input(z.object({ interviewId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const interview = await db.interview.findFirst({
        where: { id: input.interviewId, organizationId: ctx.user.organizationId },
        include: {
          scorecards: true,
          candidate: { select: { firstName: true, lastName: true } },
        },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      // Stub: create a mock AI-generated summary
      const summary = await db.interviewSummary.upsert({
        where: { interviewId: input.interviewId },
        create: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
          summary: `Resumen de la entrevista con ${interview.candidate.firstName} ${interview.candidate.lastName}. El candidato demostro competencias solidas en las areas evaluadas. Se recomienda avanzar al siguiente paso del proceso.`,
          keyPoints: [
            'Experiencia relevante en el sector',
            'Buena comunicacion y trabajo en equipo',
            'Conocimientos tecnicos adecuados',
          ],
          strengths: [
            'Liderazgo demostrado',
            'Capacidad de resolucion de problemas',
          ],
          concerns: [
            'Disponibilidad para viajar por confirmar',
          ],
          model: 'mock-ai-v1',
        },
        update: {
          summary: `Resumen actualizado de la entrevista con ${interview.candidate.firstName} ${interview.candidate.lastName}.`,
          keyPoints: ['Experiencia relevante', 'Buena comunicacion'],
          strengths: ['Liderazgo', 'Resolucion de problemas'],
          concerns: ['Disponibilidad por confirmar'],
          generatedAt: new Date(),
          model: 'mock-ai-v1',
        },
      });

      return summary;
    }),

  // 8.10 — Detect bias in scorecards (stub — mock AI)
  detectBias: permissionProcedure('interview', 'read')
    .input(z.object({ interviewId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scorecards = await db.interviewScorecard.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
        },
        include: {
          evaluator: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      // Stub: return mock bias analysis
      return {
        interviewId: input.interviewId,
        scorecardsAnalyzed: scorecards.length,
        biasIndicators: [
          {
            type: 'halo_effect',
            severity: 'low',
            description: 'No se detectaron indicadores significativos del efecto halo.',
          },
          {
            type: 'similarity_bias',
            severity: 'none',
            description: 'Las evaluaciones parecen objetivas y basadas en competencias.',
          },
        ],
        overallRisk: 'low',
        recommendations: [
          'Mantener el uso de scorecards estructurados',
          'Asegurar diversidad en el panel de evaluadores',
        ],
        generatedAt: new Date().toISOString(),
        model: 'mock-ai-v1',
      };
    }),

  // 8.11 — Compare evaluator scores
  compareEvaluators: permissionProcedure('interview', 'read')
    .input(z.object({ interviewId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scorecards = await db.interviewScorecard.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
          submittedAt: { not: null },
        },
        include: {
          evaluator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });

      if (scorecards.length === 0) {
        return { interviewId: input.interviewId, evaluators: [], consensus: null };
      }

      const evaluators = scorecards.map((sc) => ({
        evaluator: sc.evaluator,
        recommendation: sc.recommendation,
        ratings: sc.ratings as Record<string, number>,
        submittedAt: sc.submittedAt,
      }));

      // Calculate average ratings across evaluators
      const allCriteria = new Set<string>();
      for (const e of evaluators) {
        for (const key of Object.keys(e.ratings)) {
          allCriteria.add(key);
        }
      }

      const averages: Record<string, number> = {};
      for (const criterion of allCriteria) {
        const scores = evaluators
          .map((e) => e.ratings[criterion])
          .filter((s): s is number => s !== undefined);
        averages[criterion] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      }

      const recommendations = evaluators.map((e) => e.recommendation);
      const consensus =
        new Set(recommendations).size === 1
          ? recommendations[0]
          : null;

      return {
        interviewId: input.interviewId,
        evaluators,
        averageRatings: averages,
        consensus,
      };
    }),

  // 8.12 — Get video token (stub — mock token)
  getVideoToken: permissionProcedure('interview', 'read')
    .input(z.object({ interviewId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const interview = await db.interview.findFirst({
        where: { id: input.interviewId, organizationId: ctx.user.organizationId },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      // Stub: return a mock video session token
      return {
        interviewId: input.interviewId,
        token: `mock-video-token-${input.interviewId}-${Date.now()}`,
        provider: 'mock-provider',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        roomName: `interview-${input.interviewId}`,
      };
    }),

  // 8.13 — Save transcript
  saveTranscript: permissionProcedure('interview', 'update')
    .input(
      z.object({
        interviewId: z.string().uuid(),
        transcriptUrl: z.string().url(),
        recordingUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const interview = await db.interview.findFirst({
        where: { id: input.interviewId, organizationId: ctx.user.organizationId },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      return db.interview.update({
        where: { id: input.interviewId },
        data: {
          transcriptUrl: input.transcriptUrl,
          ...(input.recordingUrl && { recordingUrl: input.recordingUrl }),
        },
      });
    }),

  // 8.14 — List today's interviews
  listToday: permissionProcedure('interview', 'read').query(async ({ ctx }) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return db.interview.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        scheduledAt: { gte: startOfDay, lt: endOfDay },
        status: { not: 'cancelled' },
      },
      include: {
        candidate: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
        vacancy: { select: { id: true, title: true } },
        evaluators: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }),

  // 8.15 — Get pending scorecards for current user
  getPendingScorecards: permissionProcedure('interview', 'read').query(async ({ ctx }) => {
    const evaluatorAssignments = await db.interviewEvaluator.findMany({
      where: {
        userId: ctx.user.id,
        status: 'pending',
        interview: {
          organizationId: ctx.user.organizationId,
          status: { in: ['scheduled', 'rescheduled', 'completed'] },
        },
      },
      include: {
        interview: {
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, avatar: true },
            },
            vacancy: { select: { id: true, title: true } },
            scorecards: {
              where: { evaluatorId: ctx.user.id },
            },
          },
        },
      },
    });

    // Filter out interviews where the user already submitted a scorecard
    return evaluatorAssignments.filter(
      (a) => a.interview.scorecards.length === 0 || a.interview.scorecards[0].submittedAt === null
    );
  }),
});
