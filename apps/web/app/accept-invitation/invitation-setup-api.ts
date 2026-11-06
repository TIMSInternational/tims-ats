import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { getAuthRedirectUrl } from '@tims/shared';
import { ensureCanonicalAuthOrigin } from '../../lib/auth/canonical-auth-origin';
import { z } from 'zod';

export const invitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  organizationId: z.string().uuid(),
  organizationName: z.string().max(200),
  roleSlug: z.string().max(50).nullable(),
  status: z.enum(['pending', 'sent', 'accepted', 'expired', 'revoked']),
  expiresAt: z.string().max(40),
  accountExists: z.boolean(),
  setupCompleted: z.boolean(),
});
export const resultSchema = z.object({ outcome: z.string() });
export type Invitation = z.infer<typeof invitationSchema>;

export function invitationUnavailable(invitation: Invitation | undefined, now = Date.now()) {
  return (
    !invitation ||
    (!['pending', 'sent'].includes(invitation.status) &&
      !(invitation.status === 'accepted' && invitation.setupCompleted)) ||
    new Date(invitation.expiresAt).getTime() <= now
  );
}

export class SetupRequestError extends Error {
  constructor(
    public readonly code: 'mfa_required' | 'setup_unavailable',
    /** HTTP status of the relay response, when there was one (a network failure has none). */
    public readonly status?: number,
  ) {
    super(code);
  }
}

/** A preview the API positively refused (unknown or malformed token), as opposed to one that could not load. */
export function isInvitationRefused(failure: unknown): boolean {
  return failure instanceof SetupRequestError && (failure.status === 404 || failure.status === 400);
}

export async function setupRequest(action: string, input: Record<string, string>, accessToken?: string) {
  const response = await fetch(`/api/invitation-setup/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(await response.json().catch(() => null));
    throw new SetupRequestError(
      error.success && error.data.error === 'mfa_required' ? 'mfa_required' : 'setup_unavailable',
      response.status,
    );
  }
  return response.json() as Promise<unknown>;
}

let isolatedClient: SupabaseClient | undefined;

/**
 * Password sign-in on a separate, in-memory Supabase client. It never writes, refreshes or broadcasts the
 * browser's shared session, so an account that signs in from another tab while this request (or the API call
 * after it) is in flight is left alone. The page adopts the session into the browser only after the API
 * accepted it (use-invitation-setup.ts `adopt`). Never sign this client out: it holds the session the browser
 * adopted, and a sign-out would revoke it.
 */
export function invitationPasswordSignIn(credentials: { email: string; password: string }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase is not configured');
  isolatedClient ??= createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'tims-invitation-setup',
    },
  });
  return isolatedClient.auth.signInWithPassword(credentials);
}

export function invitationSocialSignIn(provider: 'google' | 'azure', token: string) {
  return createSupabaseBrowserClient().auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback?invitation=${encodeURIComponent(token)}`,
      ...(provider === 'azure' ? { scopes: 'openid profile email' } : {}),
    },
  });
}

// Emailed link: always the configured app origin (#50). Throws AppOriginConfigError when
// the origin is misconfigured; callers already treat a rejection as a failed send.
export function invitationRecoveryRedirect(token: string) {
  return getAuthRedirectUrl('/auth/callback', { invitation: token, recovery: '1' });
}

export async function invitationRecovery(email: string, token: string) {
  // Never start the PKCE flow off the configured origin; the page is navigating there instead (#50).
  if (!ensureCanonicalAuthOrigin()) return new Promise<never>(() => {});
  return createSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
    redirectTo: invitationRecoveryRedirect(token),
  });
}
