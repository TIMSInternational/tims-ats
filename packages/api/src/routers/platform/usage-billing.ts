import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '@tims/db';
import { router } from '../../trpc';
import { platformProcedure } from './_common';
import { organizationExists, findDraftInvoiceForPeriod } from '../../repositories/entitlement.repository';
import { computeUsageBilling, createUsageInvoice } from '../../services/usage-billing.service';

// Platform-owner usage-billing console (Slice 2b, Task 4): preview a period's
// billable usage and generate a draft invoice from it. Business logic
// (entitlement resolution, usage aggregation, invoice-line shaping,
// persistence) lives in usage-billing.service / entitlement.repository —
// this router only validates input, enforces the IDOR check (org must
// exist), guards against zero-billable / duplicate-draft mutations, and
// best-effort audit-logs the mutation. `db` is imported ONLY for the
// auditLog side-channel, mirroring `entitlements.ts` (Slice 2a).

function monthDefaults(periodStart?: Date, periodEnd?: Date): { start: Date; end: Date } {
  const end = periodEnd ?? new Date();
  const start = periodStart ?? new Date(end.getFullYear(), end.getMonth(), 1);
  return { start, end };
}

async function assertOrg(orgId: string): Promise<void> {
  if (!(await organizationExists(orgId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'organization_not_found' });
  }
}

export const usageBillingRouter = router({
  getUsageBillingPreview: platformProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      periodStart: z.date().optional(),
      periodEnd: z.date().optional(),
    }))
    .query(async ({ input }) => {
      await assertOrg(input.orgId);
      const { start, end } = monthDefaults(input.periodStart, input.periodEnd);
      return computeUsageBilling(input.orgId, start, end);
    }),

  generateUsageInvoice: platformProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      periodStart: z.date(),
      periodEnd: z.date(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertOrg(input.orgId);

      const preview = await computeUsageBilling(input.orgId, input.periodStart, input.periodEnd);
      if (preview.lines.every((l) => l.amountUsd <= 0)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'no_billable_usage' });
      }

      const existingDraft = await findDraftInvoiceForPeriod(input.orgId, input.periodStart, input.periodEnd);
      if (existingDraft) {
        throw new TRPCError({ code: 'CONFLICT', message: 'draft_invoice_exists' });
      }

      const result = await createUsageInvoice(input.orgId, input.periodStart, input.periodEnd, preview);

      await db.auditLog.create({
        data: {
          organizationId: input.orgId,
          actorId: ctx.user.id,
          action: 'entitlement_usage_invoiced',
          entity: 'invoice',
          entityId: result.invoiceId,
          metadata: {
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            subtotalUsd: preview.subtotalUsd,
          },
        },
      }).catch(() => {
        // Best-effort: audit-log failure must never block the mutation.
      });

      return result;
    }),
});
