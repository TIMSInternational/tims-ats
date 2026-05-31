import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@tims/api';
import { createSupabaseServerClient } from '@tims/auth/server';
import { db } from '@tims/db';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
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

      return {
        user: {
          id: appUser.id,
          supabaseUserId: appUser.supabaseUserId,
          email: appUser.email,
          organizationId: appUser.organizationId || '',
          roles: appUser.isPlatformOwner
            ? ['platform_owner']
            : appUser.userRoles.map((ur) => ur.role.slug),
          isPlatformOwner: appUser.isPlatformOwner,
        },
        headers: new Headers(req.headers),
      };
    },
  });

export { handler as GET, handler as POST };
