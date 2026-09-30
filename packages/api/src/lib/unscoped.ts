import { runUnscoped } from '@tims/db';
import { logger } from '@tims/shared';

// Every legitimate reason a request may run `tenantDb` queries with NO tenant in
// scope. tenantDb fails closed otherwise (packages/db/src/tenant-client.ts). Adding a
// reason here is a security decision — it re-opens the unscoped, BYPASSRLS path for
// that caller — so each one names the exact caller it exists for.
export type UnscopedReason =
  // A platform owner with no org row of their own, on a protectedProcedure. Platform
  // routers use the privileged `db`; tenant routers they reach (e.g. notification.*)
  // keep today's unscoped behavior until each is narrowed. See withTenantContext.
  | 'platform-owner-without-org'
  // offer.getBySigningToken / acceptByToken / declineByToken: an unauthenticated
  // candidate holding a signing token. The token lookup is cross-tenant by nature
  // (the org is unknown until the offer is found).
  | 'offer-signing-token';

/** runUnscoped + a structured log line naming why the tenant guard was bypassed. */
export function runUnscopedLogged<T>(reason: UnscopedReason, fn: () => T): T {
  logger.info({ component: 'tenant-db', unscopedReason: reason }, 'tenantDb: explicit unscoped scope entered');
  return runUnscoped(reason, fn);
}
