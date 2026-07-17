import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getAppUrl, ASSIGNABLE_STAFF_ROLES } from '@tims/shared';
import { router } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { platformProcedure } from './_common';
import { logPlatformExport } from '../../access/security-audit';
import { invalidatePermissionCache } from '../../lib/cache';

const userListSelect = {
  id: true,
  organizationId: true,
  email: true,
  firstName: true,
  lastName: true,
  avatar: true,
  jobTitle: true,
  isPlatformOwner: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true } },
  userRoles: {
    select: { role: { select: { name: true, slug: true } } },
  },
} as const;

export const usersRouter = router({
  getUserKpis: platformProcedure.query(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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
      limit: z.number().int().min(1).max(50).default(20),
      search: z.string().max(100).optional(),
      organizationId: z.string().uuid().optional(),
      roleSlug: z.string().max(50).optional(),
      isPlatformOwner: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortBy: z.enum(['name', 'email', 'createdAt', 'lastLoginAt']).default('createdAt'),
      sortDirection: z.enum(['asc', 'desc']).default('desc'),
    }))
    .query(async ({ input }) => {
      const { page, limit, search, organizationId, roleSlug, isPlatformOwner, isActive, sortBy, sortDirection } = input;

      const where: Prisma.UserWhereInput = {};
      if (search?.trim()) {
        where.OR = [
          { firstName: { contains: search.trim(), mode: 'insensitive' } },
          { lastName: { contains: search.trim(), mode: 'insensitive' } },
          { email: { contains: search.trim(), mode: 'insensitive' } },
        ];
      }
      if (organizationId) where.organizationId = organizationId;
      if (isPlatformOwner !== undefined) where.isPlatformOwner = isPlatformOwner;
      if (isActive !== undefined) where.isActive = isActive;
      if (roleSlug) where.userRoles = { some: { role: { slug: roleSlug } } };

      const orderBy = sortBy === 'name'
        ? { firstName: sortDirection } as const
        : { [sortBy]: sortDirection };

      const [users, total] = await Promise.all([
        db.user.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy,
          select: userListSelect,
        }),
        db.user.count({ where }),
      ]);

      return { users, total };
    }),

  getOrgUsers: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const [users, total] = await Promise.all([
        db.user.findMany({
          where: { organizationId: input.organizationId },
          take: input.limit,
          orderBy: { createdAt: 'desc' },
          select: userListSelect,
        }),
        db.user.count({ where: { organizationId: input.organizationId } }),
      ]);
      return { users, total };
    }),

  listOrganizationsMinimal: platformProcedure.query(async () => {
    return db.organization.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }),

  listPlatformOwnerEmails: platformProcedure.query(async () => {
    return db.platformOwnerEmail.findMany({
      select: { email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }),

  addPlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .mutation(async ({ input }) => {
      return db.platformOwnerEmail.create({
        data: { email: input.email },
        select: { email: true, createdAt: true },
      });
    }),

  removePlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .mutation(async ({ input }) => {
      return db.platformOwnerEmail.delete({
        where: { email: input.email },
        select: { email: true },
      });
    }),

  deactivateOrgUser: platformProcedure
    .input(z.object({ userId: z.string().uuid(), organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.user.findFirst({
        where: { id: input.userId, organizationId: input.organizationId },
        select: { id: true, isPlatformOwner: true },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
      if (user.isPlatformOwner) throw new TRPCError({ code: 'FORBIDDEN', message: 'No se puede desactivar un platform owner' });

      const updated = await db.user.update({
        where: { id: input.userId },
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
      return updated;
    }),

  activateOrgUser: platformProcedure
    .input(z.object({ userId: z.string().uuid(), organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.user.findFirst({
        where: { id: input.userId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });

      const updated = await db.user.update({
        where: { id: input.userId },
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
      return updated;
    }),

  resetUserPassword: platformProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.user.findFirst({
        where: { email: input.email },
        select: { id: true, email: true, organizationId: true },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado con ese email' });

      // Actually trigger a Supabase recovery email — same mechanism as the
      // self-serve /forgot-password flow (resetPasswordForEmail → the recovery
      // link lands on /reset-password, which calls updateUser({ password })).
      // Previously this was a no-op that returned { sent: true } without
      // sending anything (rule #4: the UI claimed an email was sent).
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceKey) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Servicio de autenticacion no configurado',
        });
      }
      const { createClient } = await import('@supabase/supabase-js');
      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const appUrl = getAppUrl();
      const { error } = await admin.auth.resetPasswordForEmail(input.email, {
        redirectTo: `${appUrl}/reset-password`,
      });
      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'No se pudo enviar el correo de restablecimiento',
        });
      }

      await db.auditLog.create({
        data: {
          organizationId: user.organizationId || ctx.user.organizationId,
          actorId: ctx.user.id,
          action: 'password_reset_requested',
          entity: 'user',
          entityId: user.id,
          metadata: { email: input.email },
        },
      }).catch(() => {});

      return { sent: true, email: input.email };
    }),

  // Force-logout: revoke ALL of a user's Supabase sessions so their refresh tokens
  // stop working (the user can log back in — this is NOT a ban; use activate/
  // deactivate for that). This is the server-side equivalent of the user's own
  // global signOut, which Supabase implements by deleting their rows from
  // `auth.sessions`. The JS admin SDK has no by-user-id session-revocation method,
  // so we delete the rows directly via a parameterized query on the privileged
  // connection (the app's `postgres` role owns the auth schema). NOTE: a currently
  // active access token (JWT) remains valid until it expires (JWT TTL, ~1h) since
  // the app validates the token statelessly; the session/refresh path is killed
  // immediately, so the user is fully logged out within one token lifetime.
  forceLogoutUser: platformProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.user.findFirst({
        where: { email: input.email },
        select: { id: true, email: true, organizationId: true, supabaseUserId: true },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado con ese email' });
      if (!user.supabaseUserId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'El usuario no tiene una sesion de autenticacion activa',
        });
      }
      // supabaseUserId is stored as plain String (not @db.Uuid). Validate the
      // format before it becomes the `::uuid`-cast bind value, so a malformed
      // record fails cleanly here instead of as a raw Postgres cast 500.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.supabaseUserId)) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'ID de autenticacion malformado' });
      }

      // Parameterized ($executeRaw, not Unsafe) — deletes every session row for the
      // user; their refresh tokens become unusable because the session is gone.
      const revoked = await db.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${user.supabaseUserId}::uuid`;

      await db.auditLog.create({
        data: {
          organizationId: user.organizationId || ctx.user.organizationId,
          actorId: ctx.user.id,
          action: 'sessions_revoked',
          entity: 'user',
          entityId: user.id,
          metadata: { email: input.email, sessionsRevoked: revoked },
        },
      }).catch(() => {});

      return { email: input.email, sessionsRevoked: revoked };
    }),

  changeOrgUserRole: platformProcedure
    .input(z.object({
      userId: z.string().uuid(),
      organizationId: z.string().uuid(),
      roleSlug: z.string().max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      // Defense-in-depth: non-User principals (external, candidate) must never be
      // assigned to a staff User row even if their Role rows exist in the org seed.
      // The Zod schemas in user.ts already block the staff-facing paths; this guard
      // closes the platform-admin path which accepts a raw string roleSlug.
      if (!ASSIGNABLE_STAFF_ROLES.includes(input.roleSlug as never)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ese rol no puede asignarse a un usuario' });
      }

      const role = await db.role.findFirst({
        where: { organizationId: input.organizationId, slug: input.roleSlug },
        select: { id: true, slug: true },
      });
      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Rol no encontrado' });

      await db.userRole.deleteMany({
        where: { userId: input.userId, role: { organizationId: input.organizationId } },
      });
      await db.userRole.create({
        data: { userId: input.userId, roleId: role.id },
      });

      // Role change → drop the org's cached permission decisions.
      await invalidatePermissionCache(input.organizationId);

      await db.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: ctx.user.id,
          action: 'user_role_changed',
          entity: 'user',
          entityId: input.userId,
          metadata: { newRole: input.roleSlug },
        },
      }).catch(() => {});

      return { success: true };
    }),

  exportUsersCsv: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid().optional(),
      isActive: z.boolean().optional(),
      roleSlug: z.string().max(50).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.UserWhereInput = {};
      if (input.organizationId) where.organizationId = input.organizationId;
      if (input.isActive !== undefined) where.isActive = input.isActive;
      if (input.roleSlug) where.userRoles = { some: { role: { slug: input.roleSlug } } };

      const users = await db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          isActive: true,
          isPlatformOwner: true,
          lastLoginAt: true,
          createdAt: true,
          organization: { select: { name: true } },
          userRoles: { select: { role: { select: { slug: true } } } },
        },
      });

      logPlatformExport(ctx, { resource: 'users', count: users.length, format: 'csv', targetOrgId: input.organizationId });

      const header = 'Nombre,Email,Organizacion,Rol,Estado,Ultimo Login,Creado';
      const rows = users.map((u) => {
        const name = `${u.firstName || ''} ${u.lastName || ''}`.trim().replace(/,/g, ' ');
        const org = u.isPlatformOwner ? 'Plataforma' : u.organization?.name?.replace(/,/g, ' ') || '-';
        const role = u.isPlatformOwner ? 'platform_owner' : u.userRoles[0]?.role?.slug || 'employee';
        const fmt = (d: Date | null | undefined) => d ? d.toISOString().split('T')[0] : '-';
        return `${name},${u.email},${org},${role},${u.isActive ? 'active' : 'inactive'},${fmt(u.lastLoginAt)},${fmt(u.createdAt)}`;
      });

      return { csv: [header, ...rows].join('\n'), count: users.length };
    }),
});
