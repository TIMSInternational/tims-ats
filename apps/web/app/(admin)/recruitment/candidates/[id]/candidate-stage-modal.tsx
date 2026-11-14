'use client';

import { useState } from 'react';
import { Button, Field, Modal, Select } from '../../../../../components';
import { formatMessage } from '../../../../../lib/i18n/format';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import type { CandidateDetail } from '../../../../../lib/trpc-types';
import { useCan } from '../../../../../lib/permissions';
import { announceStageMove } from '../../../../../lib/pipeline-move-toast';

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
  const can = useCan();
  const move = trpc.pipeline.moveCandidate.useMutation();

  const handleMove = async () => {
    if (!application || !toStageId || toStageId === application.currentStage?.id) return;
    setError(null);
    try {
      const result = await move.mutateAsync({ applicationId, toStageId });
      // The same feedback as a move on the board (A-13): checklist warning, next step, or "Candidato movido".
      const destination = stages.data?.find((stage) => stage.id === toStageId)?.name;
      announceStageMove(result, destination, t.pipeline, { can, candidateId, applicationId });
      await Promise.all([
        utils.candidate.getById.invalidate({ id: candidateId }),
        utils.candidate.getTimeline.invalidate({ candidateId }),
        utils.pipeline.getBoard.invalidate({ vacancyId: application.vacancy.id }),
        utils.pipeline.getMovementHistory.invalidate({ applicationId }),
      ]);
      onClose();
    } catch {
      // A generic, actionable line: raw server messages are not shown (writing.md › Best practices).
      setError(t.candidates.moveStageError);
    }
  };

  const currentStage = application?.currentStage?.name;

  return (
    <Modal
      title={t.candidates.moveStage}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={move.isPending}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleMove} disabled={!toStageId} loading={move.isPending}>
            {t.candidates.moveStage}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {applications.length > 1 ? (
          <Field label={t.candidates.stageModalVacancy} id="stage-application">
            <Select
              value={applicationId}
              onChange={(event) => {
                setApplicationId(event.target.value);
                setToStageId('');
                setError(null);
              }}
            >
              {applications.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.vacancy.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          application && (
            <p className="text-body text-primary">
              {formatMessage(t.candidates.processTimelineFor, { vacancy: application.vacancy.title })}
            </p>
          )
        )}
        {currentStage && (
          <p className="text-callout text-secondary">
            {t.candidates.stageCurrent}: <span className="font-medium text-primary">{currentStage}</span>
          </p>
        )}
        <Field
          label={t.pipeline.moveToStage}
          id="stage-destination"
          error={stages.isError ? t.candidates.stagesLoadError : undefined}
        >
          <Select
            value={toStageId}
            onChange={(event) => setToStageId(event.target.value)}
            disabled={stages.isLoading || stages.isError}
          >
            <option value="">{stages.isLoading ? t.common.loading : t.common.select}</option>
            {(stages.data ?? [])
              .filter((stage) => stage.id !== application?.currentStage?.id)
              .map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
          </Select>
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
