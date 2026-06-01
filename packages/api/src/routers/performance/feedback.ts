import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';

export const performanceFeedbackRouter = router({
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
});
