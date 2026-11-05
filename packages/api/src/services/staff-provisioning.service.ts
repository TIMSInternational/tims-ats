import { TRPCError } from '@trpc/server';
import { db } from '@tims/db';
import { getAppUrl } from '@tims/shared';

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
  return (await provisionStaffIdentity(email)).supabaseUserId;
}

/** The identity a staff row is linked to, and whether Supabase just emailed an invitation for it. */
export type StaffIdentity = {
  supabaseUserId: string;
  /**
   * true: a NEW Supabase user was invited (Supabase sent its "set your password" email).
   * false: an existing identity was reused (e.g. a portal applicant's magic-link identity) and NO email
   * went out — the caller must give the person a way in (the hire hand-off sends a set-password link).
   */
  invited: boolean;
};

function authAdminConfig(): { supabaseUrl: string; serviceKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Servicio de autenticación no configurado',
    });
  }
  return { supabaseUrl, serviceKey };
}

async function authAdminClient(supabaseUrl: string, serviceKey: string) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Same as resolveStaffSupabaseUserId, but also says whether an invitation email was sent. */
export async function provisionStaffIdentity(email: string): Promise<StaffIdentity> {
  const { supabaseUrl, serviceKey } = authAdminConfig();
  // Validate the invite-link origin up front, before any lookup/invite/tombstone write, so a
  // misconfiguration fails before anything is changed (callers create the User row afterwards).
  const appUrl = getAppUrl();

  // 1. Existing Supabase identity for this email? Reuse it. Otherwise invite a new
  //    one (Supabase sends the set-password email).
  const existing = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM auth.users WHERE lower(email) = lower(${email}) LIMIT 1
  `;

  let supabaseUserId: string;
  let invited = false;
  if (existing.length > 0 && existing[0]) {
    supabaseUserId = existing[0].id;
  } else {
    const admin = await authAdminClient(supabaseUrl, serviceKey);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      // Admin invite links use an implicit-flow URL fragment rather than a PKCE
      // code. The browser page must receive that fragment directly so Supabase can
      // establish the invited user's session before they choose a password.
      redirectTo: `${appUrl}/reset-password?setup=1`,
    });
    if (error || !data?.user?.id) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'No se pudo crear la identidad de autenticación del usuario',
      });
    }
    supabaseUserId = data.user.id;
    invited = true;
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

  return { supabaseUserId, invited };
}

/** How long the set-password link request may take before the hire reports it as not sent. */
export const PASSWORD_SETUP_LINK_TIMEOUT_MS = 4_000;

/**
 * A single-use Supabase recovery link that lands on the password page (`/reset-password?setup=1`), for a
 * person whose identity already exists and therefore received no invitation (see `invited` above).
 * Nothing is emailed here: the caller sends it in its own (Spanish) message. Returns null when the link
 * cannot be produced in time or is not a Supabase verify link of THIS project — the caller then tells
 * staff no access email went out, instead of claiming one did.
 */
export async function generatePasswordSetupLink(email: string): Promise<string | null> {
  const { supabaseUrl, serviceKey } = authAdminConfig();
  const appUrl = getAppUrl();
  try {
    const admin = await authAdminClient(supabaseUrl, serviceKey);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PASSWORD_SETUP_LINK_TIMEOUT_MS));
    const result = await Promise.race([
      admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        // Same landing page as the invitation above: the admin client has no PKCE verifier, so the
        // recovery credentials arrive in the URL fragment, which the password page consumes.
        options: { redirectTo: `${appUrl}/reset-password?setup=1` },
      }),
      timeout,
    ]);
    if (!result || result.error) return null;
    const link = result.data?.properties?.action_link;
    if (typeof link !== 'string' || link.length > 4096) return null;
    const parsed = new URL(link);
    if (parsed.protocol !== 'https:' || parsed.origin !== new URL(supabaseUrl).origin) return null;
    return link;
  } catch {
    return null;
  }
}
