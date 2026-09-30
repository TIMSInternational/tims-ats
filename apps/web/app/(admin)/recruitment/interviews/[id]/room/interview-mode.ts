// An interview is held over the platform's video call (Daily) when:
// - its type is `video`, the one type for which the schedule wizard promises an
//   automatic Daily room (schedule-modal.fields.tsx, scheduleFieldVideoAutoRoom); or
// - it already HAS a Daily room: before #325 the room's join button called
//   interview.createVideoRoom for ANY type and stored the Daily URL in
//   `meetingUrl`, and the candidate portal shows that URL as a join link, so
//   such an interview keeps its video call whatever its type.
// The wizard's other types (phone, panel, onsite, technical, cultural) collect a
// phone number, an external meeting link or an office, so their room opens
// straight to scoring: no video room is created, no Daily call object is
// loaded, and nothing depends on DAILY_API_KEY.
//
// Unknown / legacy stored types without a Daily room are treated as NON-video on
// purpose: that path can always be scored, whereas the video path needs Daily to
// be configured and up. They only lose a Daily call nobody promised them.

/** Strict: an https URL on a subdomain of daily.co (`<team>.daily.co/<room>`). */
export function isDailyRoomUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname.endsWith('.daily.co') &&
    parsed.hostname.length > '.daily.co'.length &&
    parsed.pathname.length > 1
  );
}

export function isVideoInterview(interview: { type: string; meetingUrl?: string | null }): boolean {
  return interview.type === 'video' || isDailyRoomUrl(interview.meetingUrl);
}

// Mirrors the statuses the server treats as awaiting a scorecard
// (interview.getPendingScorecards in packages/api/src/routers/interview/scorecards.ts:
// scheduled, rescheduled, completed), plus in_progress, which is harmless here.
// Kept as a cross-referenced copy rather than a shared constant so this PR does
// not touch packages/api. Any other status (cancelled, no_show, unknown) closes
// the room: no link in the table, and a notice instead of the scorecard or a call.
export const ROOM_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'rescheduled', 'in_progress', 'completed']);
