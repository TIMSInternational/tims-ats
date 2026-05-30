import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { db } from '@tims/db';

export const authRouter = router({
  // Called after Supabase auth — syncs user to our database
  syncUser: publicProcedure
    .input(
      z.object({
        supabaseUserId: z.string(),
        email: z.string().email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        avatar: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Find existing user by supabase ID
      const existing = await db.user.findUnique({
        where: { supabaseUserId: input.supabaseUserId },
        include: {
          userRoles: {
            include: { role: true },
          },
        },
      });

      if (existing) {
        // Update last login
        await db.user.update({
          where: { id: existing.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          user: existing,
          roles: existing.userRoles.map((ur) => ur.role.slug),
          organizationId: existing.organizationId,
        };
      }

      // New user — check if they were pre-created (invited)
      const invited = await db.user.findFirst({
        where: {
          email: input.email,
          supabaseUserId: '',
        },
        include: {
          userRoles: {
            include: { role: true },
          },
        },
      });

      if (invited) {
        // Link supabase account to invited user
        const updated = await db.user.update({
          where: { id: invited.id },
          data: {
            supabaseUserId: input.supabaseUserId,
            firstName: input.firstName || invited.firstName,
            lastName: input.lastName || invited.lastName,
            avatar: input.avatar,
            lastLoginAt: new Date(),
          },
          include: {
            userRoles: { include: { role: true } },
          },
        });

        return {
          user: updated,
          roles: updated.userRoles.map((ur) => ur.role.slug),
          organizationId: updated.organizationId,
        };
      }

      // Completely new user — shouldn't happen without invite in production
      // For now, return null to indicate no org found
      return null;
    }),

  // Get session info (current user + org + permissions)
  getSessionInfo: protectedProcedure.query(async ({ ctx }) => {
    const user = await db.user.findUnique({
      where: { id: ctx.user.id },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, logo: true, plan: true },
        },
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) return null;

    // Flatten permissions
    const permissions = user.userRoles.flatMap((ur) =>
      ur.role.rolePermissions.map((rp) => ({
        module: rp.permission.module,
        action: rp.permission.action,
        scope: rp.scope,
      }))
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName || `${user.firstName} ${user.lastName}`,
        avatar: user.avatar,
        locale: user.locale,
      },
      organization: user.organization,
      roles: user.userRoles.map((ur) => ur.role.slug),
      permissions,
    };
  }),
});
