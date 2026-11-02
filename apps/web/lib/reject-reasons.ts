// Structured rejection reasons for `pipeline.rejectCandidate`.
//
// The server accepts a free-text `reason` (1..500 chars) plus an optional free-text `feedback`
// (<= 2000 chars) and stores them verbatim on the application. To keep the stored reason
// machine-groupable without a server change, it is persisted as "<CODE>: <label>" — the code is a
// stable prefix for reporting, the label keeps the row human-readable. Edit this list to change the
// reasons offered in the UI; labels live in i18n under `rejectCandidateModal.reasons`.

export const REJECTION_REASON_CODES = [
  'NOT_QUALIFIED',
  'INSUFFICIENT_EXPERIENCE',
  'SALARY_MISMATCH',
  'CANDIDATE_WITHDREW',
  'OTHER_CANDIDATE_SELECTED',
  'NO_SHOW',
  'OTHER',
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

/** Server bound for `rejectCandidate.reason` (packages/api pipeline/movements.ts). */
export const REJECTION_REASON_MAX = 500;
/** Server bound for `rejectCandidate.feedback` (packages/api pipeline/movements.ts). */
export const REJECTION_NOTE_MAX = 2000;

/** Builds the persisted reason string, "<CODE>: <label>", clamped to the server's bound. */
export function buildRejectionReason(code: RejectionReasonCode, label: string): string {
  const text = `${code}: ${label.trim()}`.trim();
  return text.slice(0, REJECTION_REASON_MAX);
}

/** Maps the modal's form values onto the `rejectCandidate` mutation input. */
export function toRejectCandidateInput(
  applicationId: string,
  code: RejectionReasonCode,
  label: string,
  note: string,
): { applicationId: string; reason: string; feedback?: string } {
  const trimmed = note.trim();
  return {
    applicationId,
    reason: buildRejectionReason(code, label),
    ...(trimmed ? { feedback: trimmed.slice(0, REJECTION_NOTE_MAX) } : {}),
  };
}
