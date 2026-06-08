import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@tims/auth/server';
import { db } from '@tims/db';
import { IMPERSONATION_COOKIE, readImpersonationCookie, verifyImpersonationToken } from '@tims/api';

// Stop impersonation. Reads the REAL Supabase session (always the owner — the
// session is never swapped, impersonation is cookie-only) and is gated to
// platform owners so a tenant user can't abort an owner's session.
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

  // Identify the impersonated target from the cookie so the audit log records
  // WHO was impersonated, under a valid (target) org — platform owners are
  // org-less, so the owner's org can't be used for the non-nullable FK.
  const payload = verifyImpersonationToken(readImpersonationCookie(req.headers.get('cookie')));
  if (payload) {
    const target = await db.user.findUnique({
      where: { id: payload.targetUserId },
      select: { organizationId: true },
    });
    if (target?.organizationId) {
      await db.auditLog.create({
        data: {
          organizationId: target.organizationId,
          actorId: owner.id,
          action: 'impersonation_stopped',
          entity: 'user',
          entityId: payload.targetUserId,
        },
      }).catch(() => {});
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(IMPERSONATION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
