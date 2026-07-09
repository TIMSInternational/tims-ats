import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '@tims/db';
import { router } from '../../trpc';
import { platformProcedure } from './_common';
import { organizationExists } from '../../repositories/entitlement.repository';
import {
  getOrgEntitlementsAdmin,
  setOrgEntitlement,
  assignPlan,
  listPlansForAdmin,
  listModulesForAdmin,
} from '../../services/entitlement.service';

// Platform-owner admin console for per-org entitlements (Slice 2a). Business
// logic (source resolution, cache invalidation, plan application) lives in
// the Task-2 service — this router only validates input, enforces the IDOR
// check (org must exist), and best-effort audit-logs mutations. `db` is
// imported ONLY for the auditLog side-channel, mirroring the precedent set
// by `updateFeatureFlag` in `platform/system.ts`.

async function assertOrg(orgId: string): Promise<void> {
  if (!(await organizationExists(orgId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'organization_not_found' });
  }
}

export const entitlementsAdminRouter = router({
  getOrgEntitlements: platformProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ input }) => getOrgEntitlementsAdmin(input.orgId)),

  listPlans: platformProcedure.query(() => listPlansForAdmin()),

  listModules: platformProcedure.query(() => listModulesForAdmin()),

  setOrgEntitlement: platformProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      moduleCode: z.string().max(64),
      enabled: z.boolean().optional(),
      // Int32 upper bound: Postgres `Int` columns overflow above 2147483647,
      // turning an out-of-range value into a Prisma write failure instead of
      // a clean validation error at the API boundary.
      limit: z.number().int().min(0).max(2147483647).nullable().optional(),
      // `.finite()` rejects Infinity/-Infinity — z.number() alone accepts
      // them, and this app's superjson transformer serializes non-finite
      // numbers over tRPC, so Infinity could otherwise reach Prisma and
      // poison pricing. 1,000,000 is a sane per-unit price ceiling.
      unitPrice: z.number().finite().min(0).max(1000000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertOrg(input.orgId);
      const { orgId, moduleCode, ...patch } = input;
      await setOrgEntitlement(orgId, moduleCode, patch);

      await db.auditLog.create({
        data: {
          organizationId: orgId,
          actorId: ctx.user.id,
          action: 'entitlement_set',
          entity: 'org_entitlement',
          entityId: orgId,
          metadata: { moduleCode, ...patch },
        },
      }).catch(() => {
        // Best-effort: audit-log failure must never block the mutation.
      });

      return { ok: true };
    }),

  assignPlan: platformProcedure
    .input(z.object({ orgId: z.string().uuid(), planCode: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertOrg(input.orgId);
      const res = await assignPlan(input.orgId, input.planCode);

      await db.auditLog.create({
        data: {
          organizationId: input.orgId,
          actorId: ctx.user.id,
          action: 'entitlement_plan_assigned',
          entity: 'org_entitlement',
          entityId: input.orgId,
          metadata: { planCode: input.planCode, applied: res.applied },
        },
      }).catch(() => {
        // Best-effort: audit-log failure must never block the mutation.
      });

      return res;
    }),
});
