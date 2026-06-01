import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';

export const performanceCoachingRouter = router({
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
});
