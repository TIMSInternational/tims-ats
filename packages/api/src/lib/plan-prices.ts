import type { OrgPlan } from '@tims/db';

export const PLAN_PRICES: Record<OrgPlan, number> = {
  trial: 0,
  starter: 499,
  professional: 999,
  enterprise: 2499,
};
