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

// Assessments are out of the pilot launch scope: under it the tab, the results block, the assign button and
// its modal are not rendered, so recruiters cannot create assignments candidates have no way to find.
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
