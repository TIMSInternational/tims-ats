'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { Button, Menu, buttonClasses } from '../../../../../components';
import { isProviderAssessmentsStaffEnabled } from '../../../../../lib/platform-api/assessment-providers-staff';
import { isFitEngineV2Enabled } from '../../../../../lib/platform-api/fit-engine';
import { AssignAssessmentModal } from './assign-assessment-modal';
import { AssignProviderAssessmentsModal } from './assign-provider-assessments-modal';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

type Application = CandidateDetail['applications'][number];

// The candidate page's assign actions. With TIMS Assessments on, both assign actions sit in the header's "Más
// acciones" menu (TIMS tests first: ready-made, nothing to author), each label saying what it assigns. Recruiters met "Assign assessment" here, picked a TIMS name among the own quizzes and got
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

  // Two assign actions go in a "Más acciones" menu so the header keeps one primary; a single one is a
  // secondary button (toolbars.md › Actions: "Add a More menu"). Items that open a dialog end with "…".
  return (
    <>
      {tims ? (
        <Menu
          items={[
            { key: 'tims', label: `${t.providerAssessments.assignTims}…`, onSelect: openTims },
            { key: 'own', label: `${t.assessments.assignOwnQuiz}…`, onSelect: () => setOwnQuiz(true) },
          ]}
          triggerClassName={`${buttonClasses({ variant: 'secondary' })} px-2.5`}
        />
      ) : (
        <Button variant="secondary" onClick={() => setOwnQuiz(true)}>
          {t.assessments.assignAssessment}
        </Button>
      )}
      {ownQuiz && (
        <AssignAssessmentModal candidateId={candidateId} applications={active} onClose={() => setOwnQuiz(false)} />
      )}
      {timsFor && (
        <AssignProviderAssessmentsModal candidateId={candidateId} vacancy={timsFor} onClose={() => setTimsFor(null)} />
      )}
    </>
  );
}
