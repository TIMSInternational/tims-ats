import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { MfaSetup } from './mfa-setup';

// Authenticated standalone page. Middleware already redirects anonymous users to
// /login for non-public paths; this is a defense-in-depth server guard.
export default async function MfaPage() {
  const user = await getUser();
  if (!user) redirect('/login');
  return <MfaSetup />;
}
