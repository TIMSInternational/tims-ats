import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { db } from '@tims/db';
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

  const initials = appUser
    ? `${appUser.firstName[0]}${appUser.lastName[0]}`.toUpperCase()
    : supabaseUser.email?.substring(0, 2).toUpperCase() || 'U';

  const displayName = appUser
    ? `${appUser.firstName} ${appUser.lastName}`
    : supabaseUser.email || 'Usuario';

  return (
    <AdminShell
      userInitials={initials}
      displayName={displayName}
      isPlatformOwner={appUser?.isPlatformOwner || false}
      avatar={appUser?.avatar || supabaseUser.user_metadata?.avatar_url}
    >
      {children}
    </AdminShell>
  );
}
