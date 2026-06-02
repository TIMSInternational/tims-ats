import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { db } from '@tims/db';

const notificationSelect = {
  id: true,
  type: true,
  title: true,
  message: true,
  module: true,
  read: true,
  readAt: true,
  entityType: true,
  entityId: true,
  actionUrl: true,
  createdAt: true,
} as const;

export const notificationRouter = router({
  list: protectedProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(20),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const { cursor, limit, unreadOnly } = input;

      const notifications = await db.notification.findMany({
        where: {
          userId: ctx.user.id,
          archived: false,
          ...(unreadOnly ? { read: false } : {}),
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        select: notificationSelect,
      });

      let nextCursor: string | undefined;
      if (notifications.length > limit) {
        const next = notifications.pop();
        nextCursor = next?.id;
      }

      return { notifications, nextCursor };
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await db.notification.count({
      where: { userId: ctx.user.id, read: false, archived: false },
    });
    return { count };
  }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.notification.updateMany({
        where: { id: input.id, userId: ctx.user.id },
        data: { read: true, readAt: new Date() },
      });
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    return db.notification.updateMany({
      where: { userId: ctx.user.id, read: false },
      data: { read: true, readAt: new Date() },
    });
  }),

  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.notification.updateMany({
        where: { id: input.id, userId: ctx.user.id },
        data: { archived: true },
      });
    }),

  archiveAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    return db.notification.updateMany({
      where: { userId: ctx.user.id, read: true, archived: false },
      data: { archived: true },
    });
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.notification.deleteMany({
        where: { id: input.id, userId: ctx.user.id },
      });
    }),

  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    let prefs = await db.notificationPreference.findUnique({
      where: { userId: ctx.user.id },
      select: {
        emailEnabled: true,
        pushEnabled: true,
        categories: true,
        modules: true,
        quietHoursStart: true,
        quietHoursEnd: true,
      },
    });
    if (!prefs) {
      prefs = await db.notificationPreference.create({
        data: { userId: ctx.user.id },
        select: {
          emailEnabled: true,
          pushEnabled: true,
          categories: true,
          modules: true,
          quietHoursStart: true,
          quietHoursEnd: true,
        },
      });
    }
    return prefs;
  }),

  updatePreferences: protectedProcedure
    .input(z.object({
      emailEnabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      categories: z.record(z.boolean()).optional(),
      modules: z.record(z.boolean()).optional(),
      quietHoursStart: z.string().max(10).nullable().optional(),
      quietHoursEnd: z.string().max(10).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.emailEnabled !== undefined) data.emailEnabled = input.emailEnabled;
      if (input.pushEnabled !== undefined) data.pushEnabled = input.pushEnabled;
      if (input.categories !== undefined) data.categories = input.categories;
      if (input.modules !== undefined) data.modules = input.modules;
      if (input.quietHoursStart !== undefined) data.quietHoursStart = input.quietHoursStart;
      if (input.quietHoursEnd !== undefined) data.quietHoursEnd = input.quietHoursEnd;

      return db.notificationPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, ...data },
        update: data,
        select: { emailEnabled: true, pushEnabled: true },
      });
    }),

  create: protectedProcedure
    .input(z.object({
      userId: z.string().uuid(),
      type: z.enum(['critical', 'warning', 'info', 'success']),
      title: z.string().min(1).max(200),
      message: z.string().max(1000).optional(),
      module: z.string().max(50).optional(),
      entityType: z.string().max(50).optional(),
      entityId: z.string().uuid().optional(),
      actionUrl: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.notification.create({
        data: { ...input, organizationId: ctx.user.organizationId || null },
        select: notificationSelect,
      });
    }),

  bulkCreate: protectedProcedure
    .input(z.object({
      userIds: z.array(z.string().uuid()).min(1).max(500),
      type: z.enum(['critical', 'warning', 'info', 'success']),
      title: z.string().min(1).max(200),
      message: z.string().max(1000).optional(),
      module: z.string().max(50).optional(),
      entityType: z.string().max(50).optional(),
      entityId: z.string().uuid().optional(),
      actionUrl: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { userIds, ...data } = input;
      return db.notification.createMany({
        data: userIds.map((userId) => ({
          ...data,
          userId,
          organizationId: ctx.user.organizationId || null,
        })),
      });
    }),
});
