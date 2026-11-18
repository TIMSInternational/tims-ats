'use client';

import { isFitEngineV2Enabled } from '../../../../../lib/platform-api/fit-engine';
import { VacancyAssessmentsPanel } from './vacancy-assessments-panel';

// FIT v2 / AS-14: the vacancy's assessments[] editor. Each test comes from the TIMS Assessments catalog this
// organization may assign, with how FIT uses it, its minimum and the job-relatedness reason (design §6.3). Reads and
// writes only through C# (assessments[] alone, conditional on the version read), so it is shown only with FIT v2 on.
export function VacancyAssessmentsCard({ vacancyId }: { vacancyId: string }) {
  // Dark: render nothing and run no query (the page may have no QueryClient for C# reads).
  if (!isFitEngineV2Enabled()) return null;
  return <VacancyAssessmentsPanel vacancyId={vacancyId} />;
}
