/**
 * Production RLS fail-closed guard (called on the tenant-query path in tenant-client).
 *
 * `tenantDb` only drops to the non-bypass `app_tenant` role + sets the org GUC when
 * `RLS_ENFORCED === 'true'`. If that flag is ever unset/false in production, a tenant
 * query would otherwise silently run UNSCOPED on the privileged BYPASSRLS login role —
 * a latent cross-tenant hole with no error and no log. Throw instead of failing open.
 * Non-production (dev/test/preview) keeps the unscoped convenience path.
 */
export function assertRlsEnforced(nodeEnv: string | undefined, rlsEnforced: boolean): void {
  if (nodeEnv === 'production' && !rlsEnforced) {
    throw new Error(
      'RLS_ENFORCED must be "true" in production — refusing to start with tenant RLS disabled.',
    );
  }
}
