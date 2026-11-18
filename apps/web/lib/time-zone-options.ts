// Time zone pickers (own profile, the platform owner's organization editor). Pure (no React) so node tests
// can exercise it.
//
// A curated list rather than all ~400 IANA zones: the closed pilot is in Costa Rica and the product's
// customers are in the Americas. The current value is always kept in the list, even when it is not one of
// these, so a picker never silently shows a different zone than the one stored. Labels come from the
// shared interview-time-zone label, capitalised as a list item starts ("Hora de Costa Rica (GMT-6)",
// writing.md › Best practices). The IANA id is an internal identifier: it is appended only when two
// options would otherwise read the same, and pickers show it as the option's tooltip.

import { isValidTimeZone, timeZoneLabel, type TimeZoneLabelLocale } from '@tims/shared';

export const COMMON_TIME_ZONES: readonly string[] = [
  'America/Costa_Rica',
  'America/Panama',
  'America/Guatemala',
  'America/El_Salvador',
  'America/Tegucigalpa',
  'America/Managua',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santo_Domingo',
  'America/Santiago',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/Madrid',
  'UTC',
];

export type TimeZoneOption = { value: string; label: string };

/** Picker options: the common zones plus `current` (when it is a valid zone not already listed). */
export function timeZoneOptions(
  locale: TimeZoneLabelLocale,
  current?: string | null,
  at: Date = new Date(),
): TimeZoneOption[] {
  const zones = [...COMMON_TIME_ZONES];
  if (current && isValidTimeZone(current) && !zones.includes(current)) zones.unshift(current);
  const labels = zones.map((value) => {
    const label = timeZoneLabel(value, locale, at);
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  });
  return zones.map((value, i) => {
    const label = labels[i] ?? value;
    const ambiguous = labels.filter((other) => other === label).length > 1;
    return { value, label: ambiguous && label !== value ? `${label} · ${value}` : label };
  });
}
