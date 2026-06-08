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
  headers: Headers;
}

export async function createContext(opts?: { headers: Headers }): Promise<TRPCContext> {
  return {
    user: null,
    headers: opts?.headers ?? new Headers(),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
