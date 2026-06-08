import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, verifyImpersonationToken, readImpersonationCookie } from '@tims/api';
import { createSupabaseServerClient } from '@tims/auth/server';
import { db } from '@tims/db';
import { logger } from '@tims/shared';
import * as Sentry from '@sentry/nextjs';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    // Structured error logging. Unexpected server errors are logged at `error`
    // with the stack; expected client errors (auth, validation, not-found) are
    // `warn` without stack noise. Never log `input` — it may contain PII.
    onError({ error, path, type, ctx }) {
      const base = {
        path: path ?? '<none>',
        type,
        code: error.code,
        userId: ctx?.user?.id,
        orgId: ctx?.user?.organizationId || undefined,
      };
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        logger.error(
          { ...base, errMessage: error.message, stack: error.stack },
          'tRPC internal error',
        );
        // Report unexpected server errors to Sentry (no-ops without a DSN).
        Sentry.captureException(error, { tags: { trpcPath: base.path }, extra: base });
      } else {
        logger.warn(base, `tRPC ${error.code}`);
      }
    },
    createContext: async () => {
      const supabase = await createSupabaseServerClient();
      const { data: { user: supabaseUser } } = await supabase.auth.getUser();

      if (!supabaseUser) {
        return { user: null, headers: new Headers(req.headers) };
      }

      // Look up the app user from supabase ID
      let appUser = await db.user.findUnique({
        where: { supabaseUserId: supabaseUser.id },
        include: {
          userRoles: {
            include: { role: { select: { slug: true } } },
          },
        },
      });

      // Auto-link: if no user found by supabaseUserId, try by email
      if (!appUser && supabaseUser.email) {
        const byEmail = await db.user.findFirst({
          where: { email: supabaseUser.email },
          include: {
            userRoles: {
              include: { role: { select: { slug: true } } },
            },
          },
        });

        if (byEmail) {
          // Link supabase account to existing user
          appUser = await db.user.update({
            where: { id: byEmail.id },
            data: {
              supabaseUserId: supabaseUser.id,
              avatar: supabaseUser.user_metadata?.avatar_url || byEmail.avatar,
              lastLoginAt: new Date(),
            },
            include: {
              userRoles: {
                include: { role: { select: { slug: true } } },
              },
            },
          });
        }
      }

      // Auto-create platform owner accounts for allowed emails
      if (!appUser && supabaseUser.email) {
        const isPlatformEmail = await db.platformOwnerEmail.findUnique({
          where: { email: supabaseUser.email },
        });

        if (isPlatformEmail) {
          appUser = await db.user.create({
            data: {
              supabaseUserId: supabaseUser.id,
              email: supabaseUser.email,
              firstName: supabaseUser.user_metadata?.first_name || supabaseUser.user_metadata?.full_name?.split(' ')[0] || 'Admin',
              lastName: supabaseUser.user_metadata?.last_name || supabaseUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '',
              avatar: supabaseUser.user_metadata?.avatar_url,
              isPlatformOwner: true,
              lastLoginAt: new Date(),
            },
            include: {
              userRoles: {
                include: { role: { select: { slug: true } } },
              },
            },
          });
        }
      }

      if (!appUser) {
        return { user: null, headers: new Headers(req.headers) };
      }

      // Update last login
      if (appUser.lastLoginAt === null || Date.now() - appUser.lastLoginAt.getTime() > 60000) {
        db.user.update({
          where: { id: appUser.id },
          data: { lastLoginAt: new Date() },
        }).catch(() => {});
      }

      const realUser = {
        id: appUser.id,
        supabaseUserId: appUser.supabaseUserId,
        email: appUser.email,
        organizationId: appUser.organizationId || '',
        roles: appUser.isPlatformOwner
          ? ['platform_owner']
          : appUser.userRoles.map((ur) => ur.role.slug),
        isPlatformOwner: appUser.isPlatformOwner,
      };

      // Impersonation: ONLY a real platform owner can be impersonating. The
      // signed cookie is read solely in this branch, so a forged/stolen cookie
      // is inert without an owner session. When valid, ctx.user BECOMES the
      // target (the owner drops to the target's org + permissions; platform
      // routes auto-block since isPlatformOwner is now false). impersonatorId
      // preserves attribution for audit.
      if (appUser.isPlatformOwner) {
        const token = readImpersonationCookie(req.headers.get('cookie'));
        const payload = verifyImpersonationToken(token);
        if (payload) {
          const target = await db.user.findUnique({
            where: { id: payload.targetUserId },
            include: { userRoles: { include: { role: { select: { slug: true } } } } },
          });
          // Never impersonate another platform owner or an inactive/org-less user.
          if (target && target.isActive && target.organizationId && !target.isPlatformOwner) {
            return {
              user: {
                id: target.id,
                supabaseUserId: target.supabaseUserId,
                email: target.email,
                organizationId: target.organizationId,
                roles: target.userRoles.map((ur) => ur.role.slug),
                isPlatformOwner: false,
                impersonatorId: appUser.id,
              },
              headers: new Headers(req.headers),
            };
          }
        }
      }

      return {
        user: realUser,
        headers: new Headers(req.headers),
      };
    },
  });

export { handler as GET, handler as POST };
