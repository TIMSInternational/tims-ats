import { isZeroDecimalCurrency } from '@tims/shared';
import { resolveDefaultOfferCurrency } from '../offer/offer-currency';
import { vacancyCurrencyRepository } from '../../repositories/vacancy-currency.repository';

// A vacancy salary sent without a currency (Pilot UX re-audit, company-admin data-62; proof-run F-4 suspect)
// gets the organization's currency, then its company's, then the legacy fallback: the same chain offers use.
// It used to be a blind `.default('COP')` in the Zod schema, which stored COP for a Costa Rican tenant.
// Pilot launch-spine fix under owner decision D-1; owed a C# port with the rest of the vacancy spine.
// Once the currency is known, a zero-decimal one (CRC, COP…) stores whole amounts (pilot call audit 2026-11-05).

type SalaryInput = { min?: number; max?: number; currency?: string; period: 'monthly' | 'yearly' };
export type ResolvedSalary = Omit<SalaryInput, 'currency'> & { currency: string };

export async function withResolvedCurrency(
  organizationId: string,
  salary: SalaryInput | undefined,
  placement: { companyId?: string | null; vacancyId?: string },
): Promise<ResolvedSalary | undefined> {
  if (!salary) return undefined;
  const sent = salary.currency?.trim().toUpperCase();
  if (sent) return wholeIfZeroDecimal({ ...salary, currency: sent });
  const { orgSettings, companyCurrency } = await vacancyCurrencyRepository.currencySources(
    organizationId,
    placement.companyId,
    placement.vacancyId,
  );
  return wholeIfZeroDecimal({ ...salary, currency: resolveDefaultOfferCurrency(orgSettings, companyCurrency) });
}

/** Rounding both bounds the same way keeps min <= max (the schema already refused min > max). */
export function wholeIfZeroDecimal(salary: ResolvedSalary): ResolvedSalary {
  if (!isZeroDecimalCurrency(salary.currency)) return salary;
  return {
    ...salary,
    ...(salary.min !== undefined && { min: Math.round(salary.min) }),
    ...(salary.max !== undefined && { max: Math.round(salary.max) }),
  };
}
