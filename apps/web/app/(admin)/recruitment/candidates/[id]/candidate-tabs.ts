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

export function visibleCandidateTabs(pilot: boolean): readonly TabKey[] {
  return pilot ? TABS.filter((tab) => !ASSESSMENT_TABS.includes(tab)) : TABS;
}
