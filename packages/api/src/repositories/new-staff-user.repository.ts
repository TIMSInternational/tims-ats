import { tenantDb as db } from '@tims/db';
import { orgSettingsTimeZone, resolveInterviewTimeZone } from '@tims/shared';

// ---------------------------------------------------------------------------
// Defaults for a staff user row created by the app (hire hand-off, user.create)
// ---------------------------------------------------------------------------
// F-2b: `users.timezone` has a column default of America/Bogota, so every user the app created without
// an explicit zone was put on Colombian time. A new user takes the organization's zone
// (`organizations.settings.timezone`), then the company's, then UTC — the same chain interviews use
// (packages/shared/src/time-zone.ts), never a hard-coded country.

/** The zone a new user row is created with. */
export function newUserTimeZone(orgSettings: unknown, companyTimeZone: string | null | undefined): string {
  return resolveInterviewTimeZone(orgSettingsTimeZone(orgSettings), companyTimeZone);
}

export type NewStaffUserContext = {
  organizationName: string;
  organizationSettings: unknown;
  billingEmail: string | null;
  companyLanguage: string | null;
  timeZone: string;
};

// Org-filtered, explicit selects; nothing else is read.
export const newStaffUserRepository = {
  async findContext(orgId: string, companyId: string | null | undefined): Promise<NewStaffUserContext> {
    const [org, company] = await Promise.all([
      db.organization.findFirst({
        where: { id: orgId },
        select: { name: true, settings: true, billingEmail: true },
      }),
      companyId
        ? db.company.findFirst({
            where: { id: companyId, organizationId: orgId },
            select: { timezone: true, language: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      organizationName: org?.name ?? '',
      organizationSettings: org?.settings ?? null,
      billingEmail: org?.billingEmail ?? null,
      companyLanguage: company?.language ?? null,
      timeZone: newUserTimeZone(org?.settings ?? null, company?.timezone ?? null),
    };
  },
};
