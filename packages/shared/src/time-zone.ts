// ---------------------------------------------------------------------------
// Interview time zones — one resolver and one label for every surface
// ---------------------------------------------------------------------------
// Interviews are local events: the recruiter types a wall-clock time, and every email, .ics and screen
// must show that same time with an explicit zone. The zone is the organization's
// (`organizations.settings.timezone`), then the vacancy company's, then UTC — never a hard-coded
// country default. Labels read "hora de Costa Rica (GMT-6)" / "Costa Rica time (GMT-6)", or "UTC".
// Pure (Intl only), so the API emails and the web schedule modal share it and node tests cover it.

export type TimeZoneLabelLocale = 'es' | 'en';

/** The explicit last-resort zone. Its label is the literal "UTC". */
export const UTC_TIME_ZONE = 'UTC';

/** Place names for the zones a label should name by country rather than by city. */
const ZONE_PLACES: Readonly<Record<string, { es: string; en: string }>> = {
  'America/Costa_Rica': { es: 'Costa Rica', en: 'Costa Rica' },
  'America/Panama': { es: 'Panamá', en: 'Panama' },
  'America/Guatemala': { es: 'Guatemala', en: 'Guatemala' },
  'America/El_Salvador': { es: 'El Salvador', en: 'El Salvador' },
  'America/Tegucigalpa': { es: 'Honduras', en: 'Honduras' },
  'America/Managua': { es: 'Nicaragua', en: 'Nicaragua' },
  'America/Mexico_City': { es: 'Ciudad de México', en: 'Mexico City' },
  'America/Bogota': { es: 'Colombia', en: 'Colombia' },
  'America/Lima': { es: 'Perú', en: 'Peru' },
  'America/Santo_Domingo': { es: 'República Dominicana', en: 'Dominican Republic' },
};

const UTC_ALIASES: ReadonlySet<string> = new Set(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT', 'Etc/Universal', 'Universal']);

/** True when `tz` is a bounded IANA zone this runtime can format with. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** `organizations.settings.timezone` when it is a valid zone, else null. */
export function orgSettingsTimeZone(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const tz = (settings as Record<string, unknown>).timezone;
  return isValidTimeZone(tz) ? tz : null;
}

/** The zone an interview is shown in: organization, then company, then UTC. */
export function resolveInterviewTimeZone(
  orgTimeZone: string | null | undefined,
  companyTimeZone?: string | null,
): string {
  if (isValidTimeZone(orgTimeZone)) return orgTimeZone;
  if (isValidTimeZone(companyTimeZone)) return companyTimeZone;
  return UTC_TIME_ZONE;
}

function isUtc(tz: string): boolean {
  return UTC_ALIASES.has(tz);
}

/** "GMT-6" for the zone at `at` (DST-aware). */
export function timeZoneOffsetLabel(tz: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  const value = part?.value ?? 'GMT';
  return value === 'GMT' ? 'GMT+0' : value;
}

/** "hora de Costa Rica (GMT-6)" / "Costa Rica time (GMT-6)"; "UTC" for UTC or an unusable zone. */
export function timeZoneLabel(tz: string, locale: TimeZoneLabelLocale, at: Date = new Date()): string {
  if (!isValidTimeZone(tz) || isUtc(tz)) return 'UTC';
  const known = ZONE_PLACES[tz];
  const place = known ? known[locale] : (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
  const offset = timeZoneOffsetLabel(tz, at);
  return locale === 'en' ? `${place} time (${offset})` : `hora de ${place} (${offset})`;
}

/** Offset of `tz` from UTC at instant `at`, in minutes (Costa Rica → -360). */
function offsetMinutes(tz: string, at: Date): number {
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
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant at which the wall clock in `tz` reads `date` ("YYYY-MM-DD") `time` ("HH:mm"). The
 * browser's own zone plays no part, so a recruiter on a laptop set to another zone still books the
 * hour the candidate's email will show. Null for malformed input and for a wall time that does not
 * exist in the zone (the hour skipped by a DST change): it is never silently moved.
 */
export function zonedWallTimeToDate(date: string, time: string, tz: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const zone = isValidTimeZone(tz) ? tz : UTC_TIME_ZONE;
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  // Two passes settle the offset across a DST change.
  let guess = wall - offsetMinutes(zone, new Date(wall)) * 60_000;
  guess = wall - offsetMinutes(zone, new Date(guess)) * 60_000;
  // Round trip: the result must read back as the same wall clock in the zone.
  if (guess + offsetMinutes(zone, new Date(guess)) * 60_000 !== wall) return null;
  return new Date(guess);
}

/** "YYYY-MM-DD" of the calendar day in `tz`, `days` after the day containing `now`. */
export function zonedDateString(tz: string, days = 0, now: Date = new Date()): string {
  const zone = isValidTimeZone(tz) ? tz : UTC_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const shifted = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days));
  return shifted.toISOString().slice(0, 10);
}
