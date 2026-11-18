'use client';

import Link from 'next/link';
import { CandidateAvatar, CHOICE_INPUT_CLASSES, StatusBadge, type StatusMapEntry } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';
import type { ScheduleRequest } from './pipeline-actions';
import type { FlatApp } from './pipeline-table-data';
import { RejectionBadge } from './rejection-badge';
import { PipelineFitChip } from './pipeline-fit-chip';
import { PipelineNoValue } from './pipeline-no-value';
import { PipelineRowActions } from './pipeline-row-actions';
import { PipelineSlaChip } from './pipeline-sla-chip';

interface PipelineTableRowProps {
  app: FlatApp;
  nextStage: { id: string; name: string } | undefined;
  statusMap: Record<string, StatusMapEntry>;
  bulkEnabled: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onMove: (applicationId: string, toStageId: string) => void;
  onReject?: (applicationId: string, candidateName: string) => void;
  onSchedule?: (request: ScheduleRequest) => void;
}

const CELL = 'py-2.5 px-3';

export function PipelineTableRow({
  app,
  nextStage,
  statusMap,
  bulkEnabled,
  isSelected,
  onToggleSelect,
  onMove,
  onReject,
  onSchedule,
}: PipelineTableRowProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  return (
    <tr
      className={`border-b border-border transition-colors ${isSelected ? 'bg-brand-tint' : 'hover:bg-surface-hover'}`}
    >
      {bulkEnabled && (
        <td className="py-2.5 pl-4">
          {app.actionable && (
            <input
              type="checkbox"
              aria-label={p.bulkSelectRow.replace('{name}', app.name)}
              checked={isSelected}
              onChange={onToggleSelect}
              className={CHOICE_INPUT_CLASSES}
            />
          )}
        </td>
      )}
      <td className={CELL}>
        <div className="flex items-center gap-2">
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
      </td>
      <td className={`${CELL} text-center`}>
        <StatusBadge tone="brand" icon="none">
          {app.stageName}
        </StatusBadge>
      </td>
      <td className={`${CELL} text-center`}>
        <PipelineFitChip score={app.fitScore} isPartial={app.isPartialFit} compact />
      </td>
      <td className={`${CELL} text-center whitespace-nowrap text-callout text-secondary`}>
        {candidateSourceLabel(app.source, t.candidates)}
      </td>
      <td className={`${CELL} text-center`}>
        {app.actionable ? (
          <span
            className="text-callout tabular-nums text-secondary"
            title={formatMessage(p.daysShortLabel, { n: app.days })}
          >
            <span aria-hidden="true">{formatMessage(p.daysShort, { n: app.days })}</span>
            <span className="sr-only">{formatMessage(p.daysShortLabel, { n: app.days })}</span>
          </span>
        ) : (
          <PipelineNoValue />
        )}
      </td>
      <td className={`${CELL} text-center`}>
        {app.status === 'rejected' ? (
          <RejectionBadge rejectedAt={app.rejectedAt} rejectedReason={app.rejectedReason} showReason />
        ) : (
          <StatusBadge status={app.status} map={statusMap} />
        )}
      </td>
      <td className={`${CELL} text-center`}>
        <PipelineSlaChip app={app} />
      </td>
      <td className="py-2.5 px-4 text-right">
        <PipelineRowActions
          app={app}
          nextStage={nextStage}
          onMove={onMove}
          onReject={onReject}
          onSchedule={onSchedule}
        />
      </td>
    </tr>
  );
}
