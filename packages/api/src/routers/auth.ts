import { router, protectedProcedure } from '../trpc';
import { db } from '@tims/db';

export const authRouter = router({
  // NOTE: account creation / supabase-account linking is handled server-side in
  // the tRPC context builder (apps/web/app/api/trpc/[trpc]/route.ts) using the
  // VERIFIED Supabase session (supabase.auth.getUser()). The former public
  // `syncUser` mutation trusted a client-supplied supabaseUserId/email and was an
  // unauthenticated account-takeover vector, so it has been removed. Do not
  // reintroduce a public endpoint that links identities from request input.

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
