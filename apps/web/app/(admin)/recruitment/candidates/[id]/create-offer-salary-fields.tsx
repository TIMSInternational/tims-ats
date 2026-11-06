'use client';

import { useI18n } from '../../../../../lib/i18n';
import { annualToPeriod, formatMoneyCode, type SalaryPeriod } from '../../../../../lib/offer-salary';
import { currencyOptions } from '../../../../../lib/currency-options';
import { formatMoneyAmount } from '../../../../../lib/money-amount';
import { MoneyInput } from '../../../../../components/money-input';
import { offerSalaryState, type OfferSalaryInput } from './create-offer-form';

const INPUT = 'mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]';
const LABEL = 'block text-[12px] font-medium text-[#585858]';

// Salary amount, period and currency. One column on a phone, three from `sm` up (B-33).
export function CreateOfferSalaryFields({
  values,
  vacancySalary,
  onChange,
}: {
  values: OfferSalaryInput;
  vacancySalary: unknown;
  onChange: (patch: Partial<OfferSalaryInput>) => void;
}) {
  const { t } = useI18n();
  const { referenceCurrency, referenceAmount, placeholderAmount, maxInPeriod, annualSalary } = offerSalaryState(
    values,
    vacancySalary,
  );
  const currencies = currencyOptions();
  // Full ISO list (popular first); a legacy non-ISO vacancy currency stays selectable.
  const currencyList = currencies.some((c) => c.code === values.currency)
    ? currencies
    : [{ code: values.currency, label: values.currency }, ...currencies];

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* The shared money input: grouping accepted and shown, whole numbers for CRC/COP…, nothing steps
            the value (an arrow key once made CRC 1 000 000 / month 1 000 000.01, stored as 12 000 000.12). */}
        <div>
          <label htmlFor="offer-salary-amount" className={LABEL}>
            {t.offers.salaryAmount} *
          </label>
          <MoneyInput
            id="offer-salary-amount"
            value={values.salary}
            currency={values.currency}
            max={maxInPeriod}
            placeholder={placeholderAmount !== null ? formatMoneyAmount(placeholderAmount, values.currency) : undefined}
            onChange={(text) => onChange({ salary: text })}
            className={INPUT}
          />
        </div>
        <label className={LABEL}>
          {t.offers.salaryPeriod}
          <select
            value={values.period}
            onChange={(event) =>
              onChange({ period: (event.target.value === 'yearly' ? 'yearly' : 'monthly') as SalaryPeriod })
            }
            className={`${INPUT} bg-white`}
          >
            <option value="monthly">{t.offers.periodMonthly}</option>
            <option value="yearly">{t.offers.periodYearly}</option>
          </select>
        </label>
        <label className={LABEL}>
          {t.offers.currency}
          <select
            value={values.currency}
            onChange={(event) => onChange({ currency: event.target.value })}
            className={`${INPUT} bg-white`}
          >
            {currencyList.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {referenceAmount !== null && referenceCurrency !== null && (
        <p data-testid="offer-salary-reference" className="text-[11px] text-[#8B8B8B]">
          {t.offers.salaryPlaceholderHint.replace('{amount}', formatMoneyCode(referenceAmount, referenceCurrency))}
        </p>
      )}
      {annualSalary !== null && (
        <p data-testid="offer-salary-equivalents" className="text-[12px] font-medium text-[#1F114C]">
          {t.offers.salaryEquivalents
            .replace('{annual}', formatMoneyCode(annualSalary, values.currency))
            .replace('{monthly}', formatMoneyCode(annualToPeriod(annualSalary, 'monthly'), values.currency))}
        </p>
      )}
    </>
  );
}
