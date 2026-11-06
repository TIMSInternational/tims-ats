import { tenantDb } from '@tims/db';

// The inputs of a vacancy's default salary currency (Pilot UX re-audit, company-admin data-62): the
// organization's settings and the currency of the vacancy's company. The rule lives in
// routers/vacancy/vacancy-currency.ts, which reuses the offer chain (routers/offer/offer-currency.ts).

export type VacancyCurrencySources = { orgSettings: unknown; companyCurrency: string | null };

export const vacancyCurrencyRepository = {
  /**
   * `companyId` is the company the vacancy is (or will be) placed in. When it is undefined and `vacancyId`
   * is given, the vacancy's current company is used (an edit that does not move the vacancy).
   */
  async currencySources(
    organizationId: string,
    companyId: string | null | undefined,
    vacancyId?: string,
  ): Promise<VacancyCurrencySources> {
    const [organization, company] = await Promise.all([
      tenantDb.organization.findFirst({ where: { id: organizationId }, select: { settings: true } }),
      companyId
        ? tenantDb.company.findFirst({ where: { id: companyId, organizationId }, select: { currency: true } })
        : companyId === undefined && vacancyId
          ? tenantDb.vacancy
              .findFirst({
                where: { id: vacancyId, organizationId },
                select: { company: { select: { currency: true } } },
              })
              .then((row) => row?.company ?? null)
          : Promise.resolve(null),
    ]);
    return { orgSettings: organization?.settings ?? null, companyCurrency: company?.currency ?? null };
  },
};
