// The iCalendar builder lives in @tims/shared (packages/shared/src/calendar/ics.ts) so the candidate
// portal can build a .ics in the browser. This path re-exports it so existing importers are unchanged.
// The email path only ever sends iTIP REQUEST / CANCEL, so its IcsMethod stays that narrower type
// (PUBLISH is for the portal download, never for an email).
export {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsUtc,
  sequenceFromUpdatedAt,
  type IcsEvent,
  type IcsScheduleMethod as IcsMethod,
  type IcsParty,
} from '@tims/shared';
