'use client';

import { Check, CircleDot } from 'lucide-react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatCandidateDate } from '../../../../../lib/candidate-format';
import { candidatePhase, collapseToPhases, phaseText } from './candidate-phase';
import { EvalLoadError } from './eval-load-error';
import { EVAL_STEP_MARKER_CLASSES, EVAL_STEP_MARKER_STATES } from './eval-control-styles';
import { EVAL_CAPTION_CLASSES, EVAL_EYEBROW_CLASSES, EVAL_HINT_CLASSES, EVAL_SKELETON_CLASSES } from './eval-styles';

// The stage history in the TIMS evaluation design: a block under a hairline inside the application's panel, an
// uppercase eyebrow, then a PCA StepList (rows 48px, divider between them, a 28px marker). The newest phase is the
// current one (accent marker, semibold); the earlier ones are behind it (soft marker with a check). Constants only.
const BLOCK = 'mt-4 border-t border-eval-divider pt-4';
const TITLE = `${EVAL_EYEBROW_CLASSES} mb-1`;
const LIST = 'm-0 list-none p-0';
const ROW = 'flex min-h-12 items-center gap-3 border-b border-eval-divider py-2.5 last:border-b-0';
const MARKER_NOW = `${EVAL_STEP_MARKER_CLASSES} bg-eval-accent-tint text-eval-accent`;
const MARKER_PAST = `${EVAL_STEP_MARKER_CLASSES} ${EVAL_STEP_MARKER_STATES.todo}`;
const ROW_TEXT = 'flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3';
const LABEL_NOW = 'min-w-0 text-eval-base font-semibold break-words text-eval-ink';
const LABEL_PAST = 'min-w-0 text-eval-base break-words text-eval-ink';
const DATE = `${EVAL_CAPTION_CLASSES} shrink-0 tabular-nums`;
const EMPTY = `${EVAL_HINT_CLASSES} mt-4`;
/** The loading rows: a marker-shaped block and a line, twice. */
const SKELETON_ROW = 'flex min-h-12 items-center gap-3';
const SKELETON_MARKER = `${EVAL_SKELETON_CLASSES} size-7 shrink-0`;
const SKELETON_LINE_LONG = `${EVAL_SKELETON_CLASSES} h-3 w-1/2`;
const SKELETON_LINE_SHORT = `${EVAL_SKELETON_CLASSES} h-3 w-1/3`;

// Stage timeline for ONE of the candidate's own applications (Wave 1 Slice 2).
// Lazily mounted when a row is expanded, so the detail query only fires on demand.
// Reads candidatePortal.applicationStatus, which is scoped server-side to this
// candidate (IDOR-safe) — the applicationId alone cannot reach another candidate.
// Shows candidate-facing phases (candidate-phase.ts), not the internal stage names: consecutive moves
// within one phase collapse into a single entry dated by the first of them.
export function DashboardApplicationTimeline({
  orgSlug,
  applicationId,
  timeZone = null,
}: {
  orgSlug: string;
  applicationId: string;
  timeZone?: string | null;
}) {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, refetch } = trpc.candidatePortal.applicationStatus.useQuery({
    orgSlug,
    applicationId,
  });

  if (isLoading) {
    return (
      <div className={BLOCK} aria-busy="true">
        <span className="sr-only">{t.portalDashboard.timelineLoading}</span>
        <div aria-hidden="true" className={SKELETON_ROW}>
          <div className={SKELETON_MARKER} />
          <div className={SKELETON_LINE_SHORT} />
        </div>
        <div aria-hidden="true" className={SKELETON_ROW}>
          <div className={SKELETON_MARKER} />
          <div className={SKELETON_LINE_LONG} />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className={BLOCK}>
        <EvalLoadError title={t.portalDashboard.timelineError} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (data.movements.length === 0) {
    return <p className={EMPTY}>{t.portalDashboard.timelineEmpty}</p>;
  }

  // The API returns moves newest-first. Collapse oldest-first (each phase is dated by when it began),
  // then show the phases newest-first again.
  const oldestFirst = [...data.movements].sort((a, b) => new Date(a.movedAt).getTime() - new Date(b.movedAt).getTime());
  // Only the latest move reflects the application's status (hired / closed); earlier ones were steps.
  const latest = oldestFirst[oldestFirst.length - 1];
  const phases = collapseToPhases(oldestFirst, (m) =>
    candidatePhase(m.toStage.name, m === latest ? data.status : 'active'),
  ).reverse();

  return (
    <div className={BLOCK}>
      <p className={TITLE}>{t.portalDashboard.timelineTitle}</p>
      <ol className={LIST}>
        {phases.map(({ phase, item: m }, i) => {
          const isCurrent = i === 0;
          return (
            <li key={`${m.movedAt}-${i}`} className={ROW}>
              <span aria-hidden="true" className={isCurrent ? MARKER_NOW : MARKER_PAST}>
                {isCurrent ? <CircleDot /> : <Check strokeWidth={2.5} />}
              </span>
              <div className={ROW_TEXT}>
                <span className={isCurrent ? LABEL_NOW : LABEL_PAST}>{phaseText(phase, t.portalDashboard).label}</span>
                <span className={DATE}>{formatCandidateDate(m.movedAt, locale, timeZone)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
