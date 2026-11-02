/**
 * WP-02: Costa Rica locale builders shared by vitest and the e2e specs.
 *
 * Money and time assertions build their expected strings here instead of hard-coding them,
 * so every suite agrees on how es-CR renders colones and America/Costa_Rica wall time.
 * cr-locale.test.ts pins the exact output, so a Node/ICU change is a deliberate re-pin.
 */
import { CR } from '../../e2e/fixtures/cr-tenant';

export { CR };

const LOCALE = 'es-CR';
const CR_TIME_ZONE = CR.company.timezone;
const BOGOTA_TIME_ZONE = 'America/Bogota';

/** An ISO-8601 instant with an explicit zone (Z or +-hh:mm). Zone-less strings are machine-local. */
const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseZonedInstant(iso: string): Date {
  if (!ZONED_ISO.test(iso)) {
    throw new Error(`cr-locale: expected an ISO timestamp with Z or an offset, got "${iso}"`);
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`cr-locale: unparseable timestamp "${iso}"`);
  }
  // Date rolls an overflow day (2026-02-30) into the next month instead of failing, so check
  // the calendar date as written, before the offset is applied.
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`cr-locale: impossible calendar date in "${iso}"`);
  }
  return date;
}

const DATE_PARTS = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const TIME_PARTS = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;

function renderDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, ...DATE_PARTS, ...TIME_PARTS }).format(parseZonedInstant(iso));
}

/** Colones as es-CR renders them, e.g. crMoney(1_050_000) -> "₡1 050 000,00" (NBSP separators). */
export function crMoney(amount: number, options: { decimals?: number } = {}): string {
  if (!Number.isFinite(amount)) {
    throw new Error(`cr-locale: crMoney needs a finite amount, got ${amount}`);
  }
  const decimals = options.decimals ?? 2;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CR.company.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/** Date and 24h time in Costa Rica wall time, e.g. "16 nov 2026, 08:30". */
export function crDateTime(isoUtc: string): string {
  return renderDateTime(isoUtc, CR_TIME_ZONE);
}

/** The Costa Rica calendar day, e.g. "16 nov 2026". */
export function crDate(isoUtc: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: CR_TIME_ZONE, ...DATE_PARTS }).format(parseZonedInstant(isoUtc));
}

/** The WRONG rendering (Bogota, UTC-5), for negative assertions against the Colombian default. */
export function bogotaRendering(isoUtc: string): string {
  return renderDateTime(isoUtc, BOGOTA_TIME_ZONE);
}

export interface CrSalaryTermsMonthly {
  gross: number;
  currency: 'CRC';
  period: 'monthly';
  display: string;
}

/** Placeholder monthly CRC salary-terms shape (adopted by WP-25). */
export function crSalaryTermsMonthly(gross: number): CrSalaryTermsMonthly {
  if (!Number.isFinite(gross) || gross < 0) {
    throw new Error(`cr-locale: gross salary must be a finite non-negative number, got ${gross}`);
  }
  return { gross, currency: 'CRC', period: 'monthly', display: crMoney(gross) };
}
