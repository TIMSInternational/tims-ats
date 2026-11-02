// ---------------------------------------------------------------------------
// "Add to calendar" helpers for the candidate portal
// ---------------------------------------------------------------------------
// Pure and browser-safe. Dates are always emitted in UTC so the link is independent of the
// viewer's (or server's) local time zone.

import { formatIcsUtc } from './ics';

const GOOGLE_CALENDAR_RENDER_URL = 'https://calendar.google.com/calendar/render';

export type CalendarLinkEvent = {
  title: string;
  start: Date;
  end: Date;
  details?: string;
  location?: string;
};

/** Google Calendar "create event" template link with UTC `YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ` dates. */
export function googleCalendarUrl(event: CalendarLinkEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatIcsUtc(event.start)}/${formatIcsUtc(event.end)}`,
  });
  if (event.details) params.set('details', event.details);
  if (event.location) params.set('location', event.location);
  return `${GOOGLE_CALENDAR_RENDER_URL}?${params.toString()}`;
}

/**
 * The interview's iCalendar UID. It matches the UID of the emailed invite, so a calendar that
 * receives both the email and the portal download treats them as one event.
 */
export function interviewIcsUid(interviewId: string, host: string): string {
  return `interview-${interviewId}@${host}`;
}
