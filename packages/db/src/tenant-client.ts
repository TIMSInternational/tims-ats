import type { Prisma } from '@prisma/client';
import { db } from './client';
import { getTenantOrgId } from './tenant-context';
import { assertRlsEnforced } from './rls-guard';

// Tenant-scoped Prisma client for RLS enforcement.
//
// The app connects as the privileged `postgres` role (the only role the Supabase
// Supavisor pooler reliably authenticates). For each tenant operation we run, inside
// a single transaction:
//   1. SET LOCAL ROLE app_tenant   -- drop to the NON-bypass role so RLS policies apply
//   2. set_config('app.current_org_id', <org>, true)  -- the GUC the policies read
//   3. the actual query
// Because RLS bypass is evaluated against the *current* role, SET LOCAL ROLE makes the
// query subject to RLS even though the login role (postgres) has BYPASSRLS. This avoids
// authenticating a custom role through Supavisor (which it rejects) and needs no second
// connection pool. Requires `GRANT app_tenant TO postgres` (in the RLS migration).
//
// SET LOCAL / set_config(..., true) are transaction-scoped, so this is safe on the
// transaction-mode pooler. Enable with RLS_ENFORCED=true once the migration is applied.
const RLS_ENFORCED = process.env.RLS_ENFORCED === 'true';

export const tenantDb = db.$extends({
  name: 'tenantRls',
  query: {
    async $allOperations({ args, query }) {
      const orgId = getTenantOrgId();
      // No org in scope (platform owner / system job): legitimately run unscoped.
      if (!orgId) {
        return query(args);
      }
      // Tenant op but RLS disabled: fail CLOSED in production so a misconfigured
      // deploy never silently runs unscoped on the BYPASSRLS login role. Dev/test
      // keep the unscoped convenience path. (Checked per-op, not at module load, so
      // `next build` — which runs as production but executes no queries — is safe.)
      if (!RLS_ENFORCED) {
        assertRlsEnforced(process.env.NODE_ENV, RLS_ENFORCED);
        return query(args);
      }
      const [, , result] = await db.$transaction([
        db.$executeRaw`SET LOCAL ROLE app_tenant`,
        db.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`,
        query(args),
      ]);
      return result;
    },
  },
});

export type TenantDb = typeof tenantDb;

// Interactive-transaction counterpart to tenantDb. tenantDb's $allOperations
// extension gives each individual query its OWN self-contained mini-transaction
// (SET LOCAL ROLE + set_config + that one query, batched via db.$transaction on
// the closed-over base `db`) — composing it with an outer $transaction does NOT
// make multiple writes atomic, because each nested tenantDb.* call still commits
// independently (documented Prisma limitation: client extensions in interactive
// transactions are bound to the base client, prisma/prisma#17948). Call sites
// that need several writes to succeed or fail together (e.g. Wave 1.5a
// submitAssessment: grade N responses + upsert the result + mark the assignment
// completed) must use this instead: it sets the RLS role/GUC ONCE as the first
// statements of a single interactive transaction, then hands the SAME
// transactional client to fn() so every write inside shares that one atomic
// boundary. RLS_ENFORCED is read at call time (not module load) so it composes
// with vi.stubEnv in tests without needing vi.resetModules().
export function runTenantTransaction<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      const rlsEnforced = process.env.RLS_ENFORCED === 'true';
      if (!rlsEnforced) {
        assertRlsEnforced(process.env.NODE_ENV, rlsEnforced);
        return fn(tx);
      }
      await tx.$executeRaw`SET LOCAL ROLE app_tenant`;
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      return fn(tx);
    },
    // Generous enough for a 200-answer submission's sequential round-trips
    // (Wave 1.5a slice 2 review finding #3) — default is 5s.
    { timeout: 30000 },
  );
}
