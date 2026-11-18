import { createSupabaseServerClient } from '@tims/auth/server';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@tims/db';
import { provisionPlatformOwner } from '../../../lib/auth/platform-owner-provisioning';
import { provisionOrgDefaults, provisionOrgEntitlements, provisionOrgRoles } from '@tims/api';
import { isSafePortalNext, portalLoginPathFor } from '../../../lib/portal-auth';
import { safeStaffRedirectPath } from '../../../lib/auth/staff-login-redirect';
import { isSelfServeSignupEnabled } from '../../../lib/self-serve-signup';
import { slugify } from '../../../lib/slugify';
import { PASSWORD_SETUP_PROOF_COOKIE, PASSWORD_SETUP_PROOF_PATH } from '../../../lib/password-setup-proof';

function recoveryRedirect(origin: string, invitationToken: string | null, userId: string) {
  const proof = randomUUID();
  const destination = new URL('/reset-password', origin);
  destination.searchParams.set('recovery', proof);
  if (invitationToken) destination.searchParams.set('invitation', invitationToken);
  const response = NextResponse.redirect(destination);
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('cache-control', 'no-store');
  response.cookies.set(PASSWORD_SETUP_PROOF_COOKIE, `${proof}.${userId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: PASSWORD_SETUP_PROOF_PATH,
    maxAge: 300,
  });
  return response;
}

/** True when this browser already holds a session for a linked staff/owner account (never a candidate). */
async function hasOpenStaffSession(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<boolean> {
  const {
    data: { user: current },
  } = await supabase.auth.getUser();
  if (!current) return false;
  const staff = await db.user.findFirst({ where: { supabaseUserId: current.id }, select: { id: true } });
  return staff !== null;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const accountType = searchParams.get('type') || null; // 'candidate' | 'company' | null

  // A candidate's portal magic link that fails (expired, already used, or opened in a different browser
  // than the one that requested it) goes back to THAT portal's login with a retry message, never to the
  // staff /login. Resolved up front because Supabase can report the failure WITHOUT a `code`: as
  // `error` / `error_code` / `error_description` query params (handled here), or in a URL fragment the
  // server never sees (the portal login page reads that one client-side).
  const portalLogin = portalLoginPathFor(searchParams.get('next'));
  const supabaseError = searchParams.get('error') || searchParams.get('error_code');

  if (portalLogin && (!code || supabaseError)) {
    return NextResponse.redirect(`${origin}${portalLogin}?error=link`);
  }
  // Staff flow unchanged: no code → /login?error=no_code.
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const supabase = await createSupabaseServerClient();

  // E-19 (#410): a candidate's emailed link opened in a browser where a STAFF account is signed in would
  // silently replace that session. Do not exchange the code; the portal login explains it ("Tiene una sesión
  // abierta como …") and offers an explicit sign-out, after which the 6-digit code from the same email works.
  if (portalLogin && (await hasOpenStaffSession(supabase))) {
    return NextResponse.redirect(`${origin}${portalLogin}?error=open_session`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    if (portalLogin) return NextResponse.redirect(`${origin}${portalLogin}?error=link`);
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  }

  // Get the authenticated user
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser();
  if (!supabaseUser?.email) {
    return NextResponse.redirect(`${origin}/login?error=no_email`);
  }

  const invitationToken = searchParams.get('invitation');
  if (invitationToken && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationToken)) {
    if (searchParams.get('recovery') === '1') return recoveryRedirect(origin, invitationToken, supabaseUser.id);
    const destination = '/accept-invitation?token=';
    const response = NextResponse.redirect(`${origin}${destination}${encodeURIComponent(invitationToken)}`);
    response.headers.set('referrer-policy', 'no-referrer');
    response.headers.set('cache-control', 'no-store');
    return response;
  }
  if (searchParams.get('recovery') === '1') {
    return recoveryRedirect(origin, null, supabaseUser.id);
  }
  // Portal (candidate) login: a safe /careers/ `next` target means this is a
  // candidate magic-link sign-in. Candidates are NOT staff — do NOT provision a
  // `User` row; the portal resolves identity by email against `Candidate` records.
  // The session now exists; just send them to their portal page.
  const portalNext = isSafePortalNext(searchParams.get('next'));
  if (portalNext) {
    return NextResponse.redirect(`${origin}${portalNext}`);
  }

  // Recognize an existing staff/owner user by LINKED Supabase id only — staff are
  // linked at invite time (B2), so there is no email-join here. An invited staff
  // member arriving via the Supabase invite email already carries their linked id.
  const existingUser = await db.user.findFirst({
    where: { supabaseUserId: supabaseUser.id },
    select: { id: true },
  });

  if (existingUser) {
    // Back to the page the user was on before signing in (validated same-origin path), else home.
    const destination = safeStaffRedirectPath(searchParams.get('redirect')) ?? '/dashboard';
    return NextResponse.redirect(`${origin}${destination}`);
  }

  // New user — check if platform owner. The allowlist check and the insert share the removal's advisory
  // lock (platform-owner access-2), so an address removed meanwhile is never provisioned.
  const ownerEmail = supabaseUser.email;
  const ownerCreated = await provisionPlatformOwner(ownerEmail, (tx) =>
    tx.user.create({
      data: {
        supabaseUserId: supabaseUser.id,
        email: ownerEmail,
        firstName:
          supabaseUser.user_metadata?.full_name?.split(' ')[0] ||
          supabaseUser.user_metadata?.name?.split(' ')[0] ||
          'Admin',
        lastName:
          supabaseUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') ||
          supabaseUser.user_metadata?.name?.split(' ').slice(1).join(' ') ||
          '',
        avatar: supabaseUser.user_metadata?.avatar_url,
        isPlatformOwner: true,
        lastLoginAt: new Date(),
      },
      select: { id: true },
    }),
  );
  if (ownerCreated) {
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // New user — company sign-up (create org + admin). The account type may arrive as
  // a query param (OAuth redirect) OR only in user_metadata (email/password signUp),
  // so check both — otherwise a password company signup falls through.
  if (accountType === 'company' || supabaseUser.user_metadata?.account_type === 'company') {
    // Invitation-only deployments (SELF_SERVE_SIGNUP_ENABLED off — the production default) never mint
    // an organization here. Drop the fresh session first: /login bounces signed-in users away, which
    // would swallow the message.
    if (!isSelfServeSignupEnabled()) {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=registration_closed`);
    }
    const companyName =
      supabaseUser.user_metadata?.company_name || `${supabaseUser.email.split('@')[1].split('.')[0]} Org`;
    const slug = slugify(companyName);

    // Create org + user + role in transaction
    await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: companyName,
          slug: `${slug}-${Date.now().toString(36)}`,
          plan: 'trial',
          billingEmail: supabaseUser.email!,
        },
      });

      // Default Company + BusinessUnit + Team + starter entitlements bundle,
      // so a brand-new org is immediately usable instead of an empty shell
      // that needs manual setup first (Sprint 1.2 onboarding automation).
      await provisionOrgDefaults(tx, org.id, companyName);
      await provisionOrgEntitlements(tx, org.id);

      await provisionOrgRoles(tx, org.id);
      const role = await tx.role.findUniqueOrThrow({
        where: { organizationId_slug: { organizationId: org.id, slug: 'super_admin' } },
        select: { id: true },
      });

      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          supabaseUserId: supabaseUser.id,
          email: supabaseUser.email!,
          firstName: supabaseUser.user_metadata?.full_name?.split(' ')[0] || 'Admin',
          lastName: supabaseUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '',
          avatar: supabaseUser.user_metadata?.avatar_url,
          lastLoginAt: new Date(),
        },
      });

      await tx.userRole.create({
        data: { userId: user.id, roleId: role.id },
      });

      // Create subscription
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          plan: 'trial',
          status: 'trialing',
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        },
      });
    });

    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // Not a staff/owner/company session and no linked row. Candidates do NOT get a
  // `users` row — they use the careers portal magic-link, which resolves identity by
  // email against Candidate records (candidateProcedure). Creating a `users` row here
  // would, under id-only recognition, mint an org-less "staff" identity. Clear the
  // dangling session instead. (Replaces the legacy candidate-account creation.) `reason=no_access`
  // makes /login say why (no TIMS access yet, open the invitation or the careers portal) instead of
  // silently showing the sign-in form again.
  return NextResponse.redirect(`${origin}/logout?reason=no_access`);
}
