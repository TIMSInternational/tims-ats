'use client';

import { useState } from 'react';
import { Modal } from '../../../../../components';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

type Application = CandidateDetail['applications'][number];

export function AssignAssessmentModal({ candidateId, applications, onClose }: {
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
      setError(cause instanceof Error ? cause.message : t.common.error);
    }
  };

  return (
    <Modal title={t.assessments.assignAssessment} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.offers.colVacancy}
          <select value={applicationId} onChange={(event) => setApplicationId(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px]">
            {applications.map((item) => <option key={item.id} value={item.id}>{item.vacancy.title}</option>)}
          </select>
        </label>
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.assessments.selectType}
          <select value={assessmentTypeId} onChange={(event) => setAssessmentTypeId(event.target.value)} disabled={types.isLoading || types.isError} className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px]">
            <option value="">{t.assessments.selectTypePlaceholder}</option>
            {(types.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {types.data?.length === 0 && <p className="text-[12px] text-[#8B8B8B]">{t.assessments.noTypesDesc}</p>}
        {types.isError && <p role="alert" className="text-[12px] text-red-600">{types.error.message}</p>}
        {error && <p role="alert" className="text-[12px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={assign.isPending} className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]">{t.common.cancel}</button>
          <button type="button" onClick={submit} disabled={!application || !assessmentTypeId || assign.isPending} className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">{t.assessments.assignAssessment}</button>
        </div>
      </div>
    </Modal>
  );
}
