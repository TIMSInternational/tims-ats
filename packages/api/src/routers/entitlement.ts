// packages/api/src/routers/entitlement.ts
// Exposes the caller org's active entitlement module codes to the UI so
// clients can conditionally show/hide gated features (e.g. AI Voice Interview).
// Router -> Service only: never touches `db` directly.

import { router, protectedProcedure } from '../trpc';
import { getEntitlements } from '../services/entitlement.service';

export const entitlementRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const map = await getEntitlements(ctx.user.organizationId);
    return { modules: Array.from(map.keys()) };
  }),
});
