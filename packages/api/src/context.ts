import type { CreateNextContextOptions } from '@trpc/server/adapters/next';
import { createClient } from '@supabase/supabase-js';

export interface TRPCContext {
  user: {
    id: string;
    supabaseUserId: string;
    email: string;
    organizationId: string;
    roles: string[];
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
