import { tenantDb as db } from '@tims/db';

// The organization settings the interview list reads its scheduling zone from (settings.timezone).
// Org-filtered, explicit select; nothing else is read.
export const interviewSchedulingRepository = {
  async findOrgSettings(orgId: string): Promise<unknown> {
    const org = await db.organization.findFirst({ where: { id: orgId }, select: { settings: true } });
    return org?.settings ?? null;
  },
};
