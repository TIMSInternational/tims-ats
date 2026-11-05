'use client';

import Link from 'next/link';
import { CandidateAvatar, StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { fitBand, type FitBand } from '../../../../lib/pipeline-fit';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';
import type { ScheduleRequest } from './pipeline-actions';
import type { FlatApp } from './pipeline-table-data';

const FIT_COLORS: Record<FitBand, string> = {
  high: 'text-green-600 bg-green-50',
  medium: 'text-amber-600 bg-amber-50',
  low: 'text-red-600 bg-red-50',
};

const STAGE_BADGE: Record<number, string> = {
  0: 'bg-[#E8E5F0] text-[#1F114C]',
  1: 'bg-[#D4CFE5] text-[#1F114C]',
  2: 'bg-[#B8AED4] text-[#1F114C]',
  3: 'bg-[#7B6BAA] text-white',
  4: 'bg-[#5C4B99] text-white',
  5: 'bg-[#1F114C] text-white',
};

interface PipelineTableRowProps {
  app: FlatApp;
  nextStage: { id: string; name: string } | undefined;
  striped: boolean;
  statusMap: Record<string, { cls: string; label: string }>;
  bulkEnabled: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onMove: (applicationId: string, toStageId: string) => void;
  onReject?: (applicationId: string, candidateName: string) => void;
  onSchedule?: (request: ScheduleRequest) => void;
}

export function PipelineTableRow({
  app,
  nextStage,
  striped,
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
    <tr className={`border-b border-[#F0F0F0] hover:bg-[#FAFAFA] transition ${striped ? 'bg-[#FAFAFA]/50' : ''} ${app.isOverdue ? 'border-l-[3px] border-l-[#DD0C15]' : ''}`}>
      {bulkEnabled && (
        <td className="py-2.5 pl-4">
          {app.actionable && (
            <input
              type="checkbox"
              aria-label={p.bulkSelectRow.replace('{name}', app.name)}
              checked={isSelected}
              onChange={onToggleSelect}
              className="h-3.5 w-3.5 accent-[#1F114C]"
            />
          )}
        </td>
      )}
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          <CandidateAvatar firstName={app.firstName} lastName={app.lastName} avatar={app.avatar} size="sm" />
          <div className="min-w-0">
            <Link href={`/recruitment/candidates/${app.candidateId}`} className="text-[12px] font-medium text-[#333] truncate block hover:underline">
              {app.name}
            </Link>
            {app.currentTitle && <p className="text-[10px] text-[#8B8B8B] truncate">{app.currentTitle}</p>}
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 text-center">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STAGE_BADGE[Math.min(app.stageOrder, 5)]}`}>
          {app.stageName}
        </span>
      </td>
      <td className="py-2.5 px-3 text-center">
        {app.fitScore === null ? (
          <span title={p.fitPending} className="text-[11px] text-[#8B8B8B]">—</span>
        ) : (
          <span title={`${p.fitScore}: ${app.fitScore}${app.isPartialFit ? ` (${p.fitPartial})` : ''}`} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${FIT_COLORS[fitBand(app.fitScore)]}`}>
            {Math.round(app.fitScore)}{app.isPartialFit ? '*' : ''}
          </span>
        )}
      </td>
      <td className="py-2.5 px-3 text-center">
        <span className="text-[10px] text-[#585858]">{candidateSourceLabel(app.source, t.candidates)}</span>
      </td>
      <td className="py-2.5 px-3 text-center">
        {app.actionable ? (
          <span className={`text-[11px] ${app.isOverdue ? 'text-[#DD0C15] font-medium' : 'text-[#8B8B8B]'}`}>{app.days}d</span>
        ) : (
          <span className="text-[9px] text-[#ccc]">—</span>
        )}
      </td>
      <td className="py-2.5 px-3 text-center">
        <StatusBadge status={app.status} map={statusMap} />
      </td>
      <td className="py-2.5 px-3 text-center">
        {app.isOverdue ? (
          <span className="text-[9px] bg-red-50 text-[#DD0C15] px-1.5 py-0.5 rounded font-medium">{p.slaOverdueShort}</span>
        ) : app.actionable && app.slaHours ? (
          <span className="text-[9px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">{p.slaOnTime}</span>
        ) : (
          <span className="text-[9px] text-[#ccc]">—</span>
        )}
      </td>
      <td className="py-2.5 px-4 text-right">
        <div className="flex items-center gap-2 justify-end">
          {app.actionable && nextStage && (
            <button type="button" onClick={() => onMove(app.id, nextStage.id)} className="text-[10px] text-[#1F114C] bg-[#F0EEF5] hover:bg-[#E8E5F0] px-2 py-1 rounded font-medium transition">
              → {nextStage.name}
            </button>
          )}
          {app.actionable && onSchedule && (
            <button
              type="button"
              onClick={() => onSchedule({ applicationId: app.id, candidateId: app.candidateId, candidateName: app.name })}
              aria-label={p.scheduleInterviewFor.replace('{name}', app.name)}
              className="text-[10px] text-[#1F114C] hover:bg-[#F0EEF5] px-2 py-1 rounded font-medium transition"
            >
              {p.scheduleShort}
            </button>
          )}
          <Link href={`/recruitment/candidates/${app.candidateId}`} className="text-[10px] text-[#585858] hover:text-[#1F114C]">
            {p.viewShort}
          </Link>
          {app.actionable && onReject && (
            <button
              type="button"
              onClick={() => onReject(app.id, app.name)}
              aria-label={t.rejectCandidateModal.actionLabel.replace('{name}', app.name)}
              className="text-[10px] text-[#DD0C15] hover:bg-red-50 px-2 py-1 rounded font-medium transition"
            >
              {p.reject}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
