import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure, auditedProcedure } from '../trpc';
import { db } from '@tims/db';
import { createUserSchema, updateProfileSchema, assignRoleSchema } from '@tims/shared';

export const userRouter = router({
  // Get current user profile
  me: protectedProcedure.query(async ({ ctx }) => {
    return db.user.findUnique({
      where: { id: ctx.user.id },
      include: {
        userRoles: {
          include: {
            role: { select: { id: true, name: true, slug: true } },
          },
        },
        teams: {
          include: {
            team: { select: { id: true, name: true } },
          },
        },
      },
    });
  }),

  // Update own profile — strict allowlist (updateProfileSchema) so a user cannot
  // set roleSlug / companyId / businessUnitId / isActive / isPlatformOwner on
  // themselves. Returns only non-sensitive profile fields.
  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      return db.user.update({
        where: { id: ctx.user.id },
        data: input,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          jobTitle: true,
          phone: true,
          locale: true,
          timezone: true,
          avatar: true,
        },
      });
    }),

  // List users (admin)
  list: permissionProcedure('user', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        search: z.string().optional(),
        roleSlug: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, search, roleSlug, isActive } = input;

      const where = {
        organizationId: ctx.user.organizationId,
        ...(isActive !== undefined ? { isActive } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' as const } },
                { lastName: { contains: search, mode: 'insensitive' as const } },
                { email: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(roleSlug
          ? { userRoles: { some: { role: { slug: roleSlug } } } }
          : {}),
      };

      const users = await db.user.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          userRoles: {
            include: {
              role: { select: { name: true, slug: true } },
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (users.length > limit) {
        const nextItem = users.pop();
        nextCursor = nextItem?.id;
      }

      return { users, nextCursor };
    }),

  // Create user (invite)
  create: permissionProcedure('user', 'create')
    .input(createUserSchema)
    .mutation(async ({ ctx, input }) => {
      const { roleSlug, ...userData } = input;

      // Find the role
      const role = await db.role.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          slug: roleSlug,
        },
      });

      if (!role) {
        throw new Error(`Rol '${roleSlug}' no encontrado`);
      }

      // Create user + role assignment in transaction
      return db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            ...userData,
            organizationId: ctx.user.organizationId,
            supabaseUserId: '', // Will be set when user accepts invite
          },
        });

        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
            assignedBy: ctx.user.id,
          },
        });

        return user;
      });
    }),

  // Assign role
  assignRole: permissionProcedure('user', 'update')
    .input(assignRoleSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify user belongs to same organization (IDOR prevention)
      const targetUser = await db.user.findFirst({
        where: { id: input.userId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!targetUser) {
        throw new Error('Usuario no encontrado en esta organizacion');
      }

      const role = await db.role.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          slug: input.roleSlug,
        },
      });

      if (!role) {
        throw new Error(`Rol '${input.roleSlug}' no encontrado`);
      }

      return db.userRole.upsert({
        where: {
          userId_roleId: {
            userId: input.userId,
            roleId: role.id,
          },
        },
        create: {
          userId: input.userId,
          roleId: role.id,
          assignedBy: ctx.user.id,
          companyScope: input.companyScope,
          unitScope: input.unitScope,
        },
        update: {
          companyScope: input.companyScope,
          unitScope: input.unitScope,
        },
      });
    }),

  // Deactivate user
  deactivate: permissionProcedure('user', 'delete')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.user.update({
        where: { id: input.userId, organizationId: ctx.user.organizationId },
        data: { isActive: false, deletedAt: new Date() },
      });
    }),
});
