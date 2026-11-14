'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Button } from '../../../../../components';
import type { CandidateDetail } from '../../../../../lib/trpc-types';
import { useCan } from '../../../../../lib/permissions';
import { CandidateStageModal } from './candidate-stage-modal';
import { CreateOfferButton } from './create-offer-button';
import { RejectCandidateModal } from '../../pipeline/reject-candidate-modal';

/**
 * The candidate's action group in the page header (toolbars.md › Actions): secondary actions first,
 * "Rechazar" as the destructive secondary, and ONE navy primary — "Mover etapa" — on the trailing edge.
 * Only for a candidate with an active application.
 */
export function CandidateHeaderActions({
  candidate: c,
  onScheduleInterview,
}: {
  candidate: CandidateDetail;
  /** Opens the schedule form prefilled with this candidate (A-10); omitted without interview:create. */
  onScheduleInterview?: () => void;
}) {
  const { t } = useI18n();
  const [showStageModal, setShowStageModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const canReject = useCan()('pipeline', 'update');
  const activeApplications = c.applications.filter((application) => application.status === 'active');
  const hasActive = activeApplications.length > 0;

  return (
    <>
      {hasActive && onScheduleInterview && (
        <Button variant="secondary" onClick={onScheduleInterview}>
          {t.candidates.scheduleInterview}
        </Button>
      )}
      <CreateOfferButton candidateId={c.id} applications={activeApplications} />
      {hasActive && canReject && (
        <Button variant="destructive-secondary" onClick={() => setShowRejectModal(true)}>
          {t.pipeline.reject}
        </Button>
      )}
      {hasActive && <Button onClick={() => setShowStageModal(true)}>{t.candidates.moveStage}</Button>}

      {showStageModal && (
        <CandidateStageModal
          candidateId={c.id}
          applications={activeApplications}
          onClose={() => setShowStageModal(false)}
        />
      )}
      {showRejectModal && (
        <RejectCandidateModal
          candidateName={`${c.firstName} ${c.lastName}`}
          applications={activeApplications.map((a) => ({ id: a.id, vacancyTitle: a.vacancy.title }))}
          onClose={() => setShowRejectModal(false)}
        />
      )}
    </>
  );
}
