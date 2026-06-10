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

      // Surface the Supabase identity regardless of whether a staff `User` exists.
      // Candidate (portal) sessions never resolve to a `User`, but they ARE
      // authenticated — `candidateProcedure` reads this to resolve a `Candidate`.
      const supabaseAuth = supabaseUser?.email
        ? { email: supabaseUser.email, userId: supabaseUser.id }
        : null;

      if (!supabaseUser) {
        return { user: null, supabaseAuth, headers: new Headers(req.headers) };
      }

      // Recognize a staff/owner user by LINKED Supabase id ONLY. Staff are linked to
      // their Supabase identity at invite time (B2 — services/staff-provisioning),
      // so there is no email-join here: this builder runs for every session including
      // candidate portal sessions, and an email match would let a candidate / cross-
      // tenant email collision be promoted into staff. See
      // docs/SECURITY-staff-candidate-auth-linking.md.
      let appUser = await db.user.findUnique({
        where: { supabaseUserId: supabaseUser.id },
        include: {
          userRoles: {
            include: { role: { select: { slug: true } } },
          },
        },
      });

      // Auto-create platform owner accounts for allowed emails (allowlist-gated, so
      // not an email-collision vector — it CREATES an owner row, never claims an
      // existing staff row).
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
        // Authenticated Supabase session with no staff `User` = a candidate (or a
        // not-yet-provisioned account). Keep `user` null but carry supabaseAuth so
        // the candidate portal can resolve them by email.
        return { user: null, supabaseAuth, headers: new Headers(req.headers) };
      }

      // A usable staff identity must be active AND either org-scoped or a platform
      // owner. This rejects a deactivated account and any org-less non-owner row
      // (e.g. a legacy candidate-account row from before invite-time linking) — such
      // a row must never be treated as staff just because it shares the Supabase id.
      if (!appUser.isActive || (!appUser.isPlatformOwner && !appUser.organizationId)) {
        return { user: null, supabaseAuth, headers: new Headers(req.headers) };
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
              supabaseAuth,
              headers: new Headers(req.headers),
            };
          }
        }
      }

      return {
        user: realUser,
        supabaseAuth,
        headers: new Headers(req.headers),
      };
    },
  });

export { handler as GET, handler as POST };
