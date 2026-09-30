// Only `video` interviews are held over the platform's video call (Daily): it is
// the one type for which the schedule wizard promises an automatic Daily room
// (schedule-modal.fields.tsx, scheduleFieldVideoAutoRoom). The wizard's other
// types (phone, panel, onsite, technical, cultural) collect a phone number, an
// external meeting link or an office instead, so their room opens straight to
// scoring: no video room is created, no Daily call object is loaded, and
// nothing depends on DAILY_API_KEY.
//
// Unknown / legacy stored types are treated as NON-video on purpose: that path
// can always be scored, whereas the video path needs Daily to be configured and
// up. The only thing an unknown type loses is a Daily call nobody promised it.
export function isVideoInterviewType(type: string): boolean {
  return type === 'video';
}

// Mirrors the statuses the server treats as awaiting a scorecard
// (interview.getPendingScorecards in packages/api/src/routers/interview/scorecards.ts:
// scheduled, rescheduled, completed), plus in_progress, which is harmless here.
// Kept as a cross-referenced copy rather than a shared constant so this PR does
// not touch packages/api. `cancelled` and `no_show` are deliberately absent.
export const ROOM_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'rescheduled', 'in_progress', 'completed']);
