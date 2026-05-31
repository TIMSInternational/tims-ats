import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { db } from '@tims/db';

export const notificationRouter = router({
  // List notifications for current user
  list: protectedProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(20),
        unreadOnly: z.boolean().default(false),
      })
    )
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
      });

      let nextCursor: string | undefined;
      if (notifications.length > limit) {
        const next = notifications.pop();
        nextCursor = next?.id;
      }

      return { notifications, nextCursor };
    }),

  // Get unread count
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await db.notification.count({
      where: {
        userId: ctx.user.id,
        read: false,
        archived: false,
      },
    });
    return { count };
  }),

  // Mark single notification as read
  markAsRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.notification.updateMany({
        where: { id: input.id, userId: ctx.user.id },
        data: { read: true, readAt: new Date() },
      });
    }),

  // Mark all notifications as read
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    return db.notification.updateMany({
      where: { userId: ctx.user.id, read: false },
      data: { read: true, readAt: new Date() },
    });
  }),

  // Archive a notification
  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.notification.updateMany({
        where: { id: input.id, userId: ctx.user.id },
        data: { archived: true },
      });
    }),

  // Get preferences
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    let prefs = await db.notificationPreference.findUnique({ where: { userId: ctx.user.id } });
    if (!prefs) {
      prefs = await db.notificationPreference.create({
        data: { userId: ctx.user.id },
      });
    }
    return prefs;
  }),

  // Update preferences
  updatePreferences: protectedProcedure
    .input(z.object({
      emailEnabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      categories: z.record(z.boolean()).optional(),
      modules: z.record(z.boolean()).optional(),
      quietHoursStart: z.string().nullable().optional(),
      quietHoursEnd: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.notificationPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, ...input as any },
        update: input as any,
      });
    }),

  // Archive all read
  archiveAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    return db.notification.updateMany({
      where: { userId: ctx.user.id, read: true, archived: false },
      data: { archived: true },
    });
  }),

  // Delete notification
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.notification.deleteMany({
        where: { id: input.id, userId: ctx.user.id },
      });
    }),

  // Create notification (internal — called by other routers/workers)
  create: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        type: z.enum(['critical', 'warning', 'info', 'success']),
        title: z.string(),
        message: z.string().optional(),
        module: z.string().optional(),
        entityType: z.string().optional(),
        entityId: z.string().uuid().optional(),
        actionUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.notification.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId || null,
        },
      });
    }),

  // Bulk create (for system events)
  bulkCreate: protectedProcedure
    .input(
      z.object({
        userIds: z.array(z.string().uuid()),
        type: z.enum(['critical', 'warning', 'info', 'success']),
        title: z.string(),
        message: z.string().optional(),
        module: z.string().optional(),
        entityType: z.string().optional(),
        entityId: z.string().uuid().optional(),
        actionUrl: z.string().optional(),
      })
    )
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
