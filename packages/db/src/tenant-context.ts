import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request tenant context. The tRPC context builder wraps each request in
// runWithTenant(orgId, …) using the org id derived from the VERIFIED Supabase
// session. The tenant Prisma client (see tenant-client.ts) reads this to set the
// Postgres `app.current_org_id` GUC that RLS policies enforce against.
//
// tenantDb FAILS CLOSED when no tenant is in scope: a query with neither an org nor an
// explicit unscoped opt-in throws instead of silently running UNSCOPED on the
// privileged BYPASSRLS login role. Legitimate cross-tenant / system work must say so
// with runUnscoped(reason, …) — a named, greppable opt-in — or use the privileged base
// `db` client directly.

interface TenantStore {
  orgId: string | null;
  // Non-null ONLY inside runUnscoped(): the caller's stated reason for running a
  // tenantDb query without a tenant. Null everywhere else, including runWithTenant(null).
  unscopedReason: string | null;
}

const storage = new AsyncLocalStorage<TenantStore>();

// Prisma queries are LAZY: a PrismaPromise does nothing until .then is called, and the
// tenantDb extension reads the tenant context at THAT moment. A callback that returns a
// query without awaiting it — `runWithTenant(org, () => tenantDb.x.findFirst(...))` —
// would otherwise execute after storage.run() has exited, i.e. with no tenant in scope
// (fail-closed throw today; silently UNSCOPED before the guard). So if the callback
// returns a thenable, subscribe to it HERE, inside the scope: calling .then inside
// storage.run() starts the query with this store active. Real Promises are unaffected
// (already running); the wrapper only adds a tick. The cast is sound for every caller
// that awaits the result, which is the only way a thenable result is consumed.
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function runInStore<T>(store: TenantStore, fn: () => T): T {
  return storage.run(store, () => {
    const result = fn();
    if (!isThenable(result)) return result;
    return new Promise<unknown>((resolve, reject) => {
      result.then(resolve, reject);
    }) as T;
  });
}

export function runWithTenant<T>(orgId: string | null, fn: () => T): T {
  return runInStore({ orgId, unscopedReason: null }, fn);
}

/**
 * Explicit opt-in for tenantDb queries that legitimately run WITHOUT a tenant: an
 * org-less platform owner, or a public token-authorised flow whose token lookup is
 * cross-tenant by nature. Queries inside run exactly as before this guard existed —
 * unscoped on the privileged login role — so every use must name why. Prefer
 * runWithTenant(orgId, …) whenever the org is known. packages/db has no logger; in
 * packages/api use `runUnscopedLogged` (lib/unscoped.ts), which logs the reason.
 */
export function runUnscoped<T>(reason: string, fn: () => T): T {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new Error('runUnscoped requires a non-empty reason');
  }
  return runInStore({ orgId: null, unscopedReason: trimmed }, fn);
}

export function getTenantOrgId(): string | null {
  return storage.getStore()?.orgId ?? null;
}

/** The reason passed to the enclosing runUnscoped(), or null when not inside one. */
export function getUnscopedReason(): string | null {
  return storage.getStore()?.unscopedReason ?? null;
}
