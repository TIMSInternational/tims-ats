'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { isProviderAssessmentsStaffEnabled } from '../../../../../lib/platform-api/assessment-providers-staff';
import { isFitEngineV2Enabled } from '../../../../../lib/platform-api/fit-engine';
import { AssignAssessmentModal } from './assign-assessment-modal';
import { AssignProviderAssessmentsModal } from './assign-provider-assessments-modal';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

type Application = CandidateDetail['applications'][number];

// The candidate page's assign actions. With TIMS Assessments on, the primary action assigns the vacancy's TIMS tests
// (ready-made: nothing to author) and the company's own quizzes move to a quieter secondary action, each label saying
// what it assigns. Recruiters met "Assign assessment" here, picked a TIMS name among the own quizzes and got
// "assessment_has_no_questions". Several active applications: the primary action opens the Assessments tab, which has one
// assign button per vacancy.
export function CandidateAssignActions({
  candidateId,
  applications,
  onOpenAssessmentsTab,
}: {
  candidateId: string;
  applications: Application[];
  onOpenAssessmentsTab: () => void;
}) {
  const { t } = useI18n();
  const can = useCan();
  const [ownQuiz, setOwnQuiz] = useState(false);
  const [timsFor, setTimsFor] = useState<{ id: string; title: string } | null>(null);
  const active = applications.filter((application) => application.status === 'active');
  if (active.length === 0) return null;

  const tims = isProviderAssessmentsStaffEnabled() && isFitEngineV2Enabled() && can('assessment', 'create');
  const openTims = () => {
    const only = active.length === 1 ? active[0] : null;
    if (only) setTimsFor({ id: only.vacancy.id, title: only.vacancy.title });
    else onOpenAssessmentsTab();
  };

  return (
    <div className="flex items-center gap-2">
      {tims && (
        <button
          type="button"
          onClick={() => setOwnQuiz(true)}
          className="rounded-lg border border-[#D9D5E6] bg-white px-3 py-2 text-[12px] font-medium text-[#1F114C] hover:bg-[#FAF9FD]"
        >
          {t.assessments.assignOwnQuiz}
        </button>
      )}
      <button
        type="button"
        onClick={tims ? openTims : () => setOwnQuiz(true)}
        className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white hover:bg-[#2a1866]"
      >
        {tims ? t.providerAssessments.assignTims : t.assessments.assignAssessment}
      </button>
      {ownQuiz && (
        <AssignAssessmentModal candidateId={candidateId} applications={active} onClose={() => setOwnQuiz(false)} />
      )}
      {timsFor && (
        <AssignProviderAssessmentsModal candidateId={candidateId} vacancy={timsFor} onClose={() => setTimsFor(null)} />
      )}
    </div>
  );
}
