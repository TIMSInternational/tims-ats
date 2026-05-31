export interface TRPCContext {
  user: {
    id: string;
    supabaseUserId: string;
    email: string;
    organizationId: string;
    roles: string[];
    isPlatformOwner: boolean;
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
