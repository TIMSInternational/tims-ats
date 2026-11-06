// Pure helpers for the offer form (create, "Editar borrador", "Crear nueva oferta"). No React.
//
// Contract type and modality are selects over the SAME vocabularies as the vacancy (i18n
// `portal.contractTypes` — Costa Rican terms — and `portal.remotePolicies`), prefilled from the vacancy
// (Pilot UX audit B-15). The offer stores the chosen LABEL, not the slug: the offer card, the letter, the
// signing page and the candidate portal print `offer.contractType` / `terms.modality` as they are, so a
// stored slug would surface raw ("termino_fijo"). A legacy free-text value stays selectable as itself.

import { CONTRACT_TYPES } from '../../vacancies/create-modal.helpers';
import {
  annualToPeriod,
  MAX_OFFER_ANNUAL_SALARY,
  parseVacancySalary,
  toAnnualSalary,
  vacancyMidpointIn,
  type SalaryPeriod,
} from '../../../../../lib/offer-salary';
import { isZeroDecimalCurrency } from '@tims/shared';
import { formatMoneyAmount, parseMoneyAmount } from '../../../../../lib/money-amount';
import { TENANT_LOCALE } from '../../../../../lib/tenant-locale';

export const REMOTE_POLICIES = ['onsite', 'remote', 'hybrid'] as const;
export const LEGACY_CHOICE = '__legacy__';
export const MAX_OFFER_BENEFITS = 10;
export const MAX_OFFER_TERM_LENGTH = 200;
export const MAX_CONTRACT_TYPE_LENGTH = 100;

export type OfferFormVacancy = {
  id: string;
  title: string;
  salary?: unknown;
  contractType?: string | null;
  remotePolicy?: string | null;
};
export type OfferFormApplication = { id: string; vacancy: OfferFormVacancy };

/** An existing offer the form starts from: the draft being edited, or the offer a new one is based on. */
export type OfferFormSource = {
  id: string;
  salary: number;
  currency: string;
  startDate: Date | string | null;
  contractType: string | null;
  terms?: unknown;
  benefits?: unknown;
};

export type Choice = { value: string; legacy: string | null };

export function contractTypeSlugs(): readonly string[] {
  return CONTRACT_TYPES;
}

/**
 * The select value for a stored label (or slug): the vocabulary slug it names, '' when empty, or
 * LEGACY_CHOICE carrying the stored text when it matches nothing (e.g. a free-text value typed before).
 */
export function choiceFor(
  stored: string | null | undefined,
  slugs: readonly string[],
  labels: Record<string, string>,
): Choice {
  const value = stored?.trim() ?? '';
  if (!value) return { value: '', legacy: null };
  if (slugs.includes(value)) return { value, legacy: null };
  const bySlug = slugs.find((slug) => labels[slug]?.trim().toLowerCase() === value.toLowerCase());
  return bySlug ? { value: bySlug, legacy: null } : { value: LEGACY_CHOICE, legacy: value };
}

/** The text stored for a choice: the vocabulary label, the legacy text, or '' for none. */
export function choiceText(choice: Choice, labels: Record<string, string>): string {
  if (choice.value === LEGACY_CHOICE) return choice.legacy ?? '';
  return choice.value ? (labels[choice.value] ?? choice.value) : '';
}

function stringRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function termString(terms: unknown, key: string): string {
  const value = stringRecord(terms)[key];
  return typeof value === 'string' ? value : '';
}

/**
 * The stored annual salary shown in an editable period, as the salary input shows amounts (grouped digits,
 * lib/money-amount.ts): monthly when the vacancy is paid monthly AND the monthly amount is exact (to the cent;
 * to the unit for a zero-decimal currency such as CRC), so saving untouched never shifts the annual figure;
 * else yearly. A zero-decimal amount that is not whole (an offer stored as 12 000 000.12 before the input
 * refused decimals) keeps its decimals here, so the input flags it instead of silently rounding it.
 */
export function editableSalary(
  annual: number,
  preferred: SalaryPeriod,
  currency: string,
): { amount: string; period: SalaryPeriod } {
  const whole = isZeroDecimalCurrency(currency);
  if (preferred === 'monthly') {
    const monthly = annualToPeriod(annual, 'monthly');
    const rounded = whole ? Math.round(monthly) : Math.round(monthly * 100) / 100;
    if (Math.abs(rounded * 12 - annual) < 1e-6) return { amount: formatMoneyAmount(rounded, currency), period: 'monthly' };
  }
  if (whole && !Number.isInteger(annual)) {
    const withDecimals = new Intl.NumberFormat(TENANT_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { amount: withDecimals.format(annual), period: 'yearly' };
  }
  return { amount: formatMoneyAmount(annual, currency), period: 'yearly' };
}

/** "YYYY-MM-DD" of a stored start date (the form sends local noon, so the local calendar day is the date). */
export function dateInputValue(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today in the browser, as a date-input value (the start date may not be earlier: B-33). */
export function todayInputValue(now: Date = new Date()): string {
  return dateInputValue(now);
}

/** One benefit per line, trimmed, at most MAX_OFFER_BENEFITS of MAX_OFFER_TERM_LENGTH chars. */
export function benefitsFromText(text: string): Record<string, string> | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim().slice(0, MAX_OFFER_TERM_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_OFFER_BENEFITS);
  if (lines.length === 0) return undefined;
  return Object.fromEntries(lines.map((line, index) => [String(index + 1), line]));
}

export function benefitsToText(benefits: unknown): string {
  return Object.values(stringRecord(benefits))
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join('\n');
}

/**
 * The terms JSON to store: the form's schedule / modality / bonus over any other keys the offer already
 * carries (reportingTo, location…, which the form does not edit). An emptied field removes its key.
 */
export function buildOfferTerms(
  existing: unknown,
  fields: { schedule: string; modality: string; bonus: string },
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(stringRecord(existing))) {
    if (typeof value === 'string') merged[key] = value;
  }
  for (const [key, raw] of Object.entries(fields)) {
    const value = raw.trim().slice(0, MAX_OFFER_TERM_LENGTH);
    if (value) merged[key] = value;
    else delete merged[key];
  }
  return merged;
}

export type OfferSalaryInput = { salary: string; period: SalaryPeriod; currency: string };

/**
 * What the salary fields show and validate. The vacancy midpoint is a reference in the VACANCY's own
 * currency: offered as the placeholder only when the offer currency matches, never converted. The amount is
 * parsed by lib/money-amount.ts (grouping accepted, whole numbers for CRC/COP…), never Number() of the text.
 */
export function offerSalaryState(values: OfferSalaryInput, vacancySalary: unknown) {
  const range = parseVacancySalary(vacancySalary);
  const referenceCurrency = range?.currency ?? null;
  const referenceAmount = referenceCurrency ? vacancyMidpointIn(range, values.period) : null;
  const placeholderAmount = referenceCurrency === values.currency ? referenceAmount : null;
  const maxInPeriod = annualToPeriod(MAX_OFFER_ANNUAL_SALARY, values.period);
  const parsed = parseMoneyAmount(values.salary, values.currency, { max: maxInPeriod });
  const amount = parsed.kind === 'ok' && parsed.value > 0 ? parsed.value : null;
  // To the cent: 1 234,56 / month is 14 814,72 a year, not 14814.720000000001.
  const annualSalary = amount !== null ? Math.round(toAnnualSalary(amount, values.period) * 100) / 100 : null;
  return { referenceCurrency, referenceAmount, placeholderAmount, maxInPeriod, annualSalary };
}
