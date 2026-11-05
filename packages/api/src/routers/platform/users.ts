import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { csvRow, getAppUrl, ASSIGNABLE_STAFF_ROLES, platformOwnerEmailLockKey } from '@tims/shared';
import { router } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { platformProcedure } from './_common';
import { logPlatformExport } from '../../access/security-audit';
import { invalidatePermissionCache } from '../../lib/cache';
import { recordPlatformAudit } from './platform-audit';
import { memberAdminLockKey } from '../../services/member-admin.policy';

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
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
        search: z.string().max(100).optional(),
        organizationId: z.string().uuid().optional(),
        roleSlug: z.string().max(50).optional(),
        isPlatformOwner: z.boolean().optional(),
        isActive: z.boolean().optional(),
        sortBy: z.enum(['name', 'email', 'createdAt', 'lastLoginAt']).default('createdAt'),
        sortDirection: z.enum(['asc', 'desc']).default('desc'),
      }),
    )
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

      const orderBy = sortBy === 'name' ? ({ firstName: sortDirection } as const) : { [sortBy]: sortDirection };

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
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
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

  // The owner allowlist grants cross-tenant access to every organization, so both writes are audited
  // (platform-owner access-2 / access-6 / journeys-30). The UI asks for the address to be typed twice.
  addPlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().trim().toLowerCase().email().max(255) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.platformOwnerEmail.findFirst({
        where: { email: { equals: input.email, mode: 'insensitive' } },
        select: { email: true },
      });
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Ese correo ya está en la lista' });
      const created = await db.platformOwnerEmail.create({
        data: { email: input.email, addedBy: ctx.user.id },
        select: { email: true, createdAt: true },
      });
      await recordPlatformAudit(ctx, {
        action: 'platform_owner_email_added',
        entity: 'platform_owner_email',
        metadata: { email: created.email },
      });
      return created;
    }),

  // Removing an address now also REVOKES it: an owner account already created from it loses the
  // platform-owner flag in the same transaction (both stacks read users.is_platform_owner on every
  // request), so removal no longer leaves a full owner behind. The caller cannot remove their own address.
  removePlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().trim().email().max(255) }))
    .mutation(async ({ ctx, input }) => {
      if (input.email.toLowerCase() === ctx.user.email.toLowerCase()) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No puedes quitar tu propio correo de la lista' });
      }
      const result = await db.$transaction(async (tx) => {
        // Same lock as first-sign-in owner provisioning (apps/web lib/auth/platform-owner-provisioning): a
        // sign-in racing this removal either finishes first (and is revoked below) or finds the address gone.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${platformOwnerEmailLockKey(input.email)}, 0))`;
        // Prisma's case-insensitive `equals` is an ILIKE on PostgreSQL, where `_` and `%` are wildcards: removing
        // `ops_admin@x` would also match `ops-admin@x`. Keep only exact (case-folded) matches before deleting or
        // revoking anything (Codex review of release/pilot-ux-wave2, P1).
        const address = input.email.toLowerCase();
        const exact = (email: string) => email.toLowerCase() === address;
        const entries = (
          await tx.platformOwnerEmail.findMany({
            where: { email: { equals: input.email, mode: 'insensitive' } },
            select: { email: true },
          })
        ).filter((e) => exact(e.email));
        if (entries.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ese correo no está en la lista' });
        await tx.platformOwnerEmail.deleteMany({ where: { email: { in: entries.map((e) => e.email) } } });
        const owners = (
          await tx.user.findMany({
            where: { email: { equals: input.email, mode: 'insensitive' }, isPlatformOwner: true, id: { not: ctx.user.id } },
            select: { id: true, email: true },
          })
        ).filter((u) => exact(u.email));
        const revoked =
          owners.length === 0
            ? { count: 0 }
            : await tx.user.updateMany({
                where: { id: { in: owners.map((u) => u.id) }, isPlatformOwner: true },
                data: { isPlatformOwner: false },
              });
        return { email: entries[0]!.email, ownersRevoked: revoked.count };
      });
      await recordPlatformAudit(ctx, {
        action: 'platform_owner_email_removed',
        entity: 'platform_owner_email',
        metadata: { email: result.email, ownersRevoked: result.ownersRevoked },
      });
      return result;
    }),

  deactivateOrgUser: platformProcedure
    .input(z.object({ userId: z.string().uuid(), organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.user.findFirst({
        where: { id: input.userId, organizationId: input.organizationId },
        select: { id: true, isPlatformOwner: true },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
      if (user.isPlatformOwner)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No se puede desactivar un platform owner' });

      const updated = await db.user.update({
        where: { id: input.userId },
        data: { isActive: false },
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
      });
      await db.auditLog
        .create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: 'user_deactivated',
            entity: 'user',
            entityId: input.userId,
          },
        })
        .catch(() => {});
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
      await db.auditLog
        .create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: 'user_activated',
            entity: 'user',
            entityId: input.userId,
          },
        })
        .catch(() => {});
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
      // self-serve /forgot-password flow. This server-side admin client does not
      // have a browser PKCE verifier, so Supabase returns recovery credentials in
      // the URL fragment. The password page consumes that fragment explicitly and
      // binds the update to the recovered identity.
      // Previously this was a no-op that returned { sent: true } without
      // sending anything (rule #4: the UI claimed an email was sent).
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceKey) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Servicio de autenticación no configurado',
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

      await db.auditLog
        .create({
          data: {
            organizationId: user.organizationId || ctx.user.organizationId,
            actorId: ctx.user.id,
            action: 'password_reset_requested',
            entity: 'user',
            entityId: user.id,
            metadata: { email: input.email },
          },
        })
        .catch(() => {});

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
          message: 'El usuario no tiene una sesión de autenticación activa',
        });
      }
      // supabaseUserId is stored as plain String (not @db.Uuid). Validate the
      // format before it becomes the `::uuid`-cast bind value, so a malformed
      // record fails cleanly here instead of as a raw Postgres cast 500.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.supabaseUserId)) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'ID de autenticación malformado' });
      }

      // Parameterized ($executeRaw, not Unsafe) — deletes every session row for the
      // user; their refresh tokens become unusable because the session is gone.
      const revoked = await db.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${user.supabaseUserId}::uuid`;

      await db.auditLog
        .create({
          data: {
            organizationId: user.organizationId || ctx.user.organizationId,
            actorId: ctx.user.id,
            action: 'sessions_revoked',
            entity: 'user',
            entityId: user.id,
            metadata: { email: input.email, sessionsRevoked: revoked },
          },
        })
        .catch(() => {});

      return { email: input.email, sessionsRevoked: revoked };
    }),

  changeOrgUserRole: platformProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        organizationId: z.string().uuid(),
        roleSlug: z.string().max(50),
      }),
    )
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

      // Delete-then-create in ONE transaction (D-14): run separately, a failure between the two left the
      // user with no role at all ("Tu acceso está pendiente"). The user must belong to the organization.
      const previousRoles = await db.$transaction(async (tx) => {
        // Serialized with the tenant role writers (memberAdminLockKey): two overlapping replacements on one
        // member could otherwise each delete before the other's insert and leave both roles.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${memberAdminLockKey(input.organizationId)}, 0))`;
        const user = await tx.user.findFirst({
          where: { id: input.userId, organizationId: input.organizationId },
          select: { id: true, isPlatformOwner: true, userRoles: { select: { role: { select: { slug: true } } } } },
        });
        if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
        if (user.isPlatformOwner)
          throw new TRPCError({ code: 'FORBIDDEN', message: 'No se puede cambiar el rol de un platform owner' });
        await tx.userRole.deleteMany({
          where: { userId: input.userId, role: { organizationId: input.organizationId } },
        });
        await tx.userRole.create({
          data: { userId: input.userId, roleId: role.id, assignedBy: ctx.user.id },
        });
        return user.userRoles.map((ur) => ur.role.slug);
      });

      // Role change → drop the org's cached permission decisions.
      await invalidatePermissionCache(input.organizationId);

      await db.auditLog
        .create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: 'user_role_changed',
            entity: 'user',
            entityId: input.userId,
            metadata: { newRole: input.roleSlug, previousRoles },
          },
        })
        .catch(() => {});

      return { success: true };
    }),

  exportUsersCsv: platformProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
        isActive: z.boolean().optional(),
        roleSlug: z.string().max(50).optional(),
      }),
    )
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

      logPlatformExport(ctx, {
        resource: 'users',
        count: users.length,
        format: 'csv',
        targetOrgId: input.organizationId,
      });

      // Every cell through csvRow (packages/shared/src/csv.ts). This export previously emitted EVERY
      // field raw — no quoting anywhere, not even on `email` or `role` — with a comma-stripping regex
      // replace on name and org as the only concession to delimiters. That is data MUTATION, not
      // escaping: a user
      // named "Doe, Jane" was silently exported as "Doe  Jane". Quoting handles the comma correctly, so
      // the strip is removed rather than kept alongside it. It also had no formula-injection defence
      // (CWE-1236) on any field. Tracked as GHSA-w6h5-g5gv-7g95.
      const header = csvRow(['Nombre', 'Email', 'Organizacion', 'Rol', 'Estado', 'Ultimo Login', 'Creado']);
      const rows = users.map((u) => {
        const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
        // `|| '-'` stays FALSY, not `??`: an empty-string organization name must still become "-".
        const org = u.isPlatformOwner ? 'Plataforma' : u.organization?.name || '-';
        const role = u.isPlatformOwner ? 'platform_owner' : u.userRoles[0]?.role?.slug || 'employee';
        const fmt = (d: Date | null | undefined) => (d ? d.toISOString().split('T')[0] : '-');
        return csvRow([
          name,
          u.email,
          org,
          role,
          u.isActive ? 'active' : 'inactive',
          fmt(u.lastLoginAt),
          fmt(u.createdAt),
        ]);
      });

      return { csv: [header, ...rows].join('\n'), count: users.length };
    }),
});
