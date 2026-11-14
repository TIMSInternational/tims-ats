'use client';

import Link from 'next/link';
import { CandidateAvatar, CHOICE_INPUT_CLASSES, StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import type { ScheduleRequest } from './pipeline-actions';
import type { FlatApp } from './pipeline-table-data';
import { RejectionBadge } from './rejection-badge';
import { PipelineFitChip } from './pipeline-fit-chip';
import { PipelineRowActions } from './pipeline-row-actions';
import { PipelineSlaChip } from './pipeline-sla-chip';

interface PipelineTableCardProps {
  app: FlatApp;
  nextStage: { id: string; name: string } | undefined;
  bulkEnabled: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onMove: (applicationId: string, toStageId: string) => void;
  onReject?: (applicationId: string, candidateName: string) => void;
  onSchedule?: (request: ScheduleRequest) => void;
}

/**
 * One table row as a stacked item below md (scroll-views.md, layout.md › Size classes: "Keep functionality the
 * same"): selection for the bulk bar, name, stage / FIT / SLA chips, then the row's actions.
 */
export function PipelineTableCard({
  app,
  nextStage,
  bulkEnabled,
  isSelected,
  onToggleSelect,
  onMove,
  onReject,
  onSchedule,
}: PipelineTableCardProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  return (
    <li className={`px-4 py-3 space-y-2 ${isSelected ? 'bg-brand-tint' : ''}`}>
      <div className="flex items-center gap-3">
        {bulkEnabled && app.actionable && (
          <label className="flex size-11 shrink-0 items-center justify-center -ml-3">
            <input
              type="checkbox"
              aria-label={p.bulkSelectRow.replace('{name}', app.name)}
              checked={isSelected}
              onChange={onToggleSelect}
              className={CHOICE_INPUT_CLASSES}
            />
          </label>
        )}
        <CandidateAvatar firstName={app.firstName} lastName={app.lastName} avatar={app.avatar} size="sm" decorative />
        <div className="min-w-0">
          <Link
            href={`/recruitment/candidates/${app.candidateId}`}
            className="text-body font-medium text-primary truncate block hover:underline"
          >
            {app.name}
          </Link>
          {app.currentTitle && <p className="text-callout text-secondary truncate">{app.currentTitle}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="brand" icon="none">
          {app.stageName}
        </StatusBadge>
        <PipelineFitChip score={app.fitScore} isPartial={app.isPartialFit} />
        {app.status === 'rejected' ? (
          <RejectionBadge rejectedAt={app.rejectedAt} rejectedReason={app.rejectedReason} showReason />
        ) : (
          <PipelineSlaChip app={app} />
        )}
      </div>
      <PipelineRowActions
        app={app}
        nextStage={nextStage}
        onMove={onMove}
        onReject={onReject}
        onSchedule={onSchedule}
        stacked
      />
    </li>
  );
}
