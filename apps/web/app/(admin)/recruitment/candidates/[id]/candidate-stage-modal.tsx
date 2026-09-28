'use client';

import { useState } from 'react';
import { Modal } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

type Application = CandidateDetail['applications'][number];

export function CandidateStageModal({
  candidateId,
  applications,
  onClose,
}: {
  candidateId: string;
  applications: Application[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? '');
  const [toStageId, setToStageId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const application = applications.find((item) => item.id === applicationId);
  const stages = trpc.pipeline.listStages.useQuery(
    { vacancyId: application?.vacancy.id ?? '' },
    { enabled: !!application },
  );
  const utils = trpc.useUtils();
  const move = trpc.pipeline.moveCandidate.useMutation();

  const handleMove = async () => {
    if (!application || !toStageId || toStageId === application.currentStage?.id) return;
    setError(null);
    try {
      await move.mutateAsync({ applicationId, toStageId });
      await Promise.all([
        utils.candidate.getById.invalidate({ id: candidateId }),
        utils.candidate.getTimeline.invalidate({ candidateId }),
        utils.pipeline.getBoard.invalidate({ vacancyId: application.vacancy.id }),
      ]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.common.error);
    }
  };

  return (
    <Modal title={t.candidates.moveStage} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.candidates.tabApplications}
          <select
            value={applicationId}
            onChange={(event) => {
              setApplicationId(event.target.value);
              setToStageId('');
              setError(null);
            }}
            className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px] text-[#333]"
          >
            {applications.map((item) => (
              <option key={item.id} value={item.id}>{item.vacancy.title}</option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.pipeline.moveToStage}
          <select
            value={toStageId}
            onChange={(event) => setToStageId(event.target.value)}
            disabled={stages.isLoading || stages.isError}
            className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px] text-[#333]"
          >
            <option value="">{stages.isLoading ? t.common.loading : t.common.select}</option>
            {(stages.data ?? []).filter((stage) => stage.id !== application?.currentStage?.id).map((stage) => (
              <option key={stage.id} value={stage.id}>{stage.name}</option>
            ))}
          </select>
        </label>
        {stages.isError && <p role="alert" className="text-[12px] text-[#DD0C15]">{stages.error.message}</p>}
        {error && <p role="alert" className="text-[12px] text-[#DD0C15]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={move.isPending} className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]">
            {t.common.cancel}
          </button>
          <button type="button" onClick={handleMove} disabled={!toStageId || move.isPending} className="rounded-lg bg-[#DD0C15] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">
            {t.candidates.moveStage}
          </button>
        </div>
      </div>
    </Modal>
  );
}
