import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { HarnessConfig } from './config';

export type TokenCache = Map<string, string>;
export type SignIn = (email: string, password: string) => Promise<string>;

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
