import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@tims/db';
import { verifyImpersonationToken, IMPERSONATION_COOKIE } from '@tims/api';
import { AdminShell } from './admin-shell';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabaseUser = await getUser();
  if (!supabaseUser) redirect('/login');

  // Look up app user to check platform owner status
  const appUser = await db.user.findFirst({
    where: {
      OR: [
        { supabaseUserId: supabaseUser.id },
        { email: supabaseUser.email || '' },
      ],
    },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      isPlatformOwner: true,
      avatar: true,
    },
  });

  // Impersonation: when a real platform owner has a valid impersonation cookie,
  // render the shell AS the target (tenant sidebar, target identity) so the UI
  // matches the impersonated tRPC context. Mirrors the resolution in the tRPC
  // route handler; the cookie is honored only for a real platform owner.
  let effective = appUser;
  if (appUser?.isPlatformOwner) {
    const cookieStore = await cookies();
    const payload = verifyImpersonationToken(cookieStore.get(IMPERSONATION_COOKIE)?.value);
    if (payload) {
      const target = await db.user.findUnique({
        where: { id: payload.targetUserId },
        select: {
          firstName: true, lastName: true, email: true,
          isPlatformOwner: true, avatar: true, isActive: true, organizationId: true,
        },
      });
      if (target && target.isActive && target.organizationId && !target.isPlatformOwner) {
        effective = target;
      }
    }
  }

  const initials = effective
    ? `${effective.firstName[0]}${effective.lastName[0]}`.toUpperCase()
    : supabaseUser.email?.substring(0, 2).toUpperCase() || 'U';

  const displayName = effective
    ? `${effective.firstName} ${effective.lastName}`
    : supabaseUser.email || 'Usuario';

  return (
    <AdminShell
      userInitials={initials}
      displayName={displayName}
      isPlatformOwner={effective?.isPlatformOwner || false}
      avatar={effective?.avatar || supabaseUser.user_metadata?.avatar_url}
    >
      {children}
    </AdminShell>
  );
}
