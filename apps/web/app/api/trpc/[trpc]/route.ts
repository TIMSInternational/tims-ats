import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createContext } from '@tims/api';
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
      const appUser = await db.user.findUnique({
        where: { supabaseUserId: supabaseUser.id },
        include: {
          userRoles: {
            include: { role: { select: { slug: true } } },
          },
        },
      });

      if (!appUser) {
        return { user: null, headers: new Headers(req.headers) };
      }

      return {
        user: {
          id: appUser.id,
          supabaseUserId: appUser.supabaseUserId,
          email: appUser.email,
          organizationId: appUser.organizationId,
          roles: appUser.userRoles.map((ur) => ur.role.slug),
        },
        headers: new Headers(req.headers),
      };
    },
  });

export { handler as GET, handler as POST };
