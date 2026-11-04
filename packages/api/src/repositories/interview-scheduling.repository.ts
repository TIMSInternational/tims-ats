import { tenantDb as db } from '@tims/db';

// The zone sources an interview's time is booked and shown in — organization settings, then the
// vacancy's company — exactly the chain the invitation emails use. Org-filtered, explicit selects;
// nothing else is read.
export const interviewSchedulingRepository = {
  async findTimeZoneSources(
    orgId: string,
    vacancyId: string | undefined,
  ): Promise<{ orgSettings: unknown; companyTimeZone: string | null }> {
    const [org, vacancy] = await Promise.all([
      db.organization.findFirst({ where: { id: orgId }, select: { settings: true } }),
      vacancyId
        ? db.vacancy.findFirst({
            where: { id: vacancyId, organizationId: orgId, deletedAt: null },
            select: { company: { select: { timezone: true } } },
          })
        : Promise.resolve(null),
    ]);
    return { orgSettings: org?.settings ?? null, companyTimeZone: vacancy?.company?.timezone ?? null };
  },
};
