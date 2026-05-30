import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

export const performanceRouter = router({
  // 11.1 — List OKRs
  listOkrs: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        userId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
        period: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, userId, teamId, period, status } = input;

      const where = {
        organizationId: ctx.user.organizationId,
        ...(userId ? { userId } : {}),
        ...(teamId ? { teamId } : {}),
        ...(period ? { period } : {}),
        ...(status ? { status } : {}),
      };

      const okrs = await db.okr.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          team: { select: { id: true, name: true } },
          keyResults: true,
        },
      });

      let nextCursor: string | undefined;
      if (okrs.length > limit) {
        const nextItem = okrs.pop();
        nextCursor = nextItem?.id;
      }

      return { okrs, nextCursor };
    }),

  // 11.2 — Get OKR by ID
  getOkrById: permissionProcedure('performance', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const okr = await db.okr.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.user.organizationId,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
          team: { select: { id: true, name: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          keyResults: { orderBy: { updatedAt: 'desc' } },
        },
      });

      if (!okr) {
        throw new Error('OKR no encontrado');
      }

      return okr;
    }),

  // 11.3 — Create OKR
  createOkr: permissionProcedure('performance', 'create')
    .input(
      z.object({
        userId: z.string().uuid(),
        teamId: z.string().uuid().optional(),
        title: z.string().min(1).max(500),
        period: z.string(),
        keyResults: z
          .array(
            z.object({
              title: z.string().min(1).max(500),
              targetValue: z.number(),
              unit: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { keyResults, ...okrData } = input;

      return db.okr.create({
        data: {
          ...okrData,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          ...(keyResults && keyResults.length > 0
            ? {
                keyResults: {
                  create: keyResults.map((kr) => ({
                    ...kr,
                    organizationId: ctx.user.organizationId,
                  })),
                },
              }
            : {}),
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          keyResults: true,
        },
      });
    }),

  // 11.4 — Update OKR
  updateOkr: permissionProcedure('performance', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        period: z.string().optional(),
        status: z.string().optional(),
        progress: z.number().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;

      return db.okr.update({
        where: { id },
        data,
        include: { keyResults: true },
      });
    }),

  // 11.5 — Update Key Result
  updateKeyResult: permissionProcedure('performance', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        currentValue: z.number().optional(),
        targetValue: z.number().optional(),
        status: z.string().optional(),
        title: z.string().min(1).max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;

      const keyResult = await db.keyResult.update({
        where: { id },
        data,
        include: { okr: { select: { id: true } } },
      });

      // Recalculate OKR progress from all key results
      const allKrs = await db.keyResult.findMany({
        where: { okrId: keyResult.okr.id },
      });

      if (allKrs.length > 0) {
        const avgProgress =
          allKrs.reduce((sum, kr) => {
            const pct = kr.targetValue > 0 ? (kr.currentValue / kr.targetValue) * 100 : 0;
            return sum + Math.min(100, pct);
          }, 0) / allKrs.length;

        await db.okr.update({
          where: { id: keyResult.okr.id },
          data: { progress: Math.round(avgProgress) },
        });
      }

      return keyResult;
    }),

  // 11.6 — List coaching sessions
  listCoachingSessions: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        employeeId: z.string().uuid().optional(),
        leaderId: z.string().uuid().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, employeeId, leaderId, status } = input;

      const where = {
        organizationId: ctx.user.organizationId,
        ...(employeeId ? { employeeId } : {}),
        ...(leaderId ? { leaderId } : {}),
        ...(status ? { status } : {}),
      };

      const sessions = await db.coachingSession.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { scheduledAt: 'desc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          leader: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          _count: { select: { commitments: true } },
        },
      });

      let nextCursor: string | undefined;
      if (sessions.length > limit) {
        const nextItem = sessions.pop();
        nextCursor = nextItem?.id;
      }

      return { sessions, nextCursor };
    }),

  // 11.7 — Create coaching session
  createCoachingSession: permissionProcedure('performance', 'create')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        leaderId: z.string().uuid(),
        scheduledAt: z.coerce.date(),
        duration: z.number().int().positive().optional(),
        topic: z.string().min(1).max(500),
        type: z.string().default('scheduled'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.coachingSession.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          leader: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    }),

  // 11.8 — Complete coaching session
  completeCoachingSession: permissionProcedure('performance', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        notes: z.string().optional(),
        duration: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;

      return db.coachingSession.update({
        where: { id },
        data: {
          ...data,
          status: 'completed',
        },
        include: {
          commitments: true,
        },
      });
    }),

  // 11.9 — List commitments
  listCommitments: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        employeeId: z.string().uuid().optional(),
        coachingSessionId: z.string().uuid().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, employeeId, coachingSessionId, status } = input;

      const where = {
        organizationId: ctx.user.organizationId,
        ...(employeeId ? { employeeId } : {}),
        ...(coachingSessionId ? { coachingSessionId } : {}),
        ...(status ? { status } : {}),
      };

      const commitments = await db.commitment.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { dueDate: 'asc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          session: { select: { id: true, topic: true, scheduledAt: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      let nextCursor: string | undefined;
      if (commitments.length > limit) {
        const nextItem = commitments.pop();
        nextCursor = nextItem?.id;
      }

      return { commitments, nextCursor };
    }),

  // 11.10 — Create commitment
  createCommitment: permissionProcedure('performance', 'create')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        coachingSessionId: z.string().uuid().optional(),
        description: z.string().min(1).max(1000),
        dueDate: z.coerce.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.commitment.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    }),

  // 11.11 — Update commitment
  updateCommitment: permissionProcedure('performance', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        description: z.string().min(1).max(1000).optional(),
        dueDate: z.coerce.date().optional(),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, status, ...rest } = input;

      return db.commitment.update({
        where: { id },
        data: {
          ...rest,
          ...(status ? { status } : {}),
          ...(status === 'completed' ? { completedAt: new Date() } : {}),
        },
      });
    }),

  // 11.12 — Submit feedback
  submitFeedback: protectedProcedure
    .input(
      z.object({
        toUserId: z.string().uuid(),
        type: z.string(),
        message: z.string().min(1).max(2000),
        isAnonymous: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.feedback.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          fromUserId: ctx.user.id,
        },
      });
    }),

  // 11.13 — List feedback
  listFeedback: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        toUserId: z.string().uuid().optional(),
        fromUserId: z.string().uuid().optional(),
        type: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, toUserId, fromUserId, type } = input;

      const where = {
        organizationId: ctx.user.organizationId,
        ...(toUserId ? { toUserId } : {}),
        ...(fromUserId ? { fromUserId } : {}),
        ...(type ? { type } : {}),
      };

      const feedbacks = await db.feedback.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          fromUser: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          toUser: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });

      let nextCursor: string | undefined;
      if (feedbacks.length > limit) {
        const nextItem = feedbacks.pop();
        nextCursor = nextItem?.id;
      }

      // Strip sender info for anonymous feedback
      const sanitized = feedbacks.map((fb) => ({
        ...fb,
        fromUser: fb.isAnonymous ? null : fb.fromUser,
        fromUserId: fb.isAnonymous ? null : fb.fromUserId,
      }));

      return { feedbacks: sanitized, nextCursor };
    }),

  // 11.14 — Give recognition
  giveRecognition: protectedProcedure
    .input(
      z.object({
        toUserId: z.string().uuid(),
        category: z.string(),
        message: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.recognition.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          fromUserId: ctx.user.id,
        },
        include: {
          toUser: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    }),

  // 11.15 — List recognitions
  listRecognitions: protectedProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        toUserId: z.string().uuid().optional(),
        category: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, toUserId, category } = input;

      const where = {
        organizationId: ctx.user.organizationId,
        ...(toUserId ? { toUserId } : {}),
        ...(category ? { category } : {}),
      };

      const recognitions = await db.recognition.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          fromUser: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          toUser: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });

      let nextCursor: string | undefined;
      if (recognitions.length > limit) {
        const nextItem = recognitions.pop();
        nextCursor = nextItem?.id;
      }

      return { recognitions, nextCursor };
    }),

  // 11.16 — Dashboard KPIs
  getDashboardKpis: permissionProcedure('performance', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [
      activeOkrs,
      avgOkrProgress,
      scheduledSessions,
      completedSessions,
      pendingCommitments,
      completedCommitments,
      totalFeedback,
      totalRecognitions,
    ] = await Promise.all([
      db.okr.count({
        where: { organizationId: orgId, status: 'active' },
      }),
      db.okr.aggregate({
        where: { organizationId: orgId, status: 'active' },
        _avg: { progress: true },
      }),
      db.coachingSession.count({
        where: { organizationId: orgId, status: 'scheduled' },
      }),
      db.coachingSession.count({
        where: { organizationId: orgId, status: 'completed' },
      }),
      db.commitment.count({
        where: { organizationId: orgId, status: 'pending' },
      }),
      db.commitment.count({
        where: { organizationId: orgId, status: 'completed' },
      }),
      db.feedback.count({
        where: { organizationId: orgId },
      }),
      db.recognition.count({
        where: { organizationId: orgId },
      }),
    ]);

    return {
      activeOkrs,
      averageOkrProgress: Math.round(avgOkrProgress._avg.progress ?? 0),
      scheduledSessions,
      completedSessions,
      pendingCommitments,
      completedCommitments,
      commitmentCompletionRate:
        pendingCommitments + completedCommitments > 0
          ? Math.round(
              (completedCommitments / (pendingCommitments + completedCommitments)) * 100
            )
          : 0,
      totalFeedback,
      totalRecognitions,
    };
  }),

  // 11.17 — Low progress alerts (OKRs below threshold)
  getLowProgressAlerts: permissionProcedure('performance', 'read')
    .input(
      z.object({
        threshold: z.number().min(0).max(100).default(30),
        period: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { threshold, period } = input;

      const lowOkrs = await db.okr.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          status: 'active',
          progress: { lt: threshold },
          ...(period ? { period } : {}),
        },
        orderBy: { progress: 'asc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          team: { select: { id: true, name: true } },
          keyResults: true,
        },
      });

      const overdueCommitments = await db.commitment.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          status: 'pending',
          dueDate: { lt: new Date() },
        },
        orderBy: { dueDate: 'asc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
        take: 50,
      });

      return {
        lowProgressOkrs: lowOkrs,
        overdueCommitments,
        totalAlerts: lowOkrs.length + overdueCommitments.length,
      };
    }),
});
