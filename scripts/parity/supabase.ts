import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { HarnessConfig } from './config';

export type TokenCache = Map<string, string>;
export type SignIn = (email: string, password: string) => Promise<string>;

/** Cache of prebuilt `Cookie:` header strings, keyed by email (like TokenCache). */
export type CookieCache = Map<string, string>;
/** The effectful "sign in and produce the TS session cookie" step, injected so
 *  `getSessionCookieWith` (cache behavior) is unit-testable without a network. */
export type BuildCookie = (email: string, password: string) => Promise<string>;

export function makeAdminClient(cfg: HarnessConfig): SupabaseClient {
  return createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getTokenWith(
  signIn: SignIn,
  email: string,
  password: string,
  cache: TokenCache
): Promise<string> {
  const hit = cache.get(email);
  if (hit) return hit;
  const tok = await signIn(email, password);
  cache.set(email, tok);
  return tok;
}

export async function getToken(
  cfg: HarnessConfig,
  email: string,
  password: string,
  cache: TokenCache
): Promise<string> {
  const anon = createClient(cfg.supabaseUrl, cfg.anonKey, { auth: { persistSession: false } });
  return getTokenWith(
    async (e, p) => {
      const { data, error } = await anon.auth.signInWithPassword({ email: e, password: p });
      if (error || !data.session) throw new Error(`signIn failed for ${e}: ${error?.message}`);
      return data.session.access_token;
    },
    email,
    password,
    cache
  );
}

export async function getSessionCookieWith(
  buildCookie: BuildCookie,
  email: string,
  password: string,
  cache: CookieCache
): Promise<string> {
  const hit = cache.get(email);
  if (hit) return hit;
  const cookie = await buildCookie(email, password);
  cache.set(email, cookie);
  return cookie;
}

/**
 * Signs a seeded user in and returns the exact `Cookie:` header the TS Next.js
 * app authenticates against — the `sb-<ref>-auth-token` session-envelope cookie
 * (base64url-encoded, `base64-`-prefixed, chunked into `.0`/`.1` past ~3180
 * bytes). Rather than hand-roll that encoding (which could drift from the app),
 * this drives the sign-in THROUGH the app's own encoder: `@supabase/ssr`'s
 * `createServerClient` with a capturing `setAll`, so the emitted cookie is
 * byte-identical to what the app writes and reads. `getAll` returns no existing
 * cookies (fresh sign-in), and `setAll` captures whatever the client persists.
 * Verified live against the prod TS app: super_admin → 200, hrbp → 403, no
 * cookie → 401 on `teamIntel.getDashboardKpis`.
 */
export async function getSessionCookie(
  cfg: HarnessConfig,
  email: string,
  password: string,
  cache: CookieCache
): Promise<string> {
  return getSessionCookieWith(
    async (e, p) => {
      let captured: { name: string; value: string }[] = [];
      const client = createServerClient(cfg.supabaseUrl, cfg.anonKey, {
        cookies: {
          getAll: () => [],
          setAll: (cookies) => {
            captured = cookies.map(({ name, value }) => ({ name, value }));
          },
        },
      });
      const { data, error } = await client.auth.signInWithPassword({ email: e, password: p });
      if (error || !data.session) throw new Error(`getSessionCookie: signIn failed for ${e}: ${error?.message ?? 'no session returned'}`);
      if (captured.length === 0)
        throw new Error(`getSessionCookie: signIn for ${e} produced no auth cookies (setAll was not invoked)`);
      return captured.map((c) => `${c.name}=${c.value}`).join('; ');
    },
    email,
    password,
    cache
  );
}
