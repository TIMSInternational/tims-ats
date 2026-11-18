'use client';

import Link from 'next/link';
import { Button, CandidateAvatar, StatusBadge } from '../../../../components';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { getPipelineFit } from '../../../../lib/pipeline-fit';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';
import { daysInStageLabel } from '../../../../lib/pipeline-days';
import { formatDate } from '../../../../lib/format-utils';
import { isActionableApplication, isOverdueInStage, stageOverdueCount, type ScheduleRequest } from './pipeline-actions';
import { applicationStatusMap } from './pipeline-status';
import { RejectionBadge } from './rejection-badge';
import { PipelineFitChip } from './pipeline-fit-chip';
import { PipelineStageHeader } from './pipeline-stage-header';

interface PipelineListViewProps {
  stages: PipelineStageWithApps[];
  onMove: (applicationId: string, toStageId: string) => void;
  /** Opens the reject modal for one application. Omitted when the user lacks pipeline:update. */
  onReject?: (applicationId: string, candidateName: string) => void;
  /** Opens the prefilled schedule form (A-10). Omitted when the user lacks interview:create. */
  onSchedule?: (request: ScheduleRequest) => void;
}

// Below md the actions are a two-column grid of full-width, 44px buttons (accessibility.md › Mobility).
const ACTION_CLS = 'max-md:w-full max-md:min-h-11';
const FACT_LABEL = 'mr-1 text-caption text-muted';

/**
 * The list view (the default on phones). Below md each row stacks — name, then the facts, then the actions —
 * instead of a fixed ~510 px row that pushed "Avanzar" and "Rechazar" off a 390 px screen (A-22). The page
 * shows an empty state when no stage has candidates.
 */
export function PipelineListView({ stages, onMove, onReject, onSchedule }: PipelineListViewProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const statusMap = applicationStatusMap(p.applicationStatus);
  return (
    <div className="space-y-4 overflow-y-auto h-full pb-4">
      {stages.map((stage, stageIdx) => {
        if (stage.applications.length === 0) return null;
        const headingId = `list-stage-${stage.id}`;
        return (
          <section
            key={stage.id}
            aria-labelledby={headingId}
            className="bg-white rounded-xl shadow-card overflow-hidden"
          >
            <PipelineStageHeader
              headingId={headingId}
              name={stage.name}
              index={stageIdx}
              shown={stage.applications.length}
              total={stage.count}
              slaHours={stage.slaHours}
              overdueCount={stageOverdueCount(stage)}
              className="border-b border-border px-1"
            />

            {/* Candidates in this stage */}
            <div className="divide-y divide-border">
              {stage.applications.map((app) => {
                const c = app.candidate;
                const name = `${c.firstName} ${c.lastName}`;
                const fit = getPipelineFit(app.candidate);
                const actionable = isActionableApplication(app);
                const isOverdue = isOverdueInStage(app, stage.slaHours);
                const nextStage = stages[stageIdx + 1];

                return (
                  <div
                    key={app.id}
                    className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4 px-4 py-3 hover:bg-surface-hover transition-colors"
                  >
                    {/* Avatar + Name */}
                    <div className="flex items-center gap-2.5 min-w-0 md:w-55 md:shrink-0">
                      <CandidateAvatar
                        firstName={c.firstName}
                        lastName={c.lastName}
                        avatar={c.avatar}
                        size="sm"
                        decorative
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/recruitment/candidates/${c.id}`}
                          className="text-body font-medium text-primary truncate block hover:underline"
                        >
                          {name}
                        </Link>
                        {c.currentTitle && <p className="text-callout text-secondary truncate">{c.currentTitle}</p>}
                      </div>
                    </div>

                    {/* Facts, each with its own label (no column headings here): one wrapping line on phones */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:flex-nowrap">
                      {/* Only persisted FIT results may be presented as scores. */}
                      <div className="flex items-center md:w-36 md:shrink-0">
                        {fit && (
                          <span aria-hidden="true" className={FACT_LABEL}>
                            {p.factFit}
                          </span>
                        )}
                        <PipelineFitChip score={fit?.score ?? null} isPartial={fit?.isPartial} />
                      </div>
                      <div className="min-w-0 md:w-36 md:shrink-0 whitespace-nowrap truncate">
                        <span className={FACT_LABEL}>{p.factSource}</span>
                        <span className="text-caption text-secondary">
                          {candidateSourceLabel(app.source, t.candidates)}
                        </span>
                      </div>
                      {actionable && (
                        <div className="flex flex-wrap items-center gap-1.5 md:w-44 md:shrink-0">
                          <span
                            title={p.appliedOnTitle.replace('{date}', formatDate(app.appliedAt))}
                            className="text-caption text-secondary"
                          >
                            {daysInStageLabel(app.enteredStageAt, p)}
                          </span>
                          {isOverdue && <StatusBadge tone="danger">{p.slaOverdueChip}</StatusBadge>}
                        </div>
                      )}
                      <div className="md:w-28 md:shrink-0">
                        {app.status === 'rejected' ? (
                          <RejectionBadge rejectedAt={app.rejectedAt} rejectedReason={app.rejectedReason} showReason />
                        ) : (
                          <StatusBadge status={app.status} map={statusMap} />
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:ml-auto">
                      {actionable && nextStage && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className={ACTION_CLS}
                          onClick={() => onMove(app.id, nextStage.id)}
                        >
                          {formatMessage(p.moveToStageNamed, { stage: nextStage.name })}
                        </Button>
                      )}
                      {actionable && onSchedule && (
                        <Button
                          variant="tertiary"
                          size="sm"
                          className={ACTION_CLS}
                          onClick={() => onSchedule({ applicationId: app.id, candidateId: c.id, candidateName: name })}
                          aria-label={p.scheduleInterviewFor.replace('{name}', name)}
                        >
                          {p.scheduleShort}
                        </Button>
                      )}
                      <Button
                        href={`/recruitment/candidates/${c.id}`}
                        variant="tertiary"
                        size="sm"
                        className={ACTION_CLS}
                      >
                        {p.viewProfile}
                      </Button>
                      {actionable && onReject && (
                        <Button
                          variant="destructive-secondary"
                          size="sm"
                          className={ACTION_CLS}
                          onClick={() => onReject(app.id, name)}
                          aria-label={t.rejectCandidateModal.actionLabel.replace('{name}', name)}
                        >
                          {p.reject}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
