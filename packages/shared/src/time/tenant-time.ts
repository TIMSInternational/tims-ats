// Tenant time primitives (WP-09). Pure Intl, no dependency: resolve the tenant's IANA
// zone, label it, and convert between tenant wall time and UTC.

export type TimeUi = 'es' | 'en';

/** Last-resort zone (decision D-C). Always shown with its label so it is never silent. */
export const FALLBACK_TIMEZONE = 'America/Bogota';

export type TenantTimeZoneSource = 'company' | 'orgSettings' | 'soleCompany' | 'fallback';

export interface TenantTimeZoneInput {
  companyTz?: string | null;
  orgSettingsTz?: string | null;
  soleCompanyTz?: string | null;
}

export interface ResolvedTenantTimeZone {
  timeZone: string;
  source: TenantTimeZoneSource;
}

export const TIMEZONE_LABELS: Readonly<Record<string, Readonly<Record<TimeUi, string>>>> = {
  'America/Costa_Rica': { es: 'hora de Costa Rica', en: 'Costa Rica time' },
  'America/Bogota': { es: 'hora de Colombia', en: 'Colombia time' },
  'America/Mexico_City': { es: 'hora de Ciudad de México', en: 'Mexico City time' },
  'America/Panama': { es: 'hora de Panamá', en: 'Panama time' },
  'America/New_York': { es: 'hora de Nueva York', en: 'New York time' },
  'Europe/Madrid': { es: 'hora de Madrid', en: 'Madrid time' },
  UTC: { es: 'hora UTC', en: 'UTC time' },
};

export function isIanaTimeZone(tz: string | null | undefined): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTenantTimeZone(input: TenantTimeZoneInput): ResolvedTenantTimeZone {
  const chain: Array<[string | null | undefined, TenantTimeZoneSource]> = [
    [input.companyTz, 'company'],
    [input.orgSettingsTz, 'orgSettings'],
    [input.soleCompanyTz, 'soleCompany'],
  ];
  for (const [tz, source] of chain) {
    if (isIanaTimeZone(tz)) return { timeZone: tz, source };
  }
  return { timeZone: FALLBACK_TIMEZONE, source: 'fallback' };
}

/** The Intl short GMT offset of a zone at an instant, e.g. "GMT-6" or "GMT+5:30". */
function shortOffset(tz: string, at: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? 'GMT';
}

/** "hora de Costa Rica (GMT-6)"; a zone with no label gives the bare Intl offset. */
export function zoneLabel(tz: string, ui: TimeUi, at: Date = new Date()): string {
  const offset = shortOffset(tz, at);
  const label = TIMEZONE_LABELS[tz]?.[ui];
  return label ? `${label} (${offset})` : offset;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallPartsInZone(at: Date, tz: string): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (positive east of UTC). */
function offsetMs(tz: string, ms: number): number {
  const p = wallPartsInZone(new Date(ms), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converts a wall-clock date and time in `tz` to the UTC instant. Two passes so an
 * offset change between the first guess and the answer (DST) is corrected.
 * Throws RangeError on malformed input or an unknown zone.
 */
export function zonedWallTimeToUtc(date: string, time: string, tz: string): Date {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t || !isIanaTimeZone(tz)) throw new RangeError('invalid wall time or time zone');
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
  const first = guess - offsetMs(tz, guess);
  const second = guess - offsetMs(tz, first);
  return new Date(second);
}

/** Today's date in `tz` as YYYY-MM-DD. */
export function todayInZone(tz: string, now: Date = new Date()): string {
  const p = wallPartsInZone(now, tz);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export type ZonedDateTimeStyle = 'date' | 'time' | 'datetime';

export interface FormatZonedDateTimeOptions {
  timeZone: string;
  ui: TimeUi;
  tenantLocale?: string | null;
  style?: ZonedDateTimeStyle;
}

/** Renders an instant in the tenant zone (never the server or browser zone). */
export function formatZonedDateTime(date: Date, opts: FormatZonedDateTimeOptions): string {
  if (Number.isNaN(date.getTime())) return '—';
  const locale = opts.ui === 'en' ? 'en-US' : opts.tenantLocale?.trim() || 'es-CR';
  const style = opts.style ?? 'datetime';
  const timeZone = isIanaTimeZone(opts.timeZone) ? opts.timeZone : FALLBACK_TIMEZONE;
  const out = new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(style !== 'time' ? { dateStyle: 'medium' as const } : {}),
    ...(style !== 'date' ? { timeStyle: 'short' as const } : {}),
  }).format(date);
  return out.replace(/[  ]/g, ' ');
}
