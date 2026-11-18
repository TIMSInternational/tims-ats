'use client';

import { trpc } from '../../../../lib/trpc';
import { usePermissions } from '../../../../lib/permissions';

/** Same cache window as the PermissionsProvider's session query, so this reads the cached result. */
const SESSION_STALE_MS = 5 * 60 * 1000;

type SessionPermission = { module: string; action: string; scope: string | null };

/** True when one of the grants reads onboarding for the whole organization (or company). */
export function hasOrgWideOnboardingRead(permissions: readonly SessionPermission[]): boolean {
  return permissions.some(
    (p) => p.module === 'onboarding' && p.action === 'read' && (p.scope === 'organization' || p.scope === 'company'),
  );
}

/**
 * B-09 / E-08: the onboarding KPI strip aggregates the whole organization, so the API refuses it to a
 * team-scoped leader (requireOrgScope). The page only asks for it — and only shows it — when the caller
 * reads onboarding org-wide. Unknown while the session loads (false: the strip appears once known).
 */
export function useOnboardingOrgScope(): boolean {
  const { isPrivileged } = usePermissions();
  const session = trpc.auth.getSessionInfo.useQuery(undefined, { staleTime: SESSION_STALE_MS, enabled: !isPrivileged });
  if (isPrivileged) return true;
  return hasOrgWideOnboardingRead(session.data?.permissions ?? []);
}
