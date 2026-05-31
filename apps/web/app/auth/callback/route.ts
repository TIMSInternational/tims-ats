import { createSupabaseServerClient } from '@tims/auth/server';
import { NextResponse } from 'next/server';
import { db } from '@tims/db';

const PLATFORM_OWNER_EMAILS = [
  'federico@nexadev.ai',
  'fedetafur@vt.edu',
  'fedetafur@gmail.com',
  'fedetafur2@gmail.com',
  'fedetafur3@gmail.com',
  'fedetafur4@gmail.com',
  'andres@nexadev.ai',
];

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

  // Check if user already exists
  const existingUser = await db.user.findFirst({
    where: {
      OR: [
        { supabaseUserId: supabaseUser.id },
        { email: supabaseUser.email },
      ],
    },
  });

  if (existingUser) {
    // Link supabase ID if not already linked
    if (existingUser.supabaseUserId !== supabaseUser.id) {
      await db.user.update({
        where: { id: existingUser.id },
        data: {
          supabaseUserId: supabaseUser.id,
          avatar: supabaseUser.user_metadata?.avatar_url || existingUser.avatar,
          lastLoginAt: new Date(),
        },
      });
    }

    if (existingUser.isPlatformOwner) {
      return NextResponse.redirect(`${origin}/dashboard`);
    }
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // New user — check if platform owner
  if (PLATFORM_OWNER_EMAILS.includes(supabaseUser.email)) {
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

  // New user — company sign-up (create org + admin)
  if (accountType === 'company') {
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

  // New user — candidate sign-up (no org, just user record)
  await db.user.create({
    data: {
      supabaseUserId: supabaseUser.id,
      email: supabaseUser.email,
      firstName: supabaseUser.user_metadata?.full_name?.split(' ')[0] || supabaseUser.user_metadata?.name?.split(' ')[0] || 'Candidato',
      lastName: supabaseUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || supabaseUser.user_metadata?.name?.split(' ').slice(1).join(' ') || '',
      avatar: supabaseUser.user_metadata?.avatar_url,
      lastLoginAt: new Date(),
    },
  });

  // TODO: redirect candidates to portal instead of dashboard
  return NextResponse.redirect(`${origin}/dashboard`);
}
