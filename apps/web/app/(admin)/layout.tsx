import { getUser, createSupabaseServerClient } from '@tims/auth/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@tims/db';
import { verifyImpersonationToken, IMPERSONATION_COOKIE } from '@tims/api';
import { env } from '../../lib/env';
import { isMfaEnforced, isMfaGateBlocking } from '../../lib/mfa';
import { AdminShell } from './admin-shell';
import { manifestFor } from '../../lib/nav/manifest';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabaseUser = await getUser();
  if (!supabaseUser) redirect('/login');

  // Recognize the staff/owner user by LINKED Supabase id only (staff are linked at
  // invite time — B2; no email-join). An authenticated session with no linked staff
  // row (e.g. a candidate who navigated to /admin) is signed out via /logout, which
  // avoids the /login → / → /dashboard redirect loop. See
  // docs/SECURITY-staff-candidate-auth-linking.md.
  const appUser = await db.user.findUnique({
    where: { supabaseUserId: supabaseUser.id },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      isPlatformOwner: true,
      organizationId: true,
      isActive: true,
      avatar: true,
      userRoles: { select: { role: { select: { slug: true } } } },
    },
  });
  // Must be a linked, active staff identity that is org-scoped or a platform owner.
  if (!appUser || !appUser.isActive || (!appUser.isPlatformOwner && !appUser.organizationId)) {
    redirect('/logout');
  }

  // MFA enforcement gate (opt-in via MFA_ENFORCED). Privileged roles — platform
  // owners and super_admins — must have stepped up to a verified TOTP factor
  // (Supabase aal2) before any admin route renders. Evaluated against the REAL
  // session's assurance level (impersonation rides a separate signed cookie, not
  // a Supabase session swap, so this correctly reflects the operator). /mfa lives
  // OUTSIDE this layout, so there is no redirect loop. Pure decision in lib/mfa.ts.
  // Mirror trpc.ts's privileged set exactly: the isPlatformOwner flag OR the
  // platform_owner / super_admin role slugs (any of which fully bypass permission
  // checks). Keep these in sync — a role the API treats as privileged but the gate
  // doesn't would silently escape MFA enforcement.
  const roleSlugs = (appUser?.userRoles ?? []).map((ur) => ur.role.slug);
  const isPrivileged =
    !!appUser?.isPlatformOwner ||
    roleSlugs.some((slug) => slug === 'super_admin' || slug === 'platform_owner');
  if (isMfaEnforced(env.MFA_ENFORCED) && isPrivileged) {
    const supabase = await createSupabaseServerClient();
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (isMfaGateBlocking({ enforced: true, isPrivileged: true, currentLevel: aal?.currentLevel })) {
      redirect('/mfa');
    }
  }

  // Impersonation: when a real platform owner has a valid impersonation cookie,
  // render the shell AS the target (tenant sidebar, target identity) so the UI
  // matches the impersonated tRPC context. Mirrors the resolution in the tRPC
  // route handler; the cookie is honored only for a real platform owner.
  // `effective` carries only the display fields (decoupled from appUser's select,
  // which now also includes userRoles for the MFA gate above).
  let effective: {
    firstName: string;
    lastName: string;
    email: string;
    isPlatformOwner: boolean;
    avatar: string | null;
  } | null = appUser
    ? {
        firstName: appUser.firstName,
        lastName: appUser.lastName,
        email: appUser.email,
        isPlatformOwner: appUser.isPlatformOwner,
        avatar: appUser.avatar,
      }
    : null;
  if (appUser?.isPlatformOwner) {
    const cookieStore = await cookies();
    const payload = verifyImpersonationToken(cookieStore.get(IMPERSONATION_COOKIE)?.value);
    if (payload) {
      const target = await db.user.findUnique({
        where: { id: payload.targetUserId },
        select: {
          firstName: true, lastName: true, email: true,
          isPlatformOwner: true, avatar: true, isActive: true, organizationId: true,
        },
      });
      if (target && target.isActive && target.organizationId && !target.isPlatformOwner) {
        effective = target;
      }
    }
  }

  const initials = effective
    ? `${effective.firstName[0]}${effective.lastName[0]}`.toUpperCase()
    : supabaseUser.email?.substring(0, 2).toUpperCase() || 'U';

  const displayName = effective
    ? `${effective.firstName} ${effective.lastName}`
    : supabaseUser.email || 'Usuario';

  // Pick the shell from the primary role's manifest (committee/employee → participant).
  // Reuses the role slugs already loaded for the MFA gate (no extra query). Platform
  // owners always render PlatformSidebar regardless of shell (pickSidebarVariant).
  const shell = manifestFor(roleSlugs).shell;

  return (
    <AdminShell
      userInitials={initials}
      displayName={displayName}
      isPlatformOwner={effective?.isPlatformOwner || false}
      shell={shell}
      avatar={effective?.avatar || supabaseUser.user_metadata?.avatar_url}
    >
      {children}
    </AdminShell>
  );
}
