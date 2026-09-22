import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { MfaSetup } from './mfa-setup';
import { safeMfaReturnTo } from './mfa-return';

// Authenticated standalone page. Middleware already redirects anonymous users to
// /login for non-public paths; this is a defense-in-depth server guard.
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const returnTo = safeMfaReturnTo((await searchParams).returnTo);
  return <MfaSetup returnTo={returnTo} />;
}
