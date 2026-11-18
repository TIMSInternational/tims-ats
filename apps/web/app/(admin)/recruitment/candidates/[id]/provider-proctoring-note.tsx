'use client';

import { useI18n } from '../../../../../lib/i18n';
import type { ProctoringOutcome } from '../../../../../lib/platform-api/assessment-providers-staff';

// What the sitting's proctoring did, for HR (company scope only: the C# read sends null to a narrow reader, D6, and the
// candidate never sees it, D9). Neutral wording: an auto-submitted result is for a person to review, never a verdict;
// a voided sitting used the attempt, and a retake is a new assignment.
export function ProviderProctoringNote({
  outcome,
  reasons,
}: {
  outcome: ProctoringOutcome | null | undefined;
  reasons?: readonly string[] | null;
}) {
  const { t } = useI18n();
  const p = t.providerAssessments.proctoring;
  const labels = p.reasons as Record<string, string>;
  const known = (reasons ?? []).map((reason) => labels[reason]).filter((label): label is string => Boolean(label));
  if (!outcome && known.length === 0) return null;

  return (
    <div
      className="mt-1 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
      data-testid="provider-proctoring-note"
    >
      {outcome && (
        <>
          <p className="font-medium">{outcome === 'auto_submitted' ? p.autoSubmittedTitle : p.voidedTitle}</p>
          <p>{outcome === 'auto_submitted' ? p.autoSubmitted : p.voided}</p>
        </>
      )}
      {known.length > 0 && <p className="text-[11px]">{p.reasonsLabel.replace('{reasons}', known.join(', '))}</p>}
    </div>
  );
}
