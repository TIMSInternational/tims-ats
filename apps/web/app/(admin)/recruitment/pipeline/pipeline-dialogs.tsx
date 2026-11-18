'use client';

import { AddCandidateModal } from './add-candidate-modal';
import { RejectCandidateModal, type RejectableApplication } from './reject-candidate-modal';
import { ScheduleModal, type SchedulePrefill } from '../interviews/schedule-modal';

interface PipelineDialogsProps {
  vacancyId: string | null;
  vacancyTitle: string;
  rejectTarget: { applicationId: string; candidateName: string } | null;
  onCloseReject: () => void;
  bulkRejectTargets: RejectableApplication[] | null;
  onCloseBulkReject: () => void;
  scheduleTarget: SchedulePrefill | null;
  onCloseSchedule: () => void;
  showAddCandidate: boolean;
  onCloseAddCandidate: () => void;
  onCandidateAdded: () => void;
}

/** The board's dialogs: reject (one or bulk), schedule an interview, and add a candidate. */
export function PipelineDialogs(props: PipelineDialogsProps) {
  const { rejectTarget, bulkRejectTargets, scheduleTarget, vacancyId } = props;
  return (
    <>
      {rejectTarget && (
        <RejectCandidateModal
          candidateName={rejectTarget.candidateName}
          applications={[{ id: rejectTarget.applicationId, vacancyTitle: props.vacancyTitle }]}
          onClose={props.onCloseReject}
        />
      )}
      {bulkRejectTargets && (
        <RejectCandidateModal
          bulk
          candidateName=""
          applications={bulkRejectTargets}
          onClose={props.onCloseBulkReject}
        />
      )}
      {scheduleTarget && (
        <ScheduleModal prefill={scheduleTarget} onClose={props.onCloseSchedule} onSuccess={props.onCloseSchedule} />
      )}
      {props.showAddCandidate && vacancyId && (
        <AddCandidateModal
          vacancyId={vacancyId}
          vacancyTitle={props.vacancyTitle}
          onClose={props.onCloseAddCandidate}
          onSuccess={props.onCandidateAdded}
        />
      )}
    </>
  );
}
