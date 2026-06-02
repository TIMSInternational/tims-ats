// ---------------------------------------------------------------------------
// Calendar Service — generates .ics calendar event content
// Future: Google Calendar OAuth2, Outlook, cal.com integration
// ---------------------------------------------------------------------------

interface CalendarEvent {
  title: string;
  description: string;
  startTime: Date;
  durationMinutes: number;
  location?: string;
  meetingUrl?: string;
  organizerEmail: string;
  attendeeEmails: string[];
}

export const calendarService = {
  generateIcs(event: CalendarEvent): string {
    const start = formatIcsDate(event.startTime);
    const end = formatIcsDate(new Date(event.startTime.getTime() + event.durationMinutes * 60_000));
    const uid = `tims-${Date.now()}@tims.co`;

    const location = event.meetingUrl || event.location || '';
    const description = event.description + (event.meetingUrl ? `\\n\\nJoin: ${event.meetingUrl}` : '');

    const attendees = event.attendeeEmails
      .map((email) => `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${email}`)
      .join('\r\n');

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TIMS ATS//Interview//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      `LOCATION:${escapeIcs(location)}`,
      `ORGANIZER;CN=TIMS ATS:mailto:${event.organizerEmail}`,
      attendees,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  },
};

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeIcs(text: string): string {
  return text.replace(/[\\;,\n]/g, (c) => (c === '\n' ? '\\n' : `\\${c}`));
}
