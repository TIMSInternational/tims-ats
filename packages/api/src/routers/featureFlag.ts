import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db, Prisma } from '@tims/db';
import { cacheGet, cacheSet, cacheInvalidatePrefix } from '../lib/cache';

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
        payload: z.record(z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 20000, 'Payload demasiado grande').nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const result = await db.featureFlag.update({
        where: {
          id,
          organizationId: ctx.user.organizationId,
        },
        data: {
          ...data,
          payload: data.payload === null
            ? Prisma.JsonNull
            : data.payload as unknown as Prisma.InputJsonObject | undefined,
        },
      });
      // Invalidate all cached flag checks for this org so the updated value is
      // reflected within the next check TTL window (5 min).
      await cacheInvalidatePrefix(`tims:flagcheck:${ctx.user.organizationId}:`);
      return result;
    }),

  // Check a single flag by key (lightweight, used by client feature gates)
  check: protectedProcedure
    .input(z.object({ key: z.string().max(200) }))
    .query(async ({ ctx, input }) => {
      type FlagResult = { enabled: boolean; payload: unknown };

      const cacheKey = `tims:flagcheck:${ctx.user.organizationId}:${input.key}`;
      const cached = await cacheGet<FlagResult>(cacheKey);
      if (cached) return cached;

      const flag = await db.featureFlag.findUnique({
        where: {
          organizationId_key: {
            organizationId: ctx.user.organizationId,
            key: input.key,
          },
        },
        select: { enabled: true, payload: true },
      });
      const result: FlagResult = { enabled: flag?.enabled ?? false, payload: flag?.payload ?? null };
      await cacheSet(cacheKey, result, 300);
      return result;
    }),
});
