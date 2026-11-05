import { resolveDefaultOfferCurrency } from '../offer/offer-currency';
import { vacancyCurrencyRepository } from '../../repositories/vacancy-currency.repository';

// A vacancy salary sent without a currency (Pilot UX re-audit, company-admin data-62; proof-run F-4 suspect)
// gets the organization's currency, then its company's, then the legacy fallback: the same chain offers use.
// It used to be a blind `.default('COP')` in the Zod schema, which stored COP for a Costa Rican tenant.
// Pilot launch-spine fix under owner decision D-1; owed a C# port with the rest of the vacancy spine.

type SalaryInput = { min?: number; max?: number; currency?: string; period: 'monthly' | 'yearly' };
export type ResolvedSalary = Omit<SalaryInput, 'currency'> & { currency: string };

export async function withResolvedCurrency(
  organizationId: string,
  salary: SalaryInput | undefined,
  placement: { companyId?: string | null; vacancyId?: string },
): Promise<ResolvedSalary | undefined> {
  if (!salary) return undefined;
  const sent = salary.currency?.trim().toUpperCase();
  if (sent) return { ...salary, currency: sent };
  const { orgSettings, companyCurrency } = await vacancyCurrencyRepository.currencySources(
    organizationId,
    placement.companyId,
    placement.vacancyId,
  );
  return { ...salary, currency: resolveDefaultOfferCurrency(orgSettings, companyCurrency) };
}
