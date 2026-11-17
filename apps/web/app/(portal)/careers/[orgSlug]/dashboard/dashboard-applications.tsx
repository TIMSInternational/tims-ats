'use client';

import { useState, type ReactNode } from 'react';
import {
  BadgeCheck,
  Check,
  ChevronDown,
  CircleSlash,
  Clock,
  FileSearch,
  FileText,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatCandidateDate } from '../../../../../lib/candidate-format';
import { DashboardApplicationTimeline } from './dashboard-application-timeline';
import { DashboardWithdrawApplication } from './dashboard-withdraw-application';
import { candidatePhase, phaseText, type CandidatePhase } from './candidate-phase';
import { EvalButton } from './eval-button';
import { EvalChip } from './eval-chip';
import { EvalLoadError } from './eval-load-error';
import type { EvalChipTone } from './eval-control-styles';
import { EVAL_ICON_TILE_CLASSES } from './eval-styles';
import { DashboardCardSkeleton } from './dashboard-card-skeleton';
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

// The panel's parts in the TIMS evaluation design (PCA): the title block, the current stage as the PCA receipt row
// (a soft icon tile beside a semibold line and its explanation), then the in-panel actions. Constants only.
const TITLE_BLOCK = 'min-w-0';
const APPLIED_LINE = `${DASHBOARD_ITEM_META} tabular-nums`;
const STAGE_ROW = 'mt-4 flex items-start gap-3';
const STAGE_TILE = `${EVAL_ICON_TILE_CLASSES} mt-px`;
const STAGE_TEXT = 'min-w-0 flex-1';
/** "Etapa actual: En revisión": the label in ink2, the stage in ink semibold. */
const STAGE_LINE = 'm-0 text-eval-base leading-[1.45] font-semibold break-words text-eval-ink';
const STAGE_LABEL = 'font-normal text-eval-ink2';
const STAGE_DESCRIPTION = 'm-0 mt-0.5 text-eval-sm leading-[1.5] text-eval-ink2';
const ACTIONS = 'mt-4 flex flex-wrap items-center gap-x-3 gap-y-2';
/** "View history" (a ghost text action): pulled left by its own padding so its words line up with the panel's text. */
const HISTORY_TOGGLE = '-ml-4 md:-ml-5';
/** The disclosure chevron of "View history": turns when the history is open. */
const CHEVRON_CLOSED = 'transition-transform motion-reduce:transition-none';
const CHEVRON_OPEN = `${CHEVRON_CLOSED} rotate-180`;

/** The candidate-facing phase's icon in the stage row (decorative: the words say it). */
const PHASE_ICON: Record<CandidatePhase, ReactNode> = {
  review: <FileSearch aria-hidden="true" />,
  interviews: <Users aria-hidden="true" />,
  offer: <FileText aria-hidden="true" />,
  hired: <BadgeCheck aria-hidden="true" />,
  closed: <CircleSlash aria-hidden="true" />,
};

/** The status chip's icon per application status (word + icon, never colour alone). */
const STATUS_ICON: Record<string, ReactNode> = {
  active: <Clock aria-hidden="true" />,
  rejected: <X aria-hidden="true" strokeWidth={2.5} />,
  hired: <Check aria-hidden="true" strokeWidth={2.5} />,
  withdrawn: <Undo2 aria-hidden="true" />,
};

