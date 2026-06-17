import { createSupabaseServerClient } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { env } from '../../lib/env';
import { isMfaEnforced, isMfaGateBlocking } from '../../lib/mfa';
import { AdminShell } from './admin-shell';
import { manifestFor } from '../../lib/nav/manifest';
import { getEffectiveIdentity } from '../../lib/auth/effective-identity';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolves the effective (impersonation-aware) identity AND the real operator's
  // roles for the MFA gate. The staff guard + /logout redirect live in the helper
  // (parity with apps/web/app/api/trpc/[trpc]/route.ts).
  const { effective, realRoleSlugs, realIsPlatformOwner } = await getEffectiveIdentity();

  // MFA enforcement gate (opt-in via MFA_ENFORCED). Privileged roles — platform
  // owners and super_admins — must have stepped up to a verified TOTP factor
  // (Supabase aal2) before any admin route renders. Evaluated against the REAL
  // session's assurance level (impersonation rides a separate signed cookie, not
  // a Supabase session swap, so this correctly reflects the operator). /mfa lives
  // OUTSIDE this layout, so there is no redirect loop. Pure decision in lib/mfa.ts.
  // Mirror trpc.ts's privileged set exactly: the isPlatformOwner flag OR the
  // platform_owner / super_admin role slugs (any of which fully bypass permission
  // checks). Keep these in sync — a role the API treats as privileged but the gate
  // doesn't would silently escape MFA enforcement. Keyed to the REAL operator
  // (impersonation rides a separate signed cookie, not a Supabase session swap).
  const isPrivileged =
    realIsPlatformOwner ||
    realRoleSlugs.some((slug) => slug === 'super_admin' || slug === 'platform_owner');
  if (isMfaEnforced(env.MFA_ENFORCED) && isPrivileged) {
    const supabase = await createSupabaseServerClient();
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (isMfaGateBlocking({ enforced: true, isPrivileged: true, currentLevel: aal?.currentLevel })) {
      redirect('/mfa');
    }
  }

  // Pick the shell from the EFFECTIVE primary role's manifest (committee/employee →
  // participant). When impersonating, this is the target's role so the chrome matches
  // the impersonated tRPC context. Platform owners always render PlatformSidebar
  // regardless of shell (pickSidebarVariant).
  const shell = manifestFor(effective.roleSlugs).shell;

  return (
    <AdminShell
      userInitials={effective.initials}
      displayName={effective.displayName}
      isPlatformOwner={effective.isPlatformOwner}
      shell={shell}
      avatar={effective.avatar}
    >
      {children}
    </AdminShell>
  );
}
