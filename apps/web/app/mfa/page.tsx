import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { MfaSetup } from './mfa-setup';

// Authenticated standalone page. Middleware already redirects anonymous users to
// /login for non-public paths; this is a defense-in-depth server guard.
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const candidate = (await searchParams).returnTo;
  const returnTo =
    candidate &&
    /^\/accept-invitation\?token=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
      ? candidate
      : undefined;
  return <MfaSetup returnTo={returnTo} />;
}
