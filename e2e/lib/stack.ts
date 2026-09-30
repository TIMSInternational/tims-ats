import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** What scripts/e2e/up.sh wrote to e2e/.state/stack.json. */
export interface Stack {
  baseURL: string;
  apiURL: string;
  supabaseURL: string;
  databaseURL: string;
  localstackURL: string;
  ownerCredsFile: string;
  /** The throwaway CA that signed the stack's TLS certs (trusted explicitly, never bypassed). */
  caFile: string;
}

export const STATE_DIR = join(__dirname, '..', '.state');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);

/**
 * Throws unless `url` points at this machine. This is the suite's guard against ever touching
 * production or the live Supabase project: every URL the specs use comes through here.
 */
export function assertLocalUrl(label: string, url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[e2e] ${label} is not a valid URL — refusing to run`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `[e2e] ${label} points at non-local host "${host}" — the E2E suite only runs against the local stack`,
    );
  }
}

export function readStack(): Stack {
  const file = process.env.E2E_STACK_FILE ?? join(STATE_DIR, 'stack.json');
  if (!existsSync(file)) {
    throw new Error(`[e2e] ${file} not found — bring the stack up first: bash scripts/e2e/up.sh`);
  }
  const stack = JSON.parse(readFileSync(file, 'utf8')) as Stack;
  for (const key of ['baseURL', 'apiURL', 'supabaseURL', 'databaseURL', 'localstackURL'] as const) {
    assertLocalUrl(key, stack[key]);
  }
  return stack;
}

export interface Credentials {
  email: string;
  password: string;
}
