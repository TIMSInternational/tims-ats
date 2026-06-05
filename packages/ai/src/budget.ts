import { db } from '@tims/db';
import { logger } from '@tims/shared';

// ---------------------------------------------------------------------------
// Budget checker — enforces per-org monthly AI spend limits.
//
// FAIL CLOSED against unbounded spend: a missing org config (or null budget)
// does NOT mean "unlimited" — it falls back to a conservative default cap. An
// explicit `enabled: false` denies outright. This prevents a single unmetered
// agent loop on Sonnet from running up an unbounded bill.
// ---------------------------------------------------------------------------

const envBudget = Number(process.env.AI_DEFAULT_MONTHLY_BUDGET_USD);
const DEFAULT_MONTHLY_BUDGET_USD =
  Number.isFinite(envBudget) && envBudget > 0 ? envBudget : 25;

const ALERT_THRESHOLD = 0.8;

export async function checkBudget(
  orgId: string,
  agentId: string,
): Promise<{ allowed: boolean; spent: number; budget: number }> {
  const config = await db.aiAgentOrgConfig.findUnique({
    where: { agentId_organizationId: { agentId, organizationId: orgId } },
    select: { enabled: true, monthlyBudget: true },
  });

  // Explicit disable → deny. Otherwise use the configured budget, else the
  // conservative default cap (never unlimited).
  if (config && !config.enabled) {
    return { allowed: false, spent: 0, budget: 0 };
  }
  const budget = config?.monthlyBudget ?? DEFAULT_MONTHLY_BUDGET_USD;

  // Calculate spend this month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const usage = await db.aiAgentUsageLog.aggregate({
    where: {
      agentId,
      organizationId: orgId,
      createdAt: { gte: monthStart },
    },
    _sum: { costUsd: true },
  });

  const spent = usage._sum.costUsd ?? 0;
  const allowed = spent < budget;

  // Surface spend before the hard block at 100% so it's actionable.
  if (allowed && spent >= budget * ALERT_THRESHOLD) {
    logger.warn(
      { orgId, agentId, spent, budget, pct: Math.round((spent / budget) * 100) },
      'AI budget threshold reached (>=80%)',
    );
  }

  return { allowed, spent, budget };
}
