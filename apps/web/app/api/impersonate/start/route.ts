import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@tims/auth/server';
import { db } from '@tims/db';
import { signImpersonationToken, IMPERSONATION_COOKIE } from '@tims/api';
import { isMfaEnforced, isMfaSatisfied, MFA_REQUIRED } from '@tims/shared';

// Start impersonation. Re-verifies the REAL Supabase session is a platform owner
// server-side (never trusts the client) before issuing the signed cookie.
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const owner = await db.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true, isPlatformOwner: true },
  });
  if (!owner?.isPlatformOwner) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // CB-2a: this is a privileged RAW REST action (not a tRPC procedure), so the tRPC
  // MFA gate does not cover it. Enforce MFA here too — otherwise an aal1 owner could
  // start impersonation and operate as a non-privileged target, escaping step-up. Same
  // fail-open flag + aal2 requirement as the (admin) page gate and the tRPC gate.
  if (isMfaEnforced(process.env.MFA_ENFORCED)) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!isMfaSatisfied(aal?.currentLevel)) {
      // 403 + marker so the client redirects the owner to /mfa to step up.
      return NextResponse.json({ error: MFA_REQUIRED }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const userId = (body as { userId?: unknown })?.userId;
  if (typeof userId !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isPlatformOwner: true, isActive: true, organizationId: true },
  });
  if (!target || !target.organizationId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (target.isPlatformOwner) {
    return NextResponse.json({ error: 'cannot_impersonate_owner' }, { status: 400 });
  }
  if (!target.isActive) {
    return NextResponse.json({ error: 'inactive_user' }, { status: 400 });
  }

  const token = signImpersonationToken(owner.id, target.id);

  await db.auditLog.create({
    data: {
      organizationId: target.organizationId,
      actorId: owner.id,
      action: 'impersonation_started',
      entity: 'user',
      entityId: target.id,
    },
  }).catch(() => {});

  const res = NextResponse.json({ ok: true });
  res.cookies.set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
  return res;
}
