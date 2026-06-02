import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { videoService } from '../../services/video.service';

export const interviewMediaRouter = router({
  // 8.12a — Create a Daily.co video room for an interview
  createVideoRoom: permissionProcedure('interview', 'create')
    .input(z.object({ interviewId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const interview = await db.interview.findFirst({
        where: { id: input.interviewId, organizationId: ctx.user.organizationId },
        select: { id: true, meetingUrl: true },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      const { url, roomName } = await videoService.createRoom(input.interviewId);

      const currentUser = await db.user.findUnique({
        where: { id: ctx.user.id },
        select: { firstName: true, lastName: true },
      });
      const userName = [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ') || 'Evaluator';
      const token = await videoService.createMeetingToken(roomName, userName, true);

      await db.interview.update({
        where: { id: input.interviewId },
        data: { meetingUrl: url },
      });

      return { url, token, roomName };
    }),

  // 8.12b — Get a video token for an existing room
  getVideoToken: permissionProcedure('interview', 'read')
    .input(z.object({ interviewId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const interview = await db.interview.findFirst({
        where: { id: input.interviewId, organizationId: ctx.user.organizationId },
        select: { id: true, meetingUrl: true },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      if (!interview.meetingUrl) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esta entrevista no tiene sala de video. Cree una primero.',
        });
      }

      // Extract room name from Daily URL: https://DOMAIN.daily.co/ROOM_NAME
      const urlParts = interview.meetingUrl.split('/');
      const roomName = urlParts[urlParts.length - 1];

      if (!roomName) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'No se pudo extraer el nombre de la sala del URL de la reunión',
        });
      }

      const currentUser = await db.user.findUnique({
        where: { id: ctx.user.id },
        select: { firstName: true, lastName: true },
      });
      const userName = [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ') || 'Participant';
      const token = await videoService.createMeetingToken(roomName, userName, false);

      return { url: interview.meetingUrl, token };
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
