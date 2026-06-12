import { getUser } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@tims/db';
// The real-identity isPlatformOwner check runs first; only then do we consult
// verifyImpersonationToken (deny-only — see the gate comment below).
import { verifyImpersonationToken, IMPERSONATION_COOKIE } from '@tims/api';

// Wave 2.5 slice 2 — server-side gate for the platform console. The parent
// (admin)/layout.tsx already enforces login/active/MFA; this nested layout adds
// the owner check so non-platform-owners never render a /platform page (before
// this, only platformProcedure blocked them — the page shell rendered, then
// errored). The owner check runs against the REAL Supabase identity. Then, as a
// DENY-ONLY narrowing, an active impersonation cookie also bounces the operator:
// while impersonating, the tRPC context is the impersonated non-owner and
// platformProcedure FORBIDs every platform call, so rendering /platform would
// shell-then-error (consistency with platformProcedure). A non-owner can never
// GAIN access from the cookie — the real-owner check comes first.
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabaseUser = await getUser();
  if (!supabaseUser) redirect('/login');

  const appUser = await db.user.findUnique({
    where: { supabaseUserId: supabaseUser.id },
    select: { isPlatformOwner: true, isActive: true },
  });
  if (!appUser?.isPlatformOwner || !appUser.isActive) {
    // /dashboard (not /logout): the parent layout already guarantees anyone
    // reaching here is a linked, active, org-scoped staffer — their dashboard
    // renders fine. /logout is the parent's escape for unlinked sessions only.
    redirect('/dashboard');
  }

  // Deny-only impersonation check (AFTER the real-owner check, so it can only
  // narrow access): while impersonating, the tRPC context is the impersonated
  // non-owner and platformProcedure FORBIDs every platform call — rendering
  // /platform would just shell-then-error. Stop impersonating to use the console.
  const cookieStore = await cookies();
  if (verifyImpersonationToken(cookieStore.get(IMPERSONATION_COOKIE)?.value)) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
