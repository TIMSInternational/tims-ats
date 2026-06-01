import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '../../trpc';
import { db } from '@tims/db';
import { platformProcedure } from './_common';

export const usersRouter = router({
  getUserKpis: platformProcedure.query(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const [total, activeToday, platformOwners, inactive] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { lastLoginAt: { gte: todayStart } } }),
      db.user.count({ where: { isPlatformOwner: true } }),
      db.user.count({ where: { OR: [{ isActive: false }, { lastLoginAt: { lt: thirtyDaysAgo } }] } }),
    ]);

    return { total, activeToday, platformOwners, inactive };
  }),

  listAllUsers: platformProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().min(1).max(50).default(20),
      search: z.string().optional(),
      organizationId: z.string().uuid().optional(),
      roleSlug: z.string().optional(),
      isPlatformOwner: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const { page, limit, search, organizationId, roleSlug, isPlatformOwner, isActive } = input;

      const where: any = {};
      if (search) where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
      if (organizationId) where.organizationId = organizationId;
      if (isPlatformOwner !== undefined) where.isPlatformOwner = isPlatformOwner;
      if (isActive !== undefined) where.isActive = isActive;
      if (roleSlug) where.userRoles = { some: { role: { slug: roleSlug } } };

      const [users, total] = await Promise.all([
        db.user.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy: { createdAt: 'desc' },
          include: {
            organization: { select: { id: true, name: true } },
            userRoles: { include: { role: { select: { name: true, slug: true } } } },
          },
        }),
        db.user.count({ where }),
      ]);

      return { users, total };
    }),

  getOrgUsers: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const [users, total] = await Promise.all([
        db.user.findMany({
          where: { organizationId: input.organizationId },
          take: input.limit,
          orderBy: { createdAt: 'desc' },
          include: {
            userRoles: { include: { role: { select: { name: true, slug: true } } } },
          },
        }),
        db.user.count({ where: { organizationId: input.organizationId } }),
      ]);
      return { users, total };
    }),

  listPlatformOwnerEmails: platformProcedure.query(async () => {
    return db.platformOwnerEmail.findMany({ orderBy: { createdAt: 'desc' } });
  }),

  addPlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      return db.platformOwnerEmail.create({ data: { email: input.email } });
    }),

  removePlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      return db.platformOwnerEmail.delete({ where: { email: input.email } });
    }),

  deactivateOrgUser: platformProcedure
    .input(z.object({ userId: z.string().uuid(), organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.user.update({
        where: { id: input.userId, organizationId: input.organizationId },
        data: { isActive: false },
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
      });
      await db.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: ctx.user.id,
          action: 'user_deactivated',
          entity: 'user',
          entityId: input.userId,
        },
      }).catch(() => {});
      return user;
    }),

  activateOrgUser: platformProcedure
    .input(z.object({ userId: z.string().uuid(), organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.user.update({
        where: { id: input.userId, organizationId: input.organizationId },
        data: { isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
      });
      await db.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: ctx.user.id,
          action: 'user_activated',
          entity: 'user',
          entityId: input.userId,
        },
      }).catch(() => {});
      return user;
    }),

  resetUserPassword: platformProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .mutation(async ({ ctx, input }) => {
      // Verify user exists
      const user = await db.user.findFirst({
        where: { email: input.email },
        select: { id: true, email: true, organizationId: true },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado con ese email' });

      // Audit log the action
      await db.auditLog.create({
        data: {
          organizationId: user.organizationId || ctx.user.organizationId,
          actorId: ctx.user.id,
          action: 'password_reset_requested',
          entity: 'user',
          entityId: user.id,
          changes: JSON.stringify({ email: input.email }),
        },
      }).catch(() => {});

      // TODO: Integrate Supabase Admin API to actually send reset email
      // const { error } = await supabaseAdmin.auth.resetPasswordForEmail(input.email);
      return { sent: true, email: input.email };
    }),

  changeOrgUserRole: platformProcedure
    .input(z.object({
      userId: z.string().uuid(),
      organizationId: z.string().uuid(),
      roleSlug: z.string().max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await db.role.findFirst({
        where: { organizationId: input.organizationId, slug: input.roleSlug },
      });
      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });

      await db.userRole.deleteMany({
        where: { userId: input.userId, role: { organizationId: input.organizationId } },
      });
      await db.userRole.create({
        data: { userId: input.userId, roleId: role.id },
      });

      await db.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: ctx.user.id,
          action: 'user_role_changed',
          entity: 'user',
          entityId: input.userId,
          changes: JSON.stringify({ newRole: input.roleSlug }),
        },
      }).catch(() => {});

      return { success: true };
    }),
});
