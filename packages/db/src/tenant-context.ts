import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request tenant context. The tRPC context builder wraps each request in
// runWithTenant(orgId, …) using the org id derived from the VERIFIED Supabase
// session. The tenant Prisma client (see tenant-client.ts) reads this to set the
// Postgres `app.current_org_id` GUC that RLS policies enforce against.
//
// orgId is null for platform owners / system jobs (no single org) — those must use
// the privileged base `db` client, not the tenant-scoped one.

interface TenantStore {
  orgId: string | null;
}

const storage = new AsyncLocalStorage<TenantStore>();

export function runWithTenant<T>(orgId: string | null, fn: () => T): T {
  return storage.run({ orgId }, fn);
}

export function getTenantOrgId(): string | null {
  return storage.getStore()?.orgId ?? null;
}
