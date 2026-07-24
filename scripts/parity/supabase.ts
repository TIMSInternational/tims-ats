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

/** Renders captured `{name,value}` cookies into a single `Cookie:` request-header
 *  string. Chunked sessions (`sb-<ref>-auth-token.0`/`.1`, past ~3180 bytes) join
 *  with `'; '` — a valid multi-cookie header that `@supabase/ssr` reassembles on
 *  read. base64url values need no URL-encoding (all valid cookie octets). Pure +
 *  unit-tested (the chunk-join is the most bug-prone bit of the capture). */
export function formatCookieHeader(cookies: { name: string; value: string }[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

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
      // Accumulate by name across every setAll (upsert, later-wins) rather than
      // keeping only the last batch — robust if @supabase/ssr ever splits a
      // clear-then-set into two calls. A fresh sign-in (getAll → []) fires one
      // setAll with just the sb-<ref>-auth-token chunk(s).
      const captured = new Map<string, string>();
      const client = createServerClient(cfg.supabaseUrl, cfg.anonKey, {
        cookies: {
          getAll: () => [],
          setAll: (cookies) => {
            for (const { name, value } of cookies) captured.set(name, value);
          },
        },
      });
      const { data, error } = await client.auth.signInWithPassword({ email: e, password: p });
      if (error || !data.session) throw new Error(`getSessionCookie: signIn failed for ${e}: ${error?.message ?? 'no session returned'}`);
      if (captured.size === 0)
        throw new Error(`getSessionCookie: signIn for ${e} produced no auth cookies (setAll was not invoked)`);
      return formatCookieHeader([...captured].map(([name, value]) => ({ name, value })));
    },
    email,
    password,
    cache
  );
}
