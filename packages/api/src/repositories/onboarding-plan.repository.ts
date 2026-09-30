import { runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { defaultOnboardingTasks, scheduledOnboardingCheckIns } from '../services/onboarding-defaults';

// One ACTIVE onboarding plan per (organization, hire).
//
// The check used to be check-then-act on tenantDb (findFirst, then create as a
// separate statement), so two concurrent submits both saw "no active plan" and
// both created one — each with a full default checklist. Both writers here now
// take a transaction-scoped advisory lock keyed on (org, hire) BEFORE the check,
// so the second writer blocks until the first commits and then sees its row.
//
// Why a lock and not a partial unique index (onboarding_plans(organization_id,
// user_id) WHERE status = 'active'): this repo builds dev/CI databases with
// `prisma db push`, and Prisma 6.8 (no partialIndexes preview enabled) cannot
// express a partial index — push would treat it as drift. The index would also be
// a production DDL change on a table with unknown existing duplicates, which no
// one in this change can check. The lock needs no DDL.
//
// Scope of the guarantee — it holds between writers that take the lock, which is
// every path that can produce an active plan for an EXISTING hire:
//   - onboarding.create                       → createWithDefaultsIfNoActive
//   - onboarding.updatePlan { status:'active' } → reactivateIfNoOtherActive
// The hire handoff (offer/lifecycle.ts convertToEmployee) creates the plan for a
// user it creates in the same transaction, so no other writer can know that user
// id yet; it does not need the lock.

function lockKey(organizationId: string, userId: string): string {
  return `onboarding_plan_active:${organizationId.toLowerCase()}:${userId.toLowerCase()}`;
}

async function lockHire(tx: Prisma.TransactionClient, organizationId: string, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(organizationId, userId)}, 0))`;
}

export interface CreateOnboardingPlanInput {
  organizationId: string;
  createdById: string;
  userId: string;
  buddyId?: string;
  startDate: Date;
  phase: string;
}

export const onboardingPlanRepository = {
  /** Creates the plan + default checklist + scheduled check-ins atomically; null if the hire already has an active plan. */
  createWithDefaultsIfNoActive(input: CreateOnboardingPlanInput) {
    return runTenantTransaction(input.organizationId, async (tx) => {
      await lockHire(tx, input.organizationId, input.userId);
      const active = await tx.onboardingPlan.findFirst({
        where: { organizationId: input.organizationId, userId: input.userId, status: 'active' },
        select: { id: true },
      });
      if (active) return null;

      return tx.onboardingPlan.create({
        data: {
          organizationId: input.organizationId,
          createdById: input.createdById,
          userId: input.userId,
          buddyId: input.buddyId,
          startDate: input.startDate,
          phase: input.phase,
          checkIns: { create: scheduledOnboardingCheckIns(input.startDate, input.organizationId) },
          // Default checklist (F12): a new plan never starts empty.
          tasks: { create: defaultOnboardingTasks(input.startDate, input.organizationId) },
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          buddy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
  },

  /**
   * Applies an update that sets status 'active', refusing (null) when the same hire
   * already has a DIFFERENT active plan. The plan itself is read inside the lock.
   */
  reactivateIfNoOtherActive(organizationId: string, planId: string, data: Prisma.OnboardingPlanUpdateInput) {
    return runTenantTransaction(organizationId, async (tx) => {
      const plan = await tx.onboardingPlan.findFirst({
        where: { id: planId, organizationId },
        select: { userId: true },
      });
      if (!plan) return { outcome: 'not_found' as const };
      await lockHire(tx, organizationId, plan.userId);
      const other = await tx.onboardingPlan.findFirst({
        where: { organizationId, userId: plan.userId, status: 'active', id: { not: planId } },
        select: { id: true },
      });
      if (other) return { outcome: 'conflict' as const };
      const updated = await tx.onboardingPlan.update({ where: { id: planId }, data });
      return { outcome: 'updated' as const, plan: updated };
    });
  },
};
