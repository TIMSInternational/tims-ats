import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db, runTenantTransaction } from '@tims/db';
import { createUserSchema, updateProfileSchema, assignRoleSchema, canGrantStaffRole } from '@tims/shared';
import { invalidatePermissionCache } from '../lib/cache';
import { logSecurityEvent } from '../access/security-audit';
import { resolveStaffSupabaseUserId } from '../services/staff-provisioning.service';

/**
 * Staff-role grant policy (PR #307 panel, HIGH): `user:create` / `user:update` say WHETHER a caller may add or
 * change users, not WHICH roles they may hand out. Without this check an hr_admin could mint a super_admin through
 * create or assignRole — the escalation the C# /tenant-invitations surface already refuses (InvitationGrantPolicy).
 * Same pure policy on both stacks, pinned by contracts/identity-fixtures/invitation-grant-policy.json.
 * Throwing FORBIDDEN is enough for the audit trail: the outermost `withSecurityAudit` middleware records every
 * FORBIDDEN as an `authz_denied` security event (entity `trpc:<path>`). Under impersonation ctx.user.roles are
 * the TARGET's roles, so an impersonating owner can never grant above the impersonated user.
 */
function assertCanGrantRole(callerRoles: readonly string[], roleSlug: string): void {
  if (!canGrantStaffRole(callerRoles, roleSlug)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No puedes asignar un rol superior al tuyo' });
  }
}

export const userRouter = router({
  // Get current user profile. No real consumer exists today (grepped apps/web
  // and tests — zero call sites), but this is a session/identity endpoint, so
  // scope the select to profile-display fields rather than leave it wide open
  // for whenever a consumer lands (issue #23).
  me: protectedProcedure.query(async ({ ctx }) => {
    return db.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
        jobTitle: true,
        isActive: true,
        userRoles: {
          select: {
            role: { select: { id: true, name: true, slug: true } },
          },
        },
        teams: {
          select: {
            team: { select: { id: true, name: true } },
          },
        },
      },
    });
  }),

  // Update own profile — strict allowlist (updateProfileSchema) so a user cannot
  // set roleSlug / companyId / businessUnitId / isActive / isPlatformOwner on
  // themselves. Returns only non-sensitive profile fields.
  updateProfile: protectedProcedure.input(updateProfileSchema).mutation(async ({ ctx, input }) => {
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
        search: z.string().max(200).optional(),
        roleSlug: z.string().max(100).optional(),
        isActive: z.boolean().optional(),
      }),
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
        ...(roleSlug ? { userRoles: { some: { role: { slug: roleSlug } } } } : {}),
      };

      const users = await db.user.findMany({
        where,
        take: limit + 1,
        // `cursor` is the LAST row the previous page displayed, so skip it. `id` breaks createdAt ties:
        // Prisma's cursor needs a total order or rows sharing a timestamp can repeat or vanish across pages.
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // Narrow select — no sensitive fields (supabaseUserId, isPlatformOwner,
        // mfaEnabled, phone, lastLoginAt). `userRoles`/`role` are NOT selected:
        // no known consumer reads them (roleSlug filtering happens via the
        // `where` clause above, not via the included relation). jobTitle is
        // included for schedule-modal.fields.tsx's fallback label.
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          avatar: true,
          jobTitle: true,
        },
      });

      // Fetched limit+1 only to learn whether another page exists. The look-ahead row is dropped and is
      // NOT the cursor: with `skip: 1` above that would skip it forever (51 members → member 51 never shown).
      const hasMore = users.length > limit;
      if (hasMore) users.pop();
      const nextCursor: string | undefined = hasMore ? users[users.length - 1]?.id : undefined;

      return { users, nextCursor };
    }),

  // Create user (invite)
  create: permissionProcedure('user', 'create')
    .input(createUserSchema)
    .mutation(async ({ ctx, input }) => {
      const { roleSlug, ...userData } = input;
      // Grant policy BEFORE any lookup, provisioning, or write.
      assertCanGrantRole(ctx.user.roles, roleSlug);

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

      // Reject duplicates BEFORE provisioning an auth identity. Without this, an
      // existing org/email row (incl. a deactivated/canceled invite, whose
      // supabaseUserId is still a sentinel) would cause resolveStaffSupabaseUserId to
      // send a fresh Supabase invite and THEN the insert would fail on
      // @@unique([organizationId, email]) — orphaning the auth identity + emailing a
      // former user. tenantDb is org-scoped; the query also sees soft-deleted rows.
      // Case-INSENSITIVE match — Supabase auth emails are case-insensitive and the
      // resolver matches on lower(email), so an exact-case check here would let
      // `Alice@x.com` slip past an existing `alice@x.com` row and reach provisioning.
      const existing = await db.user.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          email: { equals: userData.email, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Ya existe un usuario con este correo en la organizacion',
        });
      }

      // B2 invite-time linking: create/lookup the Supabase identity NOW and stamp it
      // on the row, so the user is linked from birth (no later email-join). Done
      // before the tx since it's an external call.
      const supabaseUserId = await resolveStaffSupabaseUserId(userData.email);

      // Create user + role assignment in ONE transaction. runTenantTransaction, not
      // db.$transaction: `db` is `tenantDb`, whose extension re-wraps every op in its
      // own mini-transaction, so an outer tenantDb.$transaction does not compose
      // (prisma/prisma#17948, #45) -- a failure here used to leave a roleless user.
      const created = await runTenantTransaction(ctx.user.organizationId, async (tx) => {
        const user = await tx.user.create({
          data: {
            ...userData,
            organizationId: ctx.user.organizationId,
            supabaseUserId,
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

      // CB-1c: privileged-action security event (role granted at user creation).
      void logSecurityEvent({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
        action: 'role_assigned',
        entity: 'user_role',
        entityId: created.id,
        metadata: { targetUserId: created.id, roleSlug, atUserCreation: true },
      });

      return created;
    }),

  // Assign role
  assignRole: permissionProcedure('user', 'update')
    .input(assignRoleSchema)
    .mutation(async ({ ctx, input }) => {
      // Grant policy BEFORE any lookup or write (see assertCanGrantRole).
      assertCanGrantRole(ctx.user.roles, input.roleSlug);

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

      const result = await db.userRole.upsert({
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

      // Role change → drop the org's cached permission decisions.
      await invalidatePermissionCache(ctx.user.organizationId);

      // CB-1c: privileged-action security event (role assignment / scope change).
      void logSecurityEvent({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
        action: 'role_assigned',
        entity: 'user_role',
        entityId: input.userId,
        metadata: {
          targetUserId: input.userId,
          roleSlug: input.roleSlug,
          companyScope: input.companyScope ?? null,
          unitScope: input.unitScope ?? null,
        },
      });

      return result;
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
