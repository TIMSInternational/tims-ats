import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { db } from '@tims/db';
import { PlatformDashboard } from './platform-dashboard';
import { RecruitmentDashboard } from './recruitment-dashboard';

export default async function DashboardPage() {
  const supabaseUser = await getUser();
  if (!supabaseUser) redirect('/login');

  const appUser = await db.user.findFirst({
    where: {
      OR: [
        { supabaseUserId: supabaseUser.id },
        { email: supabaseUser.email || '' },
      ],
    },
    select: {
      id: true,
      isPlatformOwner: true,
      userRoles: {
        select: {
          role: { select: { slug: true } },
        },
      },
    },
  });

  if (!appUser) redirect('/login');

  // Platform owner sees platform dashboard
  if (appUser.isPlatformOwner) {
    return <PlatformDashboard />;
  }

  // Org users see recruitment dashboard
  const roleSlugs = appUser.userRoles.map((ur) => ur.role.slug);

  return <RecruitmentDashboard roleSlugs={roleSlugs} />;
}
