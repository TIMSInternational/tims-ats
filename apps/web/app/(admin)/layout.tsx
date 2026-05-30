import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { AdminShell } from './admin-shell';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect('/login');

  const initials = user.email?.substring(0, 2).toUpperCase() || 'U';

  return <AdminShell userInitials={initials}>{children}</AdminShell>;
}
