export const TABS = [
  'tabProfile',
  'tabApplications',
  'tabAssessments',
  'tabInterviews',
  'tabFitGaps',
  'tabDocuments',
  'tabValidations',
  'tabTimeline',
  'tabNotes',
] as const;

export type TabKey = (typeof TABS)[number];

// The company's own quizzes are out of the pilot launch scope. Under it the Assessments tab (and the assign button)
// is offered only when the organization is bound to TIMS Assessments, whose tests the portal also shows; the caller
// passes `pilot` = "hide the tab".
const ASSESSMENT_TABS: readonly TabKey[] = ['tabAssessments'];

// "Validaciones" has nothing to show yet (RiskFlags renders nothing without data), so it is not offered as a
// tab that always opens empty (journeys-27). Its panel stays wired for when it gets content.
const EMPTY_TABS: readonly TabKey[] = ['tabValidations'];

export function visibleCandidateTabs(pilot: boolean): readonly TabKey[] {
  return TABS.filter((tab) => !EMPTY_TABS.includes(tab) && !(pilot && ASSESSMENT_TABS.includes(tab)));
}

/** A `?tab=` value the viewer may open, or null (unknown or hidden tabs fall back to the profile). */
export function readTabParam(value: string | null | undefined, pilot: boolean): TabKey | null {
  return value && (visibleCandidateTabs(pilot) as readonly string[]).includes(value) ? (value as TabKey) : null;
}

/** Replaces (or removes) query parameters in place: no history entry, no server round trip. */
export function replaceQuery(changes: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}
