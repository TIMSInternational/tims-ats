'use client';

import Link from 'next/link';
import { CandidateAvatar } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { fitBand, getPipelineFit, type FitBand } from '../../../../lib/pipeline-fit';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';
import { daysInStageLabel } from '../../../../lib/pipeline-days';
import { formatDate } from '../../../../lib/format-utils';
import { RejectionBadge } from './rejection-badge';

interface KanbanCardProps {
  application: {
    id: string;
    status: string;
    source: string;
    appliedAt: Date | string;
    enteredStageAt: Date | string;
    rejectedAt?: Date | string | null;
    rejectedReason?: string | null;
    // Prisma.JsonValue (read via isItemComplete below) — only the
    // current stage's completion map is ever written (Sprint 1.3 Task 1).
    checklistProgress?: unknown;
    candidate: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      avatar: string | null;
      currentTitle?: string | null;
      currentCompany?: string | null;
      fitScores?: { overallScore: number; isPartial: boolean }[];
    };
  };
  isDragging: boolean;
  slaHours?: number | null;
  // Current stage's checklist config (Prisma.JsonValue — PipelineStage.checklist)
  // + the stage id it belongs to, so a completion toggle can be attributed to
  // the right key in checklistProgress[stageId][itemKey].
  stageId: string;
  checklist?: unknown;
  onToggleChecklistItem?: (applicationId: string, stageId: string, itemKey: string, completed: boolean) => void;
  /** Opens the reject modal. Omitted when the user lacks pipeline:update or the card is not active. */
  onReject?: () => void;
  /** Opens the prefilled schedule form (A-10). Omitted when the user lacks interview:create. */
  onSchedule?: () => void;
}

interface ChecklistItem {
  key: string;
  label: string;
}

function coerceChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v))
    .map((v) => ({ key: typeof v.key === 'string' ? v.key : '', label: typeof v.label === 'string' ? v.label : '' }))
    .filter((item) => item.key !== '');
}

function isItemComplete(progress: unknown, stageId: string, itemKey: string): boolean {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return false;
  const stageProgress = (progress as Record<string, unknown>)[stageId];
  if (!stageProgress || typeof stageProgress !== 'object' || Array.isArray(stageProgress)) return false;
  const entry = (stageProgress as Record<string, unknown>)[itemKey];
  return !!entry && typeof entry === 'object' && (entry as { completed?: unknown }).completed === true;
}

function hoursAgo(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60));
}

// One FIT scale with the list, the table, the filter and the Candidate 360 (lib/pipeline-fit.ts FIT_BANDS).
const FIT_BORDER: Record<FitBand, string> = { high: 'border-green-500', medium: 'border-amber-500', low: 'border-red-500' };
const FIT_BADGE: Record<FitBand, string> = { high: 'bg-green-500', medium: 'bg-amber-500', low: 'bg-red-500' };

function fitBorderColor(score: number | null): string {
  return score === null ? 'border-[#EDEDED]' : FIT_BORDER[fitBand(score)];
}

