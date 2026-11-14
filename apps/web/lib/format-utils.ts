import { normalizeCurrencyCode } from '@tims/shared';
import { TENANT_LOCALE } from './tenant-locale';

// Shown without minor units. CRC included: colones are quoted without céntimos (as on the candidate pages).
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'COP',
  'CRC',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/** Tenant-locale money: "₡1 000 000" for colones, "USD 1 234,50" for dollars (never "$1,234.50"). */
export function formatCurrency(value: number, currency = 'USD', decimals?: number): string {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const fractionDigits = decimals ?? (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency) ? 0 : 2);
  return new Intl.NumberFormat(TENANT_LOCALE, {
    style: 'currency',
    currency: normalizedCurrency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// -700 shades (gray-600): white initials reach at least 5:1 on every one (color.md › Inclusive color).
const AVATAR_COLORS = [
  'bg-brand',
  'bg-blue-700',
  'bg-violet-700',
  'bg-amber-700',
  'bg-rose-700',
  'bg-teal-700',
  'bg-cyan-700',
  'bg-emerald-700',
  'bg-indigo-700',
  'bg-orange-700',
  'bg-pink-700',
  'bg-gray-600',
];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function formatDateLong(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatRelativeTime(date: string | Date | null | undefined, neverLabel = 'Nunca'): string {
  if (!date) return neverLabel;
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} días`;
  return formatDate(date);
}

/** UI locale ('ES' | 'EN', from useI18n) → a BCP 47 tag for Intl. */
export function intlLocale(locale: 'ES' | 'EN'): string {
  return locale === 'ES' ? 'es' : 'en';
}

/** Locale-aware relative time ("hace 5 minutos" / "5 minutes ago"), falling back to the date after 30 days. */
export function formatRelativeTimeLocale(
  date: string | Date | null | undefined,
  locale: 'ES' | 'EN',
  neverLabel = '\u2014',
): string {
  if (!date) return neverLabel;
  const tag = intlLocale(locale);
  const diffSeconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return rtf.format(0, 'minute');
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSeconds / 86400), 'day');
  return new Intl.DateTimeFormat(tag, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

/** Locale-aware number: decimal comma in Spanish ("1.234,5"), point in English. */
export function formatNumber(value: number, locale: 'ES' | 'EN', options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/** Locale-aware percent from a 0–100 value: formatPercent(72.5, 'ES') → "72,5 %". */
export function formatPercent(value: number, locale: 'ES' | 'EN', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'percent', maximumFractionDigits }).format(value / 100);
}

/** Locale-aware date and time ("14 nov 2026, 15:30"), in the viewer's time zone unless one is given. */
export function formatDateTime(date: string | Date | null | undefined, locale: 'ES' | 'EN', timeZone?: string): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(date),
  );
}

export function daysUntil(date: string | Date): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
