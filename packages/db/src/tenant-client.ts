import { db } from './client';
import { getTenantOrgId } from './tenant-context';

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
      // Not enforced, or no org in scope (platform owner / system job): run unscoped.
      if (!RLS_ENFORCED || !orgId) {
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