const SOURCE_STYLES: Record<string, { bg: string; text: string }> = {
  linkedin:  { bg: 'bg-blue-50',   text: 'text-blue-600' },
  referral:  { bg: 'bg-green-50',  text: 'text-green-600' },
  portal:    { bg: 'bg-purple-50', text: 'text-purple-600' },
  job_board: { bg: 'bg-orange-50', text: 'text-orange-600' },
  university:{ bg: 'bg-teal-50',   text: 'text-teal-600' },
  internal:  { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  other:     { bg: 'bg-gray-50',   text: 'text-gray-600' },
};

function getSourceStyle(source: string) {
  return SOURCE_STYLES[source.toLowerCase()] ?? SOURCE_STYLES.other!;
}

export function KanbanCard({ application: app, isDragging, slaHours, stageId, checklist, onToggleChecklistItem, onReject, onSchedule }: KanbanCardProps) {
  const { t } = useI18n();
  const candidate = app.candidate;
  const candidateName = `${candidate.firstName} ${candidate.lastName}`;
  const fit = getPipelineFit(candidate);
  const fitScore = fit?.score ?? null;
  const isActive = app.status === 'active';
  // Days in the CURRENT stage (A-23) — the same clock as the SLA badge and the "Días en etapa" filter; the
  // application date stays in the tooltip.
  const inStage = daysInStageLabel(app.enteredStageAt, t.pipeline);
  const appliedTitle = t.pipeline.appliedOnTitle.replace('{date}', formatDate(app.appliedAt));
  // SLA overdue is time-in-CURRENT-stage, not time since the original
  // application — a card that's been in the pipeline a while but just moved
  // into this stage isn't overdue. Uses precise hours, not floored days*24,
  // so sub-24h SLAs (e.g. an 8h stage) can actually trigger same-day. Only an active card can be overdue.
  const isOverdue = isActive && slaHours != null && hoursAgo(app.enteredStageAt) > slaHours;
  const sourceStyle = getSourceStyle(app.source);
  const checklistItems = coerceChecklist(checklist);

  return (
    <div
      className={`bg-white rounded-lg p-3 border-l-[4px] transition-shadow cursor-grab ${
        isDragging
          ? 'shadow-lg border-[#1F114C] rotate-[2deg]'
          : `shadow-[0_1px_3px_rgba(0,0,0,0.08)] ${fitBorderColor(fitScore)} hover:shadow-md`
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <CandidateAvatar
          firstName={candidate.firstName}
          lastName={candidate.lastName}
          avatar={candidate.avatar}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <Link
            href={`/recruitment/candidates/${candidate.id}`}
            className="text-[12px] font-medium text-[#333] truncate block hover:underline"
          >
            {candidate.firstName} {candidate.lastName}
          </Link>
          {candidate.currentTitle && (
            <p className="text-[10px] text-[#8B8B8B] truncate">{candidate.currentTitle}</p>
          )}
        </div>
        {fitScore === null ? (
          <span className="shrink-0 text-[10px] text-[#8B8B8B]" title={t.pipeline.fitPending}>—</span>
        ) : (
          // The score is advisory: it opens the FIT detail on the profile, where its reasons are (ideal-110).
          <Link
            href={`/recruitment/candidates/${candidate.id}?tab=tabFitGaps`}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label={t.pipeline.fitDetailLink.replace('{name}', candidateName)}
            className={`${FIT_BADGE[fitBand(fitScore)]} text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 hover:opacity-90`}
            title={`${t.pipeline.fitScore}: ${fitScore}${fit?.isPartial ? ` (${t.pipeline.fitPartial})` : ''}`}
          >
            {Math.round(fitScore)}{fit?.isPartial ? '*' : ''}
          </Link>
        )}
        {onSchedule && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSchedule(); }}
            aria-label={t.pipeline.scheduleInterviewFor.replace('{name}', candidateName)}
            title={t.pipeline.scheduleInterview}
            className="shrink-0 rounded p-0.5 text-[#8B8B8B] hover:bg-[#F0EEF5] hover:text-[#1F114C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F114C]/40"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </button>
        )}
        {/* Reject button inside the drag handle: the dnd lib ignores drags from buttons, and
            stopPropagation keeps a mouse press from arming one. */}
        {onReject && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onReject(); }}
            aria-label={t.rejectCandidateModal.actionLabel.replace('{name}', candidateName)}
            title={t.pipeline.reject}
            className="shrink-0 rounded p-0.5 text-[#8B8B8B] hover:bg-red-50 hover:text-[#DD0C15] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DD0C15]/40"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className={`text-[10px] ${sourceStyle.bg} ${sourceStyle.text} px-1.5 py-0.5 rounded`}>
          {candidateSourceLabel(app.source, t.candidates)}
        </span>
        {isActive ? (
          <span title={appliedTitle} className={`text-[10px] ${isOverdue ? 'text-[#DD0C15] font-medium' : 'text-[#8B8B8B]'}`}>
            {inStage}
          </span>
        ) : app.status === 'rejected' ? (
          <RejectionBadge rejectedAt={app.rejectedAt} rejectedReason={app.rejectedReason} />
        ) : (
          <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-medium">
            {t.pipeline.applicationStatus[app.status as keyof typeof t.pipeline.applicationStatus] ?? app.status}
          </span>
        )}
        {isOverdue && (
          <span className="text-[9px] bg-red-50 text-[#DD0C15] px-1.5 py-0.5 rounded font-medium">
            SLA!
          </span>
        )}
      </div>

      {isOverdue && (
        <div className="mt-1.5 pt-1.5 border-t border-[#F0F0F0]">
          <p className="text-[10px] text-teal-600 italic">{t.pipeline.iaReviewUrgent}</p>
        </div>
      )}
      {isActive && !isOverdue && fitScore !== null && !fit?.isPartial && fitScore >= 80 && (
        <div className="mt-1.5 pt-1.5 border-t border-[#F0F0F0]">
          <p className="text-[10px] text-teal-600 italic">{t.pipeline.iaAdvanceHighFit}</p>
        </div>
      )}

      {checklistItems.length > 0 && (
        // stopPropagation on mousedown so a checkbox click never starts a
        // drag on the @hello-pangea/dnd handle wrapping this whole card.
        <div
          className="mt-1.5 pt-1.5 border-t border-[#F0F0F0] space-y-1"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p className="text-[9px] font-medium text-[#8B8B8B] uppercase tracking-wide">{t.pipeline.checklistTitle}</p>
          {checklistItems.map((item) => {
            const completed = isItemComplete(app.checklistProgress, stageId, item.key);
            return (
              <label key={item.key} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={completed}
                  disabled={!isActive}
                  onChange={(e) => onToggleChecklistItem?.(app.id, stageId, item.key, e.target.checked)}
                  className="w-3 h-3 accent-[#1F114C]"
                />
                <span className={`text-[10px] ${completed ? 'text-[#8B8B8B] line-through' : 'text-[#333]'}`}>
                  {item.label}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
