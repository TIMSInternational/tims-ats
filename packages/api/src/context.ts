export interface TRPCContext {
  user: {
    id: string;
    supabaseUserId: string;
    email: string;
    organizationId: string;
    roles: string[];
    isPlatformOwner: boolean;
    // Set ONLY when a platform owner is impersonating this user — the id of the
    // real owner behind the session. Lets audit logs attribute impersonated
    // actions to the human operator. Absent in normal sessions.
    impersonatorId?: string;
  } | null;
  // The Supabase-authenticated identity, INDEPENDENT of the staff `user` above.
  // Candidates (portal magic-link logins) have a Supabase session but no `User`
  // row, so `user` is null for them — yet they are authenticated. This field
  // carries that identity so `candidateProcedure` can resolve a `Candidate` by
  // email. Present whenever a Supabase session exists (staff OR candidate); null
  // only for genuinely anonymous requests.
  supabaseAuth: { email: string; userId: string } | null;
  // The API-key-authenticated external principal, INDEPENDENT of `user`/`supabaseAuth`.
  // Populated by the `requireApiKey` middleware (NOT by createContext) for the
  // `external` integration surface. Optional so existing context construction in
  // route.ts (which never sets it) stays valid; null/absent for all other requests.
  externalAuth?: { apiKeyId: string; organizationId: string; scopes: string[] } | null;
  // The session's Supabase Authenticator Assurance Level ('aal1' | 'aal2'), forwarded
  // by the auth middleware via the trusted `x-tims-auth-aal` header (local JWT decode,
  // no extra round-trip). Read by the CB-2a MFA-enforcement middleware. Absent/null
  // for anonymous requests or when the middleware path did not set it.
  aal?: string | null;
  headers: Headers;
}

export async function createContext(opts?: { headers: Headers }): Promise<TRPCContext> {
  return {
    user: null,
    supabaseAuth: null,
    headers: opts?.headers ?? new Headers(),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
