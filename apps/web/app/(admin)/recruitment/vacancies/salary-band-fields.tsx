'use client';

import { useI18n } from '../../../../lib/i18n';
import { MoneyInput } from '../../../../components/money-input';
import { currencyOptions } from '../../../../lib/currency-options';
import type { SalaryBandStatus } from '../../../../lib/money-amount';
import { inputCls, labelCls } from './create-modal.helpers';

export type SalaryBandPeriod = 'monthly' | 'yearly';
export type SalaryBandPatch = Partial<{
  salaryMin: string;
  salaryMax: string;
  currency: string;
  salaryPeriod: SalaryBandPeriod;
}>;

interface SalaryBandFieldsProps {
  idPrefix: string;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  salaryPeriod: SalaryBandPeriod;
  onChange: (patch: SalaryBandPatch) => void;
  /** salaryBandStatus(salaryMin, salaryMax, currency) — computed by the form, which also gates saving on it. */
  status: SalaryBandStatus;
  /** The person confirmed this exact (wide) band. */
  wideConfirmed: boolean;
  onConfirmWide: (confirmed: boolean) => void;
  gridClassName: string;
}

/**
 * The vacancy salary band — the creation wizard and the "Editar" drawer use the same fields: amounts through
 * MoneyInput (grouping accepted and shown, whole numbers for CRC/COP…), an error when the minimum is above the
 * maximum and a warning to confirm when the minimum is below a tenth of the maximum.
 */
export function SalaryBandFields({
  idPrefix,
  salaryMin,
  salaryMax,
  currency,
  salaryPeriod,
  onChange,
  status,
  wideConfirmed,
  onConfirmWide,
  gridClassName,
}: SalaryBandFieldsProps) {
  const { t } = useI18n();
  const currencies = currencyOptions();
  return (
    <div>
      <div className={gridClassName}>
        <div>
          <label htmlFor={`${idPrefix}-salary-min`} className={labelCls}>
            {t.vacancies.salaryMin}
          </label>
          <MoneyInput
            id={`${idPrefix}-salary-min`}
            value={salaryMin}
            currency={currency}
            placeholder={t.vacancies.salaryMinPlaceholder}
            className={inputCls}
            onChange={(text) => onChange({ salaryMin: text })}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-salary-max`} className={labelCls}>
            {t.vacancies.salaryMax}
          </label>
          <MoneyInput
            id={`${idPrefix}-salary-max`}
            value={salaryMax}
            currency={currency}
            placeholder={t.vacancies.salaryMaxPlaceholder}
            className={inputCls}
            onChange={(text) => onChange({ salaryMax: text })}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-currency`} className={labelCls}>
            {t.vacancies.currency}
          </label>
          <select
            id={`${idPrefix}-currency`}
            value={currency}
            className={`${inputCls} bg-white`}
            onChange={(e) => onChange({ currency: e.target.value })}
          >
            {/* A legacy currency outside today's list stays selectable, so an unrelated edit never drops it. */}
            {!currencies.some((c) => c.code === currency) && <option value={currency}>{currency}</option>}
            {currencies.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-period`} className={labelCls}>
            {t.vacancies.period}
          </label>
          <select
            id={`${idPrefix}-period`}
            value={salaryPeriod}
            className={`${inputCls} bg-white`}
            onChange={(e) => onChange({ salaryPeriod: e.target.value === 'yearly' ? 'yearly' : 'monthly' })}
          >
            <option value="monthly">{t.vacancies.monthly}</option>
            <option value="yearly">{t.vacancies.yearly}</option>
          </select>
        </div>
      </div>
      {status.range.error === 'minAboveMax' && (
        <p role="alert" className="mt-2 text-[11px] text-[#991b1b]">
          {t.vacancies.editSalaryRange}
        </p>
      )}
      {status.range.wide && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-[#92400e]">
          <p>{t.money.wideRange}</p>
          <label className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              checked={wideConfirmed}
              onChange={(e) => onConfirmWide(e.target.checked)}
              className="h-4 w-4 rounded border-[#EDEDED]"
            />
            <span>{t.money.confirmWideRange}</span>
          </label>
        </div>
      )}
    </div>
  );
}
