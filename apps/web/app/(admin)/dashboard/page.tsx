import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { db } from '@tims/db';
import { PlatformDashboard } from './platform-dashboard';
import { RecruitmentDashboard } from './recruitment-dashboard';

export default async function DashboardPage() {
  const supabaseUser = await getUser();
  if (!supabaseUser) redirect('/login');

  // Recognize by LINKED Supabase id only (staff linked at invite time — B2). An
  // unlinked authenticated session is signed out (non-looping; see admin layout).
  const appUser = await db.user.findUnique({
    where: { supabaseUserId: supabaseUser.id },
    select: {
      id: true,
      isPlatformOwner: true,
      organizationId: true,
      isActive: true,
      userRoles: {
        select: {
          role: { select: { slug: true } },
        },
      },
    },
  });

  // Must be a linked, active staff identity that is org-scoped or a platform owner.
  if (!appUser || !appUser.isActive || (!appUser.isPlatformOwner && !appUser.organizationId)) {
    redirect('/logout');
  }

  // Platform owner sees platform dashboard
  if (appUser.isPlatformOwner) {
    return <PlatformDashboard />;
  }

  // Org users see recruitment dashboard
  const roleSlugs = appUser.userRoles.map((ur) => ur.role.slug);

  return <RecruitmentDashboard roleSlugs={roleSlugs} />;
}
