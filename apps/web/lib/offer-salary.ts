/**
 * Offer salary semantics — single source of truth for the web app.
 *
 * `Offer.salary` is stored as an ANNUAL base salary (the letter, KPIs and the
 * approval chain all read it that way). Vacancies, however, store a range per
 * `salary.period` ('monthly' | 'yearly'). The create form therefore captures
 * amount + period and converts explicitly with `toAnnualSalary`, and every
 * display shows the currency CODE, a localized amount and the period.
 */

export type SalaryPeriod = 'monthly' | 'yearly';

export const MONTHS_PER_YEAR = 12;

const ZERO_DECIMAL = new Set(['COP', 'CLP', 'JPY', 'KRW', 'PYG', 'VND']);

export interface VacancySalaryRange {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod;
}

export function toAnnualSalary(amount: number, period: SalaryPeriod): number {
  return period === 'monthly' ? amount * MONTHS_PER_YEAR : amount;
}

export function annualToPeriod(annual: number, period: SalaryPeriod): number {
  return period === 'monthly' ? annual / MONTHS_PER_YEAR : annual;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Narrows the untyped `Vacancy.salary` JSON. Unknown/missing period defaults to monthly (the vacancy form default). */
export function parseVacancySalary(raw: unknown): VacancySalaryRange | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const min = finitePositive(record.min);
  const max = finitePositive(record.max);
  const currency =
    typeof record.currency === 'string' && /^[A-Za-z]{3}$/.test(record.currency) ? record.currency.toUpperCase() : null;
  const period: SalaryPeriod = record.period === 'yearly' ? 'yearly' : 'monthly';
  if (min === null && max === null) return currency ? { min, max, currency, period } : null;
  return { min, max, currency, period };
}

/** Midpoint of the vacancy range, expressed in `period`. Placeholder only — never a submitted value. */
export function vacancyMidpointIn(range: VacancySalaryRange | null, period: SalaryPeriod): number | null {
  if (!range) return null;
  const values = [range.min, range.max].filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const midpoint = values.reduce((sum, v) => sum + v, 0) / values.length;
  const annual = toAnnualSalary(midpoint, range.period);
  return Math.round(annualToPeriod(annual, period));
}

/** "COP 96.000.000" — ISO code + localized digits; never a bare "$". */
export function formatMoneyCode(amount: number, currency: string, locale = 'es-CO'): string {
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'USD';
  const digits = ZERO_DECIMAL.has(code) || Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    currencyDisplay: 'code',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(amount)
    .replace(/ /g, ' ');
}

export interface PeriodLabels {
  perYear: string;
  perMonth: string;
}

/** Annual stored salary rendered as "COP 96.000.000 / año (COP 8.000.000 / mes)". */
export function formatAnnualOfferSalary(
  annual: number,
  currency: string,
  labels: PeriodLabels,
  locale = 'es-CO',
): string {
  const monthly = annualToPeriod(annual, 'monthly');
  return `${formatMoneyCode(annual, currency, locale)} / ${labels.perYear} (${formatMoneyCode(monthly, currency, locale)} / ${labels.perMonth})`;
}
