'use client';

import { useEffect } from 'react';
import { getCanonicalAuthFlowUrl } from '@tims/shared';

/**
 * Keeps emailed PKCE flows on ONE host (#50, tier-1 review). The emailed link always lands on the
 * configured app origin, and the Supabase browser client keeps the PKCE verifier in a cookie on the
 * host that started the flow, so a reset, sign-up confirmation, portal magic link or invitation
 * recovery started on an alias or preview host would fail at /auth/callback. These helpers move the
 * user to the configured origin BEFORE the flow can start.
 *
 * Returns true when it is safe to start the flow on this page, false when it has started navigating
 * to the configured origin (the caller must then not start the flow).
 */
export function ensureCanonicalAuthOrigin(): boolean {
  if (typeof window === 'undefined') return true;
  const target = getCanonicalAuthFlowUrl(window.location);
  if (target === null) return true;
  window.location.replace(target);
  return false;
}

/** On mount: move a page that starts an emailed auth flow to the configured app origin. */
export function useCanonicalAuthOrigin(): void {
  useEffect(() => {
    ensureCanonicalAuthOrigin();
  }, []);
}
