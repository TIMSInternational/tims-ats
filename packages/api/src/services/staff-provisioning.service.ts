import { TRPCError } from '@trpc/server';
import { db } from '@tims/db';

// B2 — invite-time staff linking (see docs/SECURITY-staff-candidate-auth-linking.md).
//
// A staff `User` row is linked to its Supabase identity AT CREATION, so the system
// never has to join them later by email (the ambient, cross-tenant-unsafe mechanism
// codex flagged). `resolveStaffSupabaseUserId(email)` returns the Supabase auth user
// id to stamp on the new row:
//   - If a Supabase auth user already exists for this email (e.g. the person applied
//     as a candidate via the portal magic-link, which created an auth user), reuse
//     that id — one identity, linked directly. No duplicate, no email-join.
//   - Otherwise invite a fresh Supabase user (sends the "set your password" email);
//     the returned id is stamped immediately.
//
// Supabase enforces a unique (case-insensitive) email on auth.users, so the lookup
// returns at most one. We read auth.users via the privileged Postgres connection
// (same approach as force-logout reading auth.sessions) because the JS admin SDK has
// no get-user-by-email.
export async function resolveStaffSupabaseUserId(email: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Servicio de autenticacion no configurado',
    });
  }

  // 1. Existing Supabase identity for this email? Reuse it. Otherwise invite a new
  //    one (Supabase sends the set-password email).
  const existing = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM auth.users WHERE lower(email) = lower(${email}) LIMIT 1
  `;

  let supabaseUserId: string;
  if (existing.length > 0 && existing[0]) {
    supabaseUserId = existing[0].id;
  } else {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.timsats.com';
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/auth/callback`,
    });
    if (error || !data?.user?.id) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'No se pudo crear la identidad de autenticacion del usuario',
      });
    }
    supabaseUserId = data.user.id;
  }

  // 2. Global-uniqueness guard: User.supabaseUserId is @unique, so the caller's
  //    insert would 500 on P2002 if this identity already owns a row. Uses the
  //    privileged db so the check spans all orgs, not just the current tenant.
  const owner = await db.user.findUnique({
    where: { supabaseUserId },
    select: { id: true, organizationId: true, isPlatformOwner: true },
  });
  if (owner) {
    // A REAL staff identity (org-scoped or platform owner) → the person already has
    // an account; surface a clean CONFLICT instead of a raw P2002.
    if (owner.isPlatformOwner || owner.organizationId) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Este correo ya tiene una cuenta de usuario',
      });
    }
    // Otherwise it's a LEGACY org-less, non-owner artifact — a row minted by the
    // now-removed register-candidate flow (candidates use the portal, never a `User`
    // row). It is not a usable identity (the staff-recognition guards reject it), but
    // it holds the globally-unique auth id. Tombstone it (soft-delete + unlink) so
    // the real staff row about to be created can take the id. The bulk backfill does
    // the same proactively; this covers any straggler at provisioning time.
    await db.user.update({
      where: { id: owner.id },
      data: { supabaseUserId: `tombstone-${owner.id}`, isActive: false, deletedAt: new Date() },
    });
  }

  return supabaseUserId;
}
