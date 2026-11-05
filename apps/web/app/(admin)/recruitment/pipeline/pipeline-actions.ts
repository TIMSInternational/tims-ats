/** What a card, list row or table row hands the board to open the prefilled schedule form (A-10). */
export interface ScheduleRequest {
  applicationId: string;
  candidateId: string;
  candidateName: string;
}

/** Board actions apply to active applications only: a rejected or hired one is read-only on the board. */
export function isActionableApplication(application: { status: string }): boolean {
  return application.status === 'active';
}
