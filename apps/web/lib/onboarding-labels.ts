// Human labels for the raw onboarding enum strings stored in the DB
// (plan phase/status, task owner, check-in type/status). The DB stores slugs like
// "day1_30", "day1", "pending"; users must never see those. Values not in a map
// are returned unchanged: `responsible` is free text when HR adds a task by hand
// (e.g. "Equipo de TI"), and that text is already human-readable.

export type OnboardingLabelMessages = {
  readonly phases: Readonly<Record<string, string>>;
  readonly owners: Readonly<Record<string, string>>;
  readonly checkInTypes: Readonly<Record<string, string>>;
  readonly statuses: Readonly<Record<string, string>>;
};

function lookup(map: Readonly<Record<string, string>>, value: string): string {
  return Object.prototype.hasOwnProperty.call(map, value) ? (map[value] ?? value) : value;
}

export function onboardingPhaseLabel(messages: OnboardingLabelMessages, phase: string): string {
  return lookup(messages.phases, phase);
}

export function onboardingOwnerLabel(messages: OnboardingLabelMessages, responsible: string): string {
  return lookup(messages.owners, responsible);
}

export function onboardingCheckInTypeLabel(messages: OnboardingLabelMessages, type: string): string {
  return lookup(messages.checkInTypes, type);
}

export function onboardingStatusLabel(messages: OnboardingLabelMessages, status: string): string {
  return lookup(messages.statuses, status);
}

/** The task owner slug the new hire themself is responsible for (see onboarding-defaults.ts). */
export const NEW_HIRE_TASK_OWNER = 'employee';
