import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

export const featureFlagRouter = router({
  // List all feature flags for the organization
  list: permissionProcedure('feature_flags', 'read').query(async ({ ctx }) => {
    return db.featureFlag.findMany({
      where: { organizationId: ctx.user.organizationId },
      orderBy: { key: 'asc' },
    });
  }),

  // Update a feature flag
  update: permissionProcedure('feature_flags', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        enabled: z.boolean().optional(),
        payload: z.record(z.unknown()).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return db.featureFlag.update({
        where: {
          id,
          organizationId: ctx.user.organizationId,
        },
        data,
      });
    }),

  // Check a single flag by key (lightweight, used by client feature gates)
  check: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ ctx, input }) => {
      const flag = await db.featureFlag.findUnique({
        where: {
          organizationId_key: {
            organizationId: ctx.user.organizationId,
            key: input.key,
          },
        },
        select: { enabled: true, payload: true },
      });
      return { enabled: flag?.enabled ?? false, payload: flag?.payload ?? null };
    }),
});
