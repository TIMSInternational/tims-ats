'use client';

import { isFitEngineV2Enabled } from '../../../../../lib/platform-api/fit-engine';
import { isProviderAssessmentsStaffEnabled } from '../../../../../lib/platform-api/assessment-providers-staff';
import { ProviderAssessmentsPanel } from './provider-assessments-panel';

export interface ProviderCardApplication {
  status: string;
  vacancy: { id: string; title: string };
}

// AS-7 / AS-14 on the candidate page: the candidate's TIMS Assessments per vacancy (status chip and result per test, as
// the C# read returns them for this reader: D6 for a team leader) and, for each active application, assigning the
// vacancy's tests (all of them, same versions, after the consent notice). Dark unless the provider connector and FIT v2
// are both on in this build (the vacancy's tests are read from FIT v2's requirements).
export function ProviderAssessmentsCard(props: {
  candidateId: string;
  applications: ProviderCardApplication[];
  /** Where the results are read in detail (the Assessments tab); absent on that tab itself. */
  onSeeDetails?: () => void;
}) {
  // Dark: render nothing and run no query (the page may have no QueryClient for C# reads).
  if (!isProviderAssessmentsStaffEnabled() || !isFitEngineV2Enabled()) return null;
  return <ProviderAssessmentsPanel {...props} />;
}
