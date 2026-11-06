'use client';

import Link from 'next/link';
import { CandidateAvatar, StatusBadge } from '../../../../components';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';
import { useI18n } from '../../../../lib/i18n';
import { fitBand, getPipelineFit, type FitBand } from '../../../../lib/pipeline-fit';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';
import { daysInStageLabel } from '../../../../lib/pipeline-days';
import { formatDate } from '../../../../lib/format-utils';
import { isActionableApplication, type ScheduleRequest } from './pipeline-actions';
import { applicationStatusMap } from './pipeline-status';
import { RejectionBadge } from './rejection-badge';

interface PipelineListViewProps {
  stages: PipelineStageWithApps[];
  onMove: (applicationId: string, toStageId: string) => void;
  /** Opens the reject modal for one application. Omitted when the user lacks pipeline:update. */
  onReject?: (applicationId: string, candidateName: string) => void;
  /** Opens the prefilled schedule form (A-10). Omitted when the user lacks interview:create. */
  onSchedule?: (request: ScheduleRequest) => void;
}

const STAGE_COLORS: Record<number, string> = {
  0: 'bg-[#E8E5F0] text-[#1F114C]',
  1: 'bg-[#D4CFE5] text-[#1F114C]',
  2: 'bg-[#B8AED4] text-white',
  3: 'bg-[#7B6BAA] text-white',
  4: 'bg-[#5C4B99] text-white',
  5: 'bg-[#1F114C] text-white',
};

function getStageColor(idx: number) {
  return STAGE_COLORS[Math.min(idx, 5)] ?? STAGE_COLORS[5];
}

function hoursAgo(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, (Date.now() - d.getTime()) / 3600000);
}

const FIT_COLORS: Record<FitBand, string> = {
  high: 'text-green-600 bg-green-50',
  medium: 'text-amber-600 bg-amber-50',
  low: 'text-red-600 bg-red-50',
};

/**
 * The list view (the default on phones). Below md each row stacks — name, then the facts, then the actions —
 * instead of a fixed ~510 px row that pushed "Avanzar" and "Rechazar" off a 390 px screen (A-22). The page
 * shows an empty state when no stage has candidates.
 */
export function PipelineListView({ stages, onMove, onReject, onSchedule }: PipelineListViewProps) {
  const { t } = useI18n();
  const statusMap = applicationStatusMap(t.pipeline.applicationStatus);
  return (
    <div className="space-y-4 overflow-y-auto h-full pb-4">
      {stages.map((stage, stageIdx) => {
        if (stage.applications.length === 0) return null;
        return (
          <div key={stage.id} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            {/* Stage header */}
            <div className={`flex items-center justify-between px-4 py-2.5 ${getStageColor(stageIdx)}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-semibold truncate">{stage.name}</span>
                <span className="bg-white/20 text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                  {stage.applications.length}
                </span>
              </div>
              {stage.slaHours && <span className="text-[10px] opacity-70 shrink-0">{stage.slaHours}h SLA</span>}
            </div>

            {/* Candidates in this stage */}
            <div className="divide-y divide-[#F0F0F0]">
              {stage.applications.map((app) => {
                const c = app.candidate;
                const name = `${c.firstName} ${c.lastName}`;
                const fit = getPipelineFit(app.candidate);
                const actionable = isActionableApplication(app);
                // SLA overdue is time-in-CURRENT-stage, not time since the original
                // application, and uses precise hours so sub-24h SLAs can trigger same-day.
                const isOverdue = actionable && stage.slaHours != null && hoursAgo(app.enteredStageAt) > stage.slaHours;
                const nextStage = stages[stageIdx + 1];

                return (
                  <div
                    key={app.id}
                    className={`flex flex-col gap-2 md:flex-row md:items-center md:gap-4 px-4 py-3 hover:bg-[#FAFAFA] transition ${isOverdue ? 'border-l-[3px] border-l-[#DD0C15]' : ''}`}
                  >
                    {/* Avatar + Name */}
                    <div className="flex items-center gap-2.5 min-w-0 md:w-[220px] md:shrink-0">
                      <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/recruitment/candidates/${c.id}`} className="text-[12px] font-medium text-[#333] truncate block hover:underline">
                          {name}
                        </Link>
                        {c.currentTitle && <p className="text-[10px] text-[#8B8B8B] truncate">{c.currentTitle}</p>}
                      </div>
                    </div>

                    {/* Facts: FIT, source, days in stage, status — one wrapping line on phones */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-nowrap md:gap-4">
                      {/* Only persisted FIT results may be presented as scores. */}
                      <div className="md:w-[60px] md:shrink-0">
                        {fit ? (
                          <span
                            title={`${t.pipeline.fitScore}: ${fit.score}${fit.isPartial ? ` (${t.pipeline.fitPartial})` : ''}`}
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${FIT_COLORS[fitBand(fit.score)]}`}
                          >
                            {Math.round(fit.score)}{fit.isPartial ? '*' : ''}
                          </span>
                        ) : (
                          <span title={t.pipeline.fitPending} className="text-[11px] text-[#8B8B8B]">—</span>
                        )}
                      </div>
                      <div className="md:w-[80px] md:shrink-0">
                        <span className="text-[10px] text-[#585858]">{candidateSourceLabel(app.source, t.candidates)}</span>
                      </div>
                      {actionable && (
                        <div className="md:w-[110px] md:shrink-0">
                          <span
                            title={t.pipeline.appliedOnTitle.replace('{date}', formatDate(app.appliedAt))}
                            className={`text-[11px] ${isOverdue ? 'text-[#DD0C15] font-medium' : 'text-[#8B8B8B]'}`}
                          >
                            {daysInStageLabel(app.enteredStageAt, t.pipeline)} {isOverdue && '⚠'}
                          </span>
                        </div>
                      )}
                      <div className="md:w-[80px] md:shrink-0">
                        {app.status === 'rejected' ? (
                          <RejectionBadge rejectedAt={app.rejectedAt} rejectedReason={app.rejectedReason} showReason />
                        ) : (
                          <StatusBadge status={app.status} map={statusMap} />
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 md:ml-auto">
                      {actionable && nextStage && (
                        <button
                          type="button"
                          onClick={() => onMove(app.id, nextStage.id)}
                          className="text-[10px] text-[#1F114C] bg-[#F0EEF5] hover:bg-[#E8E5F0] px-2.5 py-1 rounded-lg font-medium transition"
                        >
                          {t.pipeline.advance}
                        </button>
                      )}
                      {actionable && onSchedule && (
                        <button
                          type="button"
                          onClick={() => onSchedule({ applicationId: app.id, candidateId: c.id, candidateName: name })}
                          aria-label={t.pipeline.scheduleInterviewFor.replace('{name}', name)}
                          className="text-[10px] text-[#1F114C] hover:bg-[#F0EEF5] px-2.5 py-1 rounded-lg font-medium transition"
                        >
                          {t.pipeline.scheduleShort}
                        </button>
                      )}
                      <Link href={`/recruitment/candidates/${c.id}`} className="text-[10px] text-[#585858] hover:text-[#1F114C] transition">
                        {t.pipeline.viewProfile}
                      </Link>
                      {actionable && onReject && (
                        <button
                          type="button"
                          onClick={() => onReject(app.id, name)}
                          aria-label={t.rejectCandidateModal.actionLabel.replace('{name}', name)}
                          className="text-[10px] text-[#DD0C15] hover:bg-red-50 px-2.5 py-1 rounded-lg font-medium transition"
                        >
                          {t.pipeline.reject}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
