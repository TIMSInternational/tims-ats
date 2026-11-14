'use client';

import { Button } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import type { ScheduleRequest } from './pipeline-actions';
import type { FlatApp } from './pipeline-table-data';

interface PipelineRowActionsProps {
  app: FlatApp;
  nextStage: { id: string; name: string } | undefined;
  onMove: (applicationId: string, toStageId: string) => void;
  onReject?: (applicationId: string, candidateName: string) => void;
  onSchedule?: (request: ScheduleRequest) => void;
  /** Phones: a two-column grid of full-width 44px buttons. */
  stacked?: boolean;
}

/** A table row's actions (and the same actions on its phone card): move on, schedule, open, reject. */
export function PipelineRowActions({
  app,
  nextStage,
  onMove,
  onReject,
  onSchedule,
  stacked = false,
}: PipelineRowActionsProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const width = stacked ? 'w-full min-h-11' : '';
  return (
    <div className={stacked ? 'grid grid-cols-2 gap-2' : 'flex items-center justify-end gap-1.5'}>
      {app.actionable && nextStage && (
        <Button variant="secondary" size="sm" className={width} onClick={() => onMove(app.id, nextStage.id)}>
          {formatMessage(p.moveToStageNamed, { stage: nextStage.name })}
        </Button>
      )}
      {app.actionable && onSchedule && (
        <Button
          variant="tertiary"
          size="sm"
          className={width}
          onClick={() => onSchedule({ applicationId: app.id, candidateId: app.candidateId, candidateName: app.name })}
          aria-label={p.scheduleInterviewFor.replace('{name}', app.name)}
        >
          {p.scheduleShort}
        </Button>
      )}
      <Button href={`/recruitment/candidates/${app.candidateId}`} variant="tertiary" size="sm" className={width}>
        {stacked ? p.viewProfile : p.viewShort}
      </Button>
      {app.actionable && onReject && (
        <Button
          variant="destructive-secondary"
          size="sm"
          className={width}
          onClick={() => onReject(app.id, app.name)}
          aria-label={t.rejectCandidateModal.actionLabel.replace('{name}', app.name)}
        >
          {p.reject}
        </Button>
      )}
    </div>
  );
}
