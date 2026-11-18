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

/**
 * SLA overdue is time in the CURRENT stage, not since the application, in precise hours (not floored days) so
 * sub-24h SLAs can trigger the same day. Only an active application can be overdue.
 */
export function isOverdueInStage(
  application: { status: string; enteredStageAt: Date | string },
  slaHours: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!isActionableApplication(application) || slaHours == null) return false;
  const hoursInStage = Math.max(0, (now - new Date(application.enteredStageAt).getTime()) / 3600000);
  return hoursInStage > slaHours;
}

/** How many of a stage's applications are past the stage's SLA. */
export function stageOverdueCount(stage: {
  slaHours: number | null;
  applications: ReadonlyArray<{ status: string; enteredStageAt: Date | string }>;
}): number {
  return stage.slaHours ? stage.applications.filter((app) => isOverdueInStage(app, stage.slaHours)).length : 0;
}
