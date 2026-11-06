/**
 * Money and date formatting for candidate-facing surfaces (careers board, vacancy page, candidate
 * portal, offer signing page). Pure functions: no React, no Next imports, so node tests cover them.
 *
 * - Spanish renders with es-CR conventions (the pilot tenant is in Costa Rica): "₡4 500 000".
 * - The colón is the only currency shown with its symbol; every other currency keeps its ISO code
 *   ("USD 4 500"), so a bare "$" never appears.
 * - Dates and times are rendered in the organization's time zone (organization, then the item's vacancy
 *   company — the chain the emails use) and carry the shared explicit zone label ("hora de Guatemala
 *   (GMT-6)"). Without a configured zone they fall back to UTC and say so — never to the viewer's device
 *   clock and never to a guessed zone.
 */

import { timeZoneLabel as sharedTimeZoneLabel } from '@tims/shared';
import { TENANT_LOCALE } from './tenant-locale';

export type CandidateLocale = 'ES' | 'EN';

export const CANDIDATE_INTL_LOCALE: Record<CandidateLocale, string> = { ES: TENANT_LOCALE, EN: 'en-US' };

const SYMBOL_CURRENCIES = new Set(['CRC']);
const ZERO_DECIMAL_CURRENCIES = new Set(['CRC', 'COP', 'CLP', 'JPY', 'KRW', 'PYG', 'VND']);

/** "₡850 000", "USD 4 500", or the digits next to a legacy non-ISO value as stored. */
export function formatCandidateMoney(
  amount: number,
  currency: string | null | undefined,
  locale: CandidateLocale,
): string {
  const intlLocale = CANDIDATE_INTL_LOCALE[locale];
  const raw = (currency ?? '').trim();
  const code = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    const digits = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 }).format(amount);
    return raw ? `${raw} ${digits}` : digits;
  }
  const fractionDigits = ZERO_DECIMAL_CURRENCIES.has(code) || Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency: code,
    currencyDisplay: SYMBOL_CURRENCIES.has(code) ? 'narrowSymbol' : 'code',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

/** Plain localized digits, for an amount stored without a currency. */
export function formatCandidateNumber(amount: number, locale: CandidateLocale): string {
  return new Intl.NumberFormat(CANDIDATE_INTL_LOCALE[locale], { maximumFractionDigits: 0 }).format(amount);
}

export interface OfferSalaryLabels {
  perMonth: string;
  perYear: string;
}

/**
 * Offer.salary is stored as an ANNUAL base salary. Candidates in Costa Rica read pay monthly, so the
 * monthly figure leads: "₡850 000 / mes (₡10 200 000 / año)".
 */
export function formatCandidateOfferSalary(
  annual: number,
  currency: string,
  labels: OfferSalaryLabels,
  locale: CandidateLocale,
): string {
  const monthly = annual / 12;
  return `${formatCandidateMoney(monthly, currency, locale)} / ${labels.perMonth} (${formatCandidateMoney(annual, currency, locale)} / ${labels.perYear})`;
}

/** The configured IANA zone when it is a usable one, else null. */
export function safeTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tz = value.trim();
  if (tz.length === 0 || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** `organizations.settings.timezone`, validated; null when unset or invalid. */
export function orgSettingsTimeZone(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  return safeTimeZone((settings as Record<string, unknown>).timezone);
}

/**
 * The zone one interview or offer is shown in: the organization's own (`settings.timezone`), then the zone of
 * THAT item's vacancy company — the chain its email resolves (resolveInterviewTimeZone over
 * interview.vacancy.company / offer.vacancy.company) — else null (UTC). Per item, never the primary company:
 * an organization's companies can sit in different zones, and a vacancy without a company gets UTC in its
 * email too.
 */
export function candidateTimeZone(
  orgTimeZone: string | null | undefined,
  vacancyCompanyTimeZone: string | null | undefined,
): string | null {
  return safeTimeZone(orgTimeZone) ?? safeTimeZone(vacancyCompanyTimeZone);
}

/**
 * The shared zone label (packages/shared time-zone.ts, the one the emails print): "hora de Costa Rica
 * (GMT-6)", "hora de Guatemala (GMT-6)", "Mexico City time (GMT-6)"; "UTC" when no zone is configured.
 */
export function timeZoneLabel(date: Date, timeZone: string | null, locale: CandidateLocale): string {
  return sharedTimeZoneLabel(timeZone ?? 'UTC', locale === 'EN' ? 'en' : 'es', date);
}

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "4 de noviembre de 2026" in the organization's zone (UTC when none is configured). */
export function formatCandidateDate(value: Date | string, locale: CandidateLocale, timeZone: string | null): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(CANDIDATE_INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timeZone ?? 'UTC',
  }).format(date);
}

/** "miércoles, 4 de noviembre de 2026, 10:00 a. m., hora de Costa Rica (GMT-6)" — no seconds. */
export function formatCandidateDateTime(value: Date | string, locale: CandidateLocale, timeZone: string | null): string {
  const date = toDate(value);
  if (!date) return '';
  const text = new Intl.DateTimeFormat(CANDIDATE_INTL_LOCALE[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone ?? 'UTC',
  }).format(date);
  return `${text}, ${timeZoneLabel(date, timeZone, locale)}`;
}
