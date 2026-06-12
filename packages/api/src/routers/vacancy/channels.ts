import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { scopeWhereFor, assertScoped } from '../../access';

const channelSelect = {
  id: true,
  channelName: true,
  channelType: true,
  status: true,
  publishedAt: true,
  unpublishedAt: true,
  stats: true,
  createdAt: true,
} as const;

export const vacancyChannelsRouter = router({
  listChannels: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('vacancy', ctx.access, ctx.user.id);
      const vacancy = await db.vacancy.findFirst({
        where: {
          AND: [
            { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
            scopeWhere as Prisma.VacancyWhereInput,
          ],
        },
        select: { id: true },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.publicationChannel.findMany({
        where: { vacancyId: input.vacancyId, organizationId: ctx.user.organizationId },
        orderBy: { createdAt: 'desc' },
        select: channelSelect,
      });
    }),

  publish: permissionProcedure('vacancy', 'publish')
    .input(z.object({
      vacancyId: z.string().uuid(),
      channelName: z.string().min(1).max(100),
      channelType: z.enum(['internal', 'linkedin', 'indeed', 'computrabajo', 'elempleo', 'website', 'other']),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const vacancy = await db.vacancy.findFirst({
        where: {
          id: input.vacancyId,
          organizationId: ctx.user.organizationId,
          status: { in: ['approved', 'published'] },
          deletedAt: null,
        },
        select: { id: true, status: true },
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
        select: channelSelect,
      });

      if (vacancy.status !== 'published') {
        await db.vacancy.update({
          where: { id: input.vacancyId },
          data: { status: 'published' },
        });
      }

      return channel;
    }),

  unpublish: permissionProcedure('vacancy', 'publish')
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await db.publicationChannel.findFirst({
        where: { id: input.channelId, organizationId: ctx.user.organizationId },
        select: { id: true, vacancyId: true },
      });
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Canal no encontrado' });
      }

      // Scope-probe the parent vacancy: a narrow-scoped user must not unpublish
      // a channel on an out-of-scope vacancy (the channel itself carries no anchor).
      await assertScoped('vacancy', channel.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.publicationChannel.update({
        where: { id: input.channelId },
        data: { status: 'unpublished', unpublishedAt: new Date() },
        select: channelSelect,
      });
    }),
});
