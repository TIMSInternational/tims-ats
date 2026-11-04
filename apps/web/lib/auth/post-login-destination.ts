// Carries the page a staff user was signing in to across the mandatory MFA step.
//
// The (admin) MFA gate redirects a privileged aal1 session to a bare /mfa, and /mfa's `returnTo` is
// deliberately limited to the invitation / password-setup round trips (mfa-return.ts). So the login
// form remembers its validated `redirect` here (per tab, for a few minutes) and /mfa takes it once —
// only when MFA was mandatory, i.e. the user was forced through the gate right after signing in.
// Read back through the same validator, so a tampered value can never leave the origin.
import { z } from 'zod';
import { safeStaffRedirectPath } from './staff-login-redirect';

const KEY = 'tims-post-login-destination';
const TTL_MS = 10 * 60 * 1000;
const storedSchema = z.object({ path: z.string().max(2048), at: z.number() });

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // storage disabled (privacy mode): the user simply lands on the dashboard
  }
}

/** Remember `path` (if it is a safe, non-root staff page); otherwise forget any earlier value. */
export function rememberPostLoginDestination(path: string, store: Store | null = browserStore(), now = Date.now()) {
  if (!store) return;
  try {
    const safe = safeStaffRedirectPath(path);
    if (!safe || safe === '/') store.removeItem(KEY);
    else store.setItem(KEY, JSON.stringify({ path: safe, at: now }));
  } catch {
    // quota / disabled storage: nothing to carry
  }
}

/** Take (and forget) the remembered page, or null when absent, expired, malformed or unsafe. */
export function takePostLoginDestination(store: Store | null = browserStore(), now = Date.now()): string | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    store.removeItem(KEY);
    if (!raw) return null;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.at > now || now - parsed.data.at > TTL_MS) return null;
    return safeStaffRedirectPath(parsed.data.path);
  } catch {
    return null;
  }
}
