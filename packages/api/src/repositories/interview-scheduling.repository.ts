import { tenantDb as db } from '@tims/db';
import { orgSettingsTimeZone, resolveInterviewTimeZone, UTC_TIME_ZONE } from '@tims/shared';

export type SchedulingTimeZone = { timeZone: string; source: 'organization' | 'company' | 'utc' };

// The zone an interview's time is booked and shown in — organization settings, then the vacancy's
// company, then UTC said explicitly — exactly the chain the invitation emails use. Org-filtered,
// explicit selects; nothing else is read.
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

  /** The zone the schedule modal books in and labels ("hora de Costa Rica (GMT-6)") and where it came from (A-17). */
  async findSchedulingTimeZone(orgId: string, vacancyId: string | undefined): Promise<SchedulingTimeZone> {
    const sources = await interviewSchedulingRepository.findTimeZoneSources(orgId, vacancyId);
    const orgZone = orgSettingsTimeZone(sources.orgSettings);
    const timeZone = resolveInterviewTimeZone(orgZone, sources.companyTimeZone);
    return { timeZone, source: orgZone ? 'organization' : timeZone === UTC_TIME_ZONE ? 'utc' : 'company' };
  },
};
