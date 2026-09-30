/**
 * Display helpers for the public careers portal (job cards + job detail).
 * Pure functions: the caller passes the active locale and the i18n labels.
 */

export type PortalLocale = 'ES' | 'EN';

export interface PortalSalary {
  min?: number;
  max?: number;
  currency?: string;
  period?: string;
}

export interface SalaryLabels {
  salaryFrom: string;
  salaryUpTo: string;
  perMonth: string;
  perYear: string;
}

const NUMBER_LOCALE: Record<PortalLocale, string> = { ES: 'es-CO', EN: 'en-US' };

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Narrows the vacancy `salary` JSON column into the shape the portal renders. */
export function parsePortalSalary(raw: unknown): PortalSalary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const min = positiveNumber(record.min);
  const max = positiveNumber(record.max);
  if (min === undefined && max === undefined) return null;
  const currency =
    typeof record.currency === 'string' && /^[A-Za-z]{3}$/.test(record.currency.trim())
      ? record.currency.trim().toUpperCase()
      : undefined;
  const period = typeof record.period === 'string' ? record.period : undefined;
  return { min, max, currency, period };
}

/** "/ mes" or "/ año" for the stored period; null when the period is missing or unknown. */
export function salaryPeriodLabel(period: string | undefined, labels: SalaryLabels): string | null {
  if (period === 'monthly') return labels.perMonth;
  if (period === 'yearly' || period === 'annual') return labels.perYear;
  return null;
}

/** Amount only, e.g. "COP 4.500.000 – 6.000.000" (es) or "COP 4,500,000 – 6,000,000" (en). */
export function formatSalaryAmount(salary: PortalSalary, locale: PortalLocale, labels: SalaryLabels): string {
  const nf = new Intl.NumberFormat(NUMBER_LOCALE[locale], { maximumFractionDigits: 0 });
  const prefix = salary.currency ? `${salary.currency} ` : '';
  if (salary.min !== undefined && salary.max !== undefined) {
    return `${prefix}${nf.format(salary.min)} – ${nf.format(salary.max)}`;
  }
  if (salary.min !== undefined) return `${labels.salaryFrom} ${prefix}${nf.format(salary.min)}`;
  return `${labels.salaryUpTo} ${prefix}${nf.format(salary.max ?? 0)}`;
}

/** Amount plus period, e.g. "COP 4.500.000 – 6.000.000 / mes". */
export function formatPortalSalary(salary: PortalSalary, locale: PortalLocale, labels: SalaryLabels): string {
  const period = salaryPeriodLabel(salary.period, labels);
  const amount = formatSalaryAmount(salary, locale, labels);
  return period ? `${amount} ${period}` : amount;
}

/** Maps a stored enum value to its label; free-form legacy values are shown as typed. */
export function enumLabel(value: string | null | undefined, labels: Record<string, string>): string | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : value;
}

export interface TimeAgoLabels {
  timeToday: string;
  timeYesterday: string;
  timeDaysAgo: string;
  timeWeeksAgo: string;
  timeMonthsAgo: string;
}

/** Relative posting date, e.g. "Hace 3 días". `{n}` in the label is replaced with the count. */
export function formatTimeAgo(date: Date | string, labels: TimeAgoLabels, now: number = Date.now()): string {
  const days = Math.max(0, Math.floor((now - new Date(date).getTime()) / 86_400_000));
  if (days === 0) return labels.timeToday;
  if (days === 1) return labels.timeYesterday;
  if (days < 7) return labels.timeDaysAgo.replace('{n}', String(days));
  if (days < 30) return labels.timeWeeksAgo.replace('{n}', String(Math.floor(days / 7)));
  return labels.timeMonthsAgo.replace('{n}', String(Math.floor(days / 30)));
}
