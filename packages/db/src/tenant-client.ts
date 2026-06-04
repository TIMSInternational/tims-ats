import { PrismaClient } from '@prisma/client';
import { db } from './client';
import { getTenantOrgId } from './tenant-context';

// Tenant-scoped Prisma client. For each operation it sets the Postgres
// `app.current_org_id` GUC (read by the RLS policies) in the SAME transaction as
// the query, so the transaction-local setting actually applies on pooled
// connections. The org id comes from AsyncLocalStorage (see tenant-context.ts).
//
// ROLLOUT GATING: RLS only enforces when the connection is the NON-bypass
// `app_tenant` role. Until TENANT_DATABASE_URL is set to that role's connection
// string, this client falls back to the base `db` (privileged) connection and is a
// transparent passthrough — identical behavior to before, no extra round-trips.
// See docs/security/RLS-MIGRATION-PLAN.md for the cutover steps.
const RLS_ENFORCED = !!process.env.TENANT_DATABASE_URL;

const tenantBase: PrismaClient = RLS_ENFORCED
  ? new PrismaClient({
      datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    })
  : db;

export const tenantDb = tenantBase.$extends({
  name: 'tenantRls',
  query: {
    async $allOperations({ args, query }) {
      const orgId = getTenantOrgId();
      // Not enforced yet, or no org in scope (platform owner / system job): run as-is.
      if (!RLS_ENFORCED || !orgId) {
        return query(args);
      }
      // set_config(..., is_local=true) is transaction-scoped; batching it with the
      // query guarantees they share one transaction/connection so RLS sees the org.
      const [, result] = await tenantBase.$transaction([
        tenantBase.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`,
        query(args),
      ]);
      return result;
    },
  },
});

export type TenantDb = typeof tenantDb;
