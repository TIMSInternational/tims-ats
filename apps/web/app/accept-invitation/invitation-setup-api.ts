import { createSupabaseBrowserClient } from '@tims/auth/client';
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

export async function setupRequest(action: string, input: Record<string, string>, accessToken?: string) {
  const response = await fetch(`/api/invitation-setup/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('setup_failed');
  return response.json() as Promise<unknown>;
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