// "My Applications" section of the candidate dashboard (Wave 1 Slice 2). Lists the
// signed-in candidate's applications at this org with status + current stage, and
// expands each into its stage timeline. Data comes from candidatePortal.* which
// resolves the candidate from the Supabase session — the orgSlug is the only input.
// Dates render in the organization's time zone (UTC when it has none), never the device's locale.
// An application still in process offers "Retirar mi postulación" (audit C-33).
export function DashboardApplications({
  orgSlug,
  orgName = '',
  timeZone = null,
}: {
  orgSlug: string;
  orgName?: string;
  timeZone?: string | null;
}) {
  const { t, locale } = useI18n();
  const pd = t.portalDashboard;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = trpc.candidatePortal.myApplications.useQuery({ orgSlug });

  // Map the raw application status to a localized label and a PCA chip tone. Unknown statuses fall back to the raw
  // value (neutral) rather than rendering a blank pill. In process waits on the team (neutral); a rejection and a
  // withdrawal end the application (danger, with their own icon); a hire is done (ok).
  const status = (s: string): { label: string; tone: EvalChipTone } => {
    switch (s) {
      case 'active':
        return { label: pd.statusActive, tone: 'neutral' };
      case 'rejected':
        return { label: pd.statusRejected, tone: 'danger' };
      case 'hired':
        return { label: pd.statusHired, tone: 'ok' };
      // Withdrawing is the candidate's own choice: neutral, not the red of a rejection.
      case 'withdrawn':
        return { label: pd.statusWithdrawn, tone: 'neutral' };
      default:
        return { label: s, tone: 'neutral' };
    }
  };

  const applications = data ?? [];

  return (
    <section aria-labelledby="dashboard-applications-title" className={DASHBOARD_CARD}>
      <h2 id="dashboard-applications-title" className={DASHBOARD_TITLE}>
        {pd.applications}
      </h2>

      {isLoading ? (
        <DashboardCardSkeleton label={pd.listLoading} />
      ) : isError ? (
        <EvalLoadError title={pd.listError} onRetry={() => void refetch()} />
      ) : applications.length === 0 ? (
        <p className={DASHBOARD_EMPTY}>{pd.listEmpty}</p>
      ) : (
        <ul className={DASHBOARD_LIST}>
          {applications.map((app) => {
            const isOpen = expandedId === app.id;
            const phaseKey = candidatePhase(app.currentStage?.name, app.status);
            const phase = phaseText(phaseKey, pd);
            const chip = status(app.status);
            return (
              <li key={app.id} className={DASHBOARD_ITEM}>
                <div className={DASHBOARD_ITEM_HEAD}>
                  <div className={TITLE_BLOCK}>
                    <h3 className={DASHBOARD_ITEM_TITLE}>{app.vacancy.title}</h3>
                    {app.vacancy.company?.name && <p className={DASHBOARD_ITEM_META}>{app.vacancy.company.name}</p>}
                    <p className={APPLIED_LINE}>
                      {pd.appliedOn} {formatCandidateDate(app.appliedAt, locale, timeZone)}
                    </p>
                  </div>
                  <EvalChip tone={chip.tone} icon={STATUS_ICON[app.status]}>
                    {chip.label}
                  </EvalChip>
                </div>

                <div className={STAGE_ROW}>
                  <span aria-hidden="true" className={STAGE_TILE}>
                    {PHASE_ICON[phaseKey]}
                  </span>
                  <div className={STAGE_TEXT}>
                    <p className={STAGE_LINE}>
                      <span className={STAGE_LABEL}>{pd.currentStage}: </span>
                      {phase.label}
                    </p>
                    <p className={STAGE_DESCRIPTION}>{phase.description}</p>
                  </div>
                </div>

                <div className={ACTIONS}>
                  <EvalButton
                    variant="ghost"
                    onClick={() => setExpandedId(isOpen ? null : app.id)}
                    aria-expanded={isOpen}
                    className={HISTORY_TOGGLE}
                    trailingIcon={<ChevronDown aria-hidden="true" className={isOpen ? CHEVRON_OPEN : CHEVRON_CLOSED} />}
                  >
                    {isOpen ? pd.hideTimeline : pd.viewTimeline}
                  </EvalButton>
                  {app.status === 'active' && (
                    <DashboardWithdrawApplication
                      orgSlug={orgSlug}
                      orgName={orgName}
                      applicationId={app.id}
                      vacancyTitle={app.vacancy.title}
                    />
                  )}
                </div>

                {isOpen && (
                  <DashboardApplicationTimeline orgSlug={orgSlug} applicationId={app.id} timeZone={timeZone} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
