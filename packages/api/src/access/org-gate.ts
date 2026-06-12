import { TRPCError } from '@trpc/server';
import type { AccessContext } from './types';

// Interim gate for org-rollup analytics endpoints (recruitment-analytics,
// people dashboards): the underlying queries aggregate ORG-WIDE, so narrow
// scopes must not read them until the aggregates are scope-aware (recorded
// follow-up in REMAINING-WORK). No-op at org/company scope — deploy-neutral.
export function requireOrgScope(access: AccessContext): void {
  if (access.scope !== 'organization' && access.scope !== 'company') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Disponible solo con alcance de organizacion',
    });
  }
}
