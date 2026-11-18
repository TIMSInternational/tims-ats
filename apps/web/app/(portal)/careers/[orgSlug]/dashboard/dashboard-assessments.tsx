'use client';

import type { ReactNode } from 'react';
import { Ban, Check, Clock, Hourglass, Play } from 'lucide-react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import {
  DASHBOARD_CARD,
  DASHBOARD_EMPTY,
  DASHBOARD_ITEM,
  DASHBOARD_ITEM_HEAD,
  DASHBOARD_ITEM_META,
  DASHBOARD_ITEM_TITLE,
  DASHBOARD_LIST,
  DASHBOARD_TITLE,
} from './dashboard-styles';
import { EvalButton } from './eval-button';
import { EvalChip } from './eval-chip';
import type { EvalChipTone } from './eval-control-styles';
import { EvalLoadError } from './eval-load-error';
import { EVAL_LEAD_CLASSES, EVAL_SKELETON_CLASSES } from './eval-styles';

const ACTIVE_STATUSES = new Set(['assigned', 'in_progress']);

/** The status chip (PCA Chip, word + icon): waiting on the candidate is warn, done is ok, expired is danger. */
type ChipState = 'assigned' | 'in_progress' | 'completed' | 'expired' | 'other';
const CHIP_TONE: Record<ChipState, EvalChipTone> = {
  assigned: 'warn',
  in_progress: 'warn',
  completed: 'ok',
  expired: 'danger',
  other: 'neutral',
};
const CHIP_ICON: Record<ChipState, ReactNode> = {
  assigned: <Play aria-hidden="true" />,
  in_progress: <Hourglass aria-hidden="true" />,
  completed: <Check aria-hidden="true" strokeWidth={2.5} />,
  expired: <Clock aria-hidden="true" />,
  other: <Ban aria-hidden="true" />,
};
function chipState(status: string, expired: boolean): ChipState {
  if (expired) return 'expired';
  return status === 'assigned' || status === 'in_progress' || status === 'completed' ? status : 'other';
}

// The section in the TIMS evaluation design: a block under the PCA divider with its serif title; each assignment a PCA
// bordered panel (title3, a caption, the chip, the result line, the action as a PCA button).
const RESULT_CLASSES = `${EVAL_LEAD_CLASSES} mt-3`;
const ACTION_CLASSES = 'mt-4';
/** The loading placeholder: soft PCA blocks in the shape of one panel (the name, the duration, the chip). */
const SKELETON_PANEL_CLASSES = `${DASHBOARD_ITEM} flex items-start justify-between gap-3`;
const SKELETON_TEXT_CLASSES = 'flex-1 space-y-2';
const SKELETON_TITLE_CLASSES = `${EVAL_SKELETON_CLASSES} h-[18px] w-1/3`;
const SKELETON_LINE_CLASSES = `${EVAL_SKELETON_CLASSES} h-3 w-1/5`;
const SKELETON_CHIP_CLASSES = 'h-7 w-24 shrink-0 animate-pulse rounded-full bg-eval-bg3 motion-reduce:animate-none';

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

// "My Assessments" section of the candidate dashboard (Wave 1.5a Slice 4). Lists
// the signed-in candidate's assessment assignments and links a startable one into
// the Slice 3 player. Data comes from candidatePortal.getMyAssessments, scoped
// server-side to this candidate; orgSlug is the only input.
// `hideWhenEmpty`: the TIMS "Online assessments" section is on, so an empty list of the company's own quizzes is noise
// above it (the candidate saw "no assessments yet" right over four TIMS tests).
export function DashboardAssessments({ orgSlug, hideWhenEmpty = false }: { orgSlug: string; hideWhenEmpty?: boolean }) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug });

  const header = (
    <h2 id="native-assessments-heading" className={DASHBOARD_TITLE}>
      {t.portalDashboard.assessments}
    </h2>
  );

  if (isLoading) {
    if (hideWhenEmpty) return null;
    return (
      <section aria-labelledby="native-assessments-heading" aria-busy="true" className={DASHBOARD_CARD}>
        {header}
        <span className="sr-only">{t.portalDashboard.assessLoading}</span>
        <div aria-hidden="true" className={SKELETON_PANEL_CLASSES}>
          <div className={SKELETON_TEXT_CLASSES}>
            <div className={SKELETON_TITLE_CLASSES} />
            <div className={SKELETON_LINE_CLASSES} />
          </div>
          <div className={SKELETON_CHIP_CLASSES} />
        </div>
      </section>
    );
  }
  if (isError) {
    return (
      <section aria-labelledby="native-assessments-heading" className={DASHBOARD_CARD}>
        {header}
        <EvalLoadError title={t.portalDashboard.assessError} onRetry={() => void refetch()} />
      </section>
    );
  }

  const assignments = data ?? [];
  if (hideWhenEmpty && assignments.length === 0) return null;

  const statusLabel = (status: string, expired: boolean) => {
    if (expired) return t.portalDashboard.assessStatusExpired;
    switch (status) {
      case 'assigned':
        return t.portalDashboard.assessStatusAssigned;
      case 'in_progress':
        return t.portalDashboard.assessStatusInProgress;
      case 'completed':
        return t.portalDashboard.assessStatusCompleted;
      case 'cancelled':
        return t.portalDashboard.assessStatusCancelled;
      default:
        // Never show a raw status code: anything not started reads as "not started".
        return t.portalDashboard.assessStatusAssigned;
    }
  };

  return (
    <section aria-labelledby="native-assessments-heading" className={DASHBOARD_CARD}>
      {header}

      {assignments.length === 0 ? (
        <p className={DASHBOARD_EMPTY}>{t.portalDashboard.assessEmpty}</p>
      ) : (
        <ul className={DASHBOARD_LIST}>
          {assignments.map((assignment) => {
            const expired = ACTIVE_STATUSES.has(assignment.status) && isExpired(assignment.expiresAt);
            const active = ACTIVE_STATUSES.has(assignment.status) && !expired;
            const chip = chipState(assignment.status, expired);
            return (
              <li key={assignment.id} className={DASHBOARD_ITEM}>
                <div className={DASHBOARD_ITEM_HEAD}>
                  <div className="min-w-0">
                    <p className={DASHBOARD_ITEM_TITLE}>{assignment.assessmentType.name}</p>
                    {assignment.assessmentType.duration !== null && (
                      <p className={DASHBOARD_ITEM_META}>
                        {assignment.assessmentType.duration} {t.portalDashboard.assessMinutes}
                      </p>
                    )}
                  </div>
                  <EvalChip tone={CHIP_TONE[chip]} icon={CHIP_ICON[chip]}>
                    {statusLabel(assignment.status, expired)}
                  </EvalChip>
                </div>

                {assignment.status === 'completed' && (
                  <p className={RESULT_CLASSES}>
                    {assignment.result?.hasPending
                      ? t.portalDashboard.assessPendingNotice
                      : `${t.portalDashboard.assessScoreLabel}: ${assignment.result?.normalizedScore ?? '—'}`}
                  </p>
                )}

                {active && (
                  <EvalButton
                    href={`/careers/${orgSlug}/dashboard/assessments/${assignment.id}`}
                    width="bar"
                    className={ACTION_CLASSES}
                  >
                    {assignment.status === 'in_progress'
                      ? t.portalDashboard.assessContinue
                      : t.portalDashboard.assessStart}
                  </EvalButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
