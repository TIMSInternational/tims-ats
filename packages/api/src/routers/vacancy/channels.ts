import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const vacancyChannelsRouter = router({
  // 4.15 — List publication channels for a vacancy
  listChannels: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.publicationChannel.findMany({
        where: { vacancyId: input.vacancyId, organizationId: ctx.user.organizationId },
        orderBy: { createdAt: 'desc' },
      });
    }),

  // 4.16 — Publish vacancy to a channel
  publish: permissionProcedure('vacancy', 'publish')
    .input(z.object({
      vacancyId: z.string().uuid(),
      channelName: z.string().min(1),
      channelType: z.enum(['internal', 'linkedin', 'indeed', 'computrabajo', 'elempleo', 'website', 'other']),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: {
          id: input.vacancyId,
          organizationId: ctx.user.organizationId,
          status: { in: ['approved', 'published'] },
          deletedAt: null,
        },
      });
      if (!vacancy) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'La vacante debe estar aprobada para publicar',
        });
      }

      const channel = await db.publicationChannel.create({
        data: {
          organizationId: ctx.user.organizationId,
          vacancyId: input.vacancyId,
          channelName: input.channelName,
          channelType: input.channelType,
          status: 'published',
          publishedAt: new Date(),
        },
      });

      // Update vacancy status to published if not already
      if (vacancy.status !== 'published') {
        await db.vacancy.update({
          where: { id: input.vacancyId },
          data: { status: 'published' },
        });
      }

      return channel;
    }),

  // 4.17 — Unpublish vacancy from a channel
  unpublish: permissionProcedure('vacancy', 'publish')
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await db.publicationChannel.findFirst({
        where: { id: input.channelId, organizationId: ctx.user.organizationId },
      });
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Canal no encontrado' });
      }

      return db.publicationChannel.update({
        where: { id: input.channelId },
        data: { status: 'unpublished', unpublishedAt: new Date() },
      });
    }),
});
