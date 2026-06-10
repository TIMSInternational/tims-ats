import { createSupabaseServerClient } from '@tims/auth/server';
import { NextResponse } from 'next/server';
import { db } from '@tims/db';
import { isSafePortalNext } from '../../../lib/portal-auth';

async function isPlatformOwnerEmail(email: string): Promise<boolean> {
  const entry = await db.platformOwnerEmail.findUnique({ where: { email } });
  return !!entry;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const accountType = searchParams.get('type') || null; // 'candidate' | 'company' | null

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  }

  // Get the authenticated user
  const { data: { user: supabaseUser } } = await supabase.auth.getUser();
  if (!supabaseUser?.email) {
    return NextResponse.redirect(`${origin}/login?error=no_email`);
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
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // New user — check if platform owner
  if (await isPlatformOwnerEmail(supabaseUser.email)) {
    await db.user.create({
      data: {
        supabaseUserId: supabaseUser.id,
        email: supabaseUser.email,
        firstName: supabaseUser.user_metadata?.full_name?.split(' ')[0] || supabaseUser.user_metadata?.name?.split(' ')[0] || 'Admin',
        lastName: supabaseUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || supabaseUser.user_metadata?.name?.split(' ').slice(1).join(' ') || '',
        avatar: supabaseUser.user_metadata?.avatar_url,
        isPlatformOwner: true,
        lastLoginAt: new Date(),
      },
    });
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // New user — company sign-up (create org + admin). The account type may arrive as
  // a query param (OAuth redirect) OR only in user_metadata (email/password signUp),
  // so check both — otherwise a password company signup falls through.
  if (accountType === 'company' || supabaseUser.user_metadata?.account_type === 'company') {
    const companyName = supabaseUser.user_metadata?.company_name || `${supabaseUser.email.split('@')[1].split('.')[0]} Org`;
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

      // Create default super_admin role for the org
      const role = await tx.role.create({
        data: {
          organizationId: org.id,
          name: 'Super Administrador',
          slug: 'super_admin',
          isSystem: true,
        },
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
  // dangling session instead. (Replaces the legacy candidate-account creation.)
  return NextResponse.redirect(`${origin}/logout`);
}
