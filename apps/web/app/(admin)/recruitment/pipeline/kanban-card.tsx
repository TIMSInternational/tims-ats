'use client';

import Link from 'next/link';
import { CandidateAvatar, IconButton, Menu, StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { fitBand, getPipelineFit, type FitBand } from '../../../../lib/pipeline-fit';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';
import { daysInStageLabel } from '../../../../lib/pipeline-days';
import { formatDate } from '../../../../lib/format-utils';
import { RejectionBadge } from './rejection-badge';
import { PipelineFitChip } from './pipeline-fit-chip';
import { KanbanCardChecklist, coerceChecklist } from './kanban-card-checklist';
import { isOverdueInStage } from './pipeline-actions';

interface KanbanCardProps {
  application: {
    id: string;
    status: string;
    source: string;
    appliedAt: Date | string;
    enteredStageAt: Date | string;
    rejectedAt?: Date | string | null;
    rejectedReason?: string | null;
    // Prisma.JsonValue (read in KanbanCardChecklist) — only the
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
  /** False for a rejected or hired card (Rechazados / Todos views): it cannot be dragged. */
  actionable?: boolean;
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
  /** The other stages, for "Mover a…" (the same move as a drop). Omitted when the card cannot move. */
  moveTargets?: Array<{ id: string; name: string }>;
  onMoveTo?: (toStageId: string) => void;
}

// The FIT band also colours the card's leading edge: a redundant cue next to the chip's number and word.
const FIT_BORDER: Record<FitBand, string> = {
  high: 'border-l-success',
  medium: 'border-l-warning',
  low: 'border-l-danger',
};

const ICON_CLS = 'size-4';

export function KanbanCard({
  application: app,
  isDragging,
  actionable = app.status === 'active',
  slaHours,
  stageId,
  checklist,
  onToggleChecklistItem,
  onReject,
  onSchedule,
  moveTargets,
  onMoveTo,
}: KanbanCardProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const candidate = app.candidate;
  const candidateName = `${candidate.firstName} ${candidate.lastName}`;
  const fit = getPipelineFit(candidate);
  const fitScore = fit?.score ?? null;
  const isActive = app.status === 'active';
  // Days in the CURRENT stage (A-23) — the same clock as the SLA badge and the "Días en etapa" filter; the
  // application date stays in the tooltip.
  const inStage = daysInStageLabel(app.enteredStageAt, p);
  const appliedTitle = p.appliedOnTitle.replace('{date}', formatDate(app.appliedAt));
  const isOverdue = isOverdueInStage(app, slaHours);
  const checklistItems = coerceChecklist(checklist);
  const leadingEdge = fitScore === null ? 'border-l-border' : FIT_BORDER[fitBand(fitScore)];

  return (
    <div
      className={`bg-white rounded-lg p-3 border-l-4 transition-shadow ${
        actionable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
      } ${isDragging ? 'shadow-popover border-l-brand rotate-2 motion-reduce:rotate-0' : `shadow-card hover:shadow-md ${leadingEdge}`}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <CandidateAvatar
          firstName={candidate.firstName}
          lastName={candidate.lastName}
          avatar={candidate.avatar}
          size="sm"
          decorative
        />
        <div className="flex-1 min-w-0">
          <Link
            href={`/recruitment/candidates/${candidate.id}`}
            className="text-body font-medium text-primary truncate block hover:underline"
          >
            {candidateName}
          </Link>
          {candidate.currentTitle && <p className="text-callout text-secondary truncate">{candidate.currentTitle}</p>}
        </div>
        {/* The score is advisory: it opens the FIT detail on the profile, where its reasons are (ideal-110). */}
        <PipelineFitChip
          score={fitScore}
          isPartial={fit?.isPartial}
          compact
          href={fitScore === null ? undefined : `/recruitment/candidates/${candidate.id}?tab=tabFitGaps`}
          linkDescription={p.fitDetailLink.replace('{name}', candidateName)}
        />
      </div>

      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
        <span className="text-caption text-secondary">{candidateSourceLabel(app.source, t.candidates)}</span>
        {isActive ? (
          <span title={appliedTitle} className="text-caption text-secondary">
            {inStage}
          </span>
        ) : app.status === 'rejected' ? (
          <RejectionBadge rejectedAt={app.rejectedAt} rejectedReason={app.rejectedReason} />
        ) : (
          <StatusBadge tone={app.status === 'hired' ? 'success' : 'neutral'}>
            {p.applicationStatus[app.status as keyof typeof p.applicationStatus] ?? app.status}
          </StatusBadge>
        )}
        {isOverdue && <StatusBadge tone="danger">{p.slaOverdueChip}</StatusBadge>}
      </div>

      {(onSchedule || onReject || (moveTargets && moveTargets.length > 0 && onMoveTo)) && (
        // Buttons inside the drag handle: the dnd lib ignores drags that start on interactive elements, and
        // stopPropagation keeps a mouse press from arming one.
        <div className="mt-2 flex items-center justify-end gap-1" onMouseDown={(e) => e.stopPropagation()}>
          {moveTargets && moveTargets.length > 0 && onMoveTo && (
            <Menu
              label={formatMessage(p.moveToFor, { name: candidateName })}
              triggerClassName="inline-flex size-7 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface hover:text-primary pointer-coarse:size-11"
              trigger={
                <svg
                  className={ICON_CLS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              }
              items={moveTargets.map((target) => ({
                key: target.id,
                label: formatMessage(p.moveToStageNamed, { stage: target.name }),
                onSelect: () => onMoveTo(target.id),
              }))}
            />
          )}
          {onSchedule && (
            <IconButton
              size="sm"
              label={p.scheduleInterviewFor.replace('{name}', candidateName)}
              onClick={(e) => {
                e.stopPropagation();
                onSchedule();
              }}
            >
              <svg
                className={ICON_CLS}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </IconButton>
          )}
          {onReject && (
            <IconButton
              size="sm"
              label={t.rejectCandidateModal.actionLabel.replace('{name}', candidateName)}
              className="hover:bg-danger-bg hover:text-danger"
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
            >
              <svg
                className={ICON_CLS}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </IconButton>
          )}
        </div>
      )}

      {checklistItems.length > 0 && (
        <KanbanCardChecklist
          applicationId={app.id}
          stageId={stageId}
          items={checklistItems}
          progress={app.checklistProgress}
          disabled={!isActive}
          onToggle={onToggleChecklistItem}
        />
      )}
    </div>
  );
}
