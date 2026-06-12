import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { videoService } from '../../services/video.service';
import { assertScoped, scopeWhereFor } from '../../access';

export const interviewMediaRouter = router({
  // 8.12a — Create or reuse a Daily.co video room for an interview
  // Room name is deterministic per interview — same interview always gets same room
  createVideoRoom: permissionProcedure('interview', 'create')
    .input(z.object({ interviewId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);

      // Compose scope into the existing findFirst which also fetches meetingUrl
      // (used below) — cannot replace with bare assertScoped.
      const interview = await db.interview.findFirst({
        where: {
          AND: [
            { id: input.interviewId, organizationId: ctx.user.organizationId },
            scopeWhere as Prisma.InterviewWhereInput,
          ],
        },
        select: { id: true, meetingUrl: true },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      const currentUser = await db.user.findUnique({
        where: { id: ctx.user.id },
        select: { firstName: true, lastName: true },
      });
      const userName = [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ') || 'Evaluator';

      // If room already exists, reuse it — just generate a fresh token
      if (interview.meetingUrl) {
        const urlParts = interview.meetingUrl.split('/');
        const existingRoomName = urlParts[urlParts.length - 1] ?? '';
        if (existingRoomName) {
          const token = await videoService.createMeetingToken(existingRoomName, userName, true);
          return { url: interview.meetingUrl, token, roomName: existingRoomName };
        }
      }

      // First time — create room, store URL, generate token
      const { url, roomName } = await videoService.createRoom(input.interviewId);
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
      const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);

      // Compose scope into the existing findFirst which also fetches meetingUrl
      // (used for room-name extraction below) — cannot replace with bare assertScoped.
      const interview = await db.interview.findFirst({
        where: {
          AND: [
            { id: input.interviewId, organizationId: ctx.user.organizationId },
            scopeWhere as Prisma.InterviewWhereInput,
          ],
        },
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
      // assertScoped replaces the bare org-check findFirst — saveTranscript only
      // uses the probe result as an existence check (no fields consumed after).
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);

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
    const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);

    return db.interview.findMany({
      where: {
        AND: [
          {
            organizationId: ctx.user.organizationId,
            scheduledAt: { gte: startOfDay, lt: endOfDay },
            status: { not: 'cancelled' },
          },
          scopeWhere as Prisma.InterviewWhereInput,
        ],
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
