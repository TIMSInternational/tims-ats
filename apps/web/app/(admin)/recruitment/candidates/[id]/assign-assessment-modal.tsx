'use client';

import { useState } from 'react';
import { BUTTON_GROUP_CLASSES, Button, Modal, selectClasses } from '../../../../../components';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

type Application = CandidateDetail['applications'][number];

export function AssignAssessmentModal({
  candidateId,
  applications,
  onClose,
}: {
  candidateId: string;
  applications: Application[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const types = trpc.assessment.listTypes.useQuery();
  const assign = trpc.assessment.assign.useMutation();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? '');
  const [assessmentTypeId, setAssessmentTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const application = applications.find((item) => item.id === applicationId);

  const submit = async () => {
    if (!application || !assessmentTypeId) return;
    setError(null);
    try {
      await assign.mutateAsync({ candidateId, vacancyId: application.vacancy.id, assessmentTypeId });
      await utils.candidate.getById.invalidate({ id: candidateId });
      onClose();
    } catch (cause) {
      // The server's code, in words a recruiter can act on (an own quiz with no questions yet).
      const message = cause instanceof Error ? cause.message : '';
      setError(
        message === 'assessment_has_no_questions' ? t.assessments.ownQuizHasNoQuestions : message || t.common.error,
      );
    }
  };

  return (
    <Modal title={t.assessments.assignAssessment} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-body font-medium text-primary">
          {t.offers.colVacancy}
          <select
            value={applicationId}
            onChange={(event) => setApplicationId(event.target.value)}
            className={`mt-1.5 font-normal ${selectClasses()}`}
          >
            {applications.map((item) => (
              <option key={item.id} value={item.id}>
                {item.vacancy.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-body font-medium text-primary">
          {t.assessments.selectType}
          <select
            value={assessmentTypeId}
            onChange={(event) => setAssessmentTypeId(event.target.value)}
            disabled={types.isLoading || types.isError}
            className={`mt-1.5 font-normal ${selectClasses()}`}
          >
            <option value="">{t.assessments.selectTypePlaceholder}</option>
            {(types.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-callout text-secondary">{t.assessments.ownQuizHint}</p>
        {types.data?.length === 0 && <p className="text-callout text-secondary">{t.assessments.noTypesDesc}</p>}
        {types.isError && (
          <p role="alert" className="text-callout text-danger">
            {types.error.message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-callout text-danger">
            {error}
          </p>
        )}
        <div className={BUTTON_GROUP_CLASSES}>
          <Button variant="secondary" onClick={onClose} disabled={assign.isPending}>
            {t.common.cancel}
          </Button>
          <Button onClick={submit} disabled={!application || !assessmentTypeId} loading={assign.isPending}>
            {t.assessments.assignAssessment}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
