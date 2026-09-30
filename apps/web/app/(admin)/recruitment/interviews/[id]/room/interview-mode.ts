// Interview types that are never held over the platform's video call (Daily).
// Their room opens straight to scoring: no video room is created, no Daily
// call object is loaded, and nothing depends on DAILY_API_KEY. Every other
// type (video, panel, technical, cultural, or an unknown stored value) keeps
// the video lobby, which still offers scoring without joining.
const NON_VIDEO_TYPES: ReadonlySet<string> = new Set(['onsite', 'phone']);

/** True when the interview is held over the platform's video call. */
export function isVideoInterviewType(type: string): boolean {
  return !NON_VIDEO_TYPES.has(type);
}
