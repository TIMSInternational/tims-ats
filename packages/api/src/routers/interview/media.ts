import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const interviewMediaRouter = router({
  // 8.12 — Get video token (stub -- mock token)
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
});
