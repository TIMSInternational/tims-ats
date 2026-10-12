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

const RELATIVE_LOCALE: Record<PortalLocale, string> = { ES: 'es', EN: 'en' };

export interface TimeAgoOptions {
  /** Capitalise the first letter when the phrase stands alone ("Hace 3 días"); leave it lower-case mid-sentence. */
  standalone?: boolean;
  now?: number;
}

/**
 * Relative posting date via Intl.RelativeTimeFormat, so plurals and casing are the locale's own:
 * "hace 1 semana" / "hace 3 semanas", "hoy", "ayer" (es); "1 week ago", "today", "yesterday" (en).
 * Mid-sentence by default ("Publicada hace 3 días"); pass `standalone` for a phrase on its own.
 */
export function formatTimeAgo(date: Date | string, locale: PortalLocale, options: TimeAgoOptions = {}): string {
  const now = options.now ?? Date.now();
  const days = Math.max(0, Math.floor((now - new Date(date).getTime()) / 86_400_000));
  const lang = RELATIVE_LOCALE[locale];
  let text: string;
  if (days <= 1) {
    // numeric:'auto' gives the idiomatic "hoy"/"ayer" (today/yesterday) instead of "hace 0 días".
    text = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
  } else {
    // numeric:'always' keeps a count ("hace 1 semana") rather than the calendar-relative "la semana pasada".
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'always' });
    if (days < 7) text = rtf.format(-days, 'day');
    else if (days < 30) text = rtf.format(-Math.floor(days / 7), 'week');
    else text = rtf.format(-Math.floor(days / 30), 'month');
  }
  return options.standalone ? text.charAt(0).toLocaleUpperCase(lang) + text.slice(1) : text;
}
