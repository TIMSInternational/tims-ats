import { db } from '@tims/db';

// ---------------------------------------------------------------------------
// Budget checker — enforces per-org monthly AI spend limits
// ---------------------------------------------------------------------------

export async function checkBudget(orgId: string, agentId: string): Promise<{ allowed: boolean; spent: number; budget: number | null }> {
  const config = await db.aiAgentOrgConfig.findUnique({
    where: { agentId_organizationId: { agentId, organizationId: orgId } },
    select: { enabled: true, monthlyBudget: true },
  });

  // No config = allowed (no budget limit)
  if (!config) return { allowed: true, spent: 0, budget: null };
  if (!config.enabled) return { allowed: false, spent: 0, budget: 0 };
  if (!config.monthlyBudget) return { allowed: true, spent: 0, budget: null };

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
  return {
    allowed: spent < config.monthlyBudget,
    spent,
    budget: config.monthlyBudget,
  };
}
