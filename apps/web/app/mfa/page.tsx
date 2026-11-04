import { getUser } from '@tims/auth/server';
import { db } from '@tims/db';
import { redirect } from 'next/navigation';
import { env } from '../../lib/env';
import { MfaSetup } from './mfa-setup';
import { safeMfaReturnTo } from './mfa-return';
import { isMfaRequiredFor } from './mfa-requirement';

// Authenticated standalone page. Middleware already redirects anonymous users to
// /login for non-public paths; this is a defense-in-depth server guard.
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const returnTo = safeMfaReturnTo((await searchParams).returnTo);

  // Same linked-id lookup and role source as the (admin) MFA gate (the REAL operator's roles). An
  // unlinked session (e.g. mid-invitation) has no staff row yet: MFA is then not mandatory here.
  const staff = await db.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { isPlatformOwner: true, userRoles: { select: { role: { select: { slug: true } } } } },
  });
  const required = isMfaRequiredFor(
    env.MFA_ENFORCED,
    staff ? { isPlatformOwner: staff.isPlatformOwner, roleSlugs: staff.userRoles.map((ur) => ur.role.slug) } : null,
  );

  return <MfaSetup returnTo={returnTo} required={required} />;
}
