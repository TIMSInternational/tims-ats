'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { CountBadge, EmptyState, ErrorState, Skeleton, StatusBadge } from '../../../../components';
import type { LowProgressOkr, OverdueCommitment } from '../../../../lib/trpc-types';
import {
  getOkrProgressSeverity,
  getCommitmentSeverity,
  getDaysOverdue,
  type AlertSeverity,
} from '../../../../lib/low-progress-alerts-helpers';

// Severity is a word + icon chip (dark text on a tint, ≥ 4.8:1), never white on amber.
const SEV_META: Record<AlertSeverity, { tone: 'danger' | 'warning'; border: string }> = {
  critical: { tone: 'danger', border: 'border-danger/30' },
  warning: { tone: 'warning', border: 'border-warning/30' },
};

const ALERT_ROW =
  'w-full rounded-lg border bg-white p-3 text-left transition-colors duration-150 hover:bg-surface-hover pointer-coarse:min-h-11';

const THRESHOLD_OPTIONS = [10, 20, 30, 50] as const;

interface LowProgressAlertsPanelProps {
  /** No OKR detail route exists in this app today (verified — see Sprint 1.4 Task 2 report).
   * The closest real navigation target is this same page's "OKRs" tab, so a row click
   * switches the parent's active tab there instead of linking to a fabricated route. */
  onSelectOkr?: () => void;
  /** Same caveat as `onSelectOkr` — routes to the "Coaching" tab, where commitments live. */
  onSelectCommitment?: () => void;
}

export function LowProgressAlertsPanel({ onSelectOkr, onSelectCommitment }: LowProgressAlertsPanelProps) {
  const { t } = useI18n();
  const [threshold, setThreshold] = useState<number>(30);
  const q = trpc.performance.getLowProgressAlerts.useQuery({ threshold });

  const lowOkrs = q.data?.lowProgressOkrs ?? [];
  const overdueCommitments = q.data?.overdueCommitments ?? [];
  const total = q.data?.totalAlerts ?? 0;

  return (
    <section className="rounded-xl border border-border bg-white shadow-card" aria-labelledby="low-progress-heading">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-5">
        <div className="flex items-center gap-2">
          <svg className="size-4 text-brand" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <h2 id="low-progress-heading" className="text-subheading font-semibold text-primary">
            {t.performance.lowProgressAlertsTitle}
          </h2>
          {total > 0 && <CountBadge count={total} tone="attention" />}
        </div>
        <label className="flex items-center gap-2 text-callout text-secondary">
          {t.performance.lowProgressThresholdLabel}
          <select
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="h-8 rounded-lg border border-field-border bg-white px-2 text-callout text-primary pointer-coarse:h-11"
          >
            {THRESHOLD_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {formatMessage(t.performance.thresholdOption, { n: opt })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading ? (
        <div className="space-y-2 p-4" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : q.isError ? (
        <ErrorState
          size="compact"
          title={t.performance.lowProgressAlertsErr}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : total === 0 ? (
        <EmptyState size="compact" title={t.performance.lowProgressAlertsEmpty} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
          <OkrAlertList okrs={lowOkrs} threshold={threshold} onSelect={onSelectOkr} />
          <CommitmentAlertList commitments={overdueCommitments} onSelect={onSelectCommitment} />
        </div>
      )}
    </section>
  );
}

function OkrAlertList({
  okrs,
  threshold,
  onSelect,
}: {
  okrs: LowProgressOkr[];
  threshold: number;
  onSelect?: () => void;
}) {
  const { t } = useI18n();
  if (okrs.length === 0) {
    return <p className="px-1 py-2 text-callout text-secondary">{t.performance.lowProgressNoOkrs}</p>;
  }
  return (
    <div className="space-y-2">
      <h3 className="px-1 text-callout font-semibold text-secondary">
        {t.performance.lowProgressOkrsHeading}
      </h3>
      {okrs.map((okr) => {
        const sev = getOkrProgressSeverity(okr.progress, threshold);
        const meta = SEV_META[sev];
        const name = okr.user ? `${okr.user.firstName} ${okr.user.lastName}` : t.performance.unknownPerson;
        return (
          <button
            key={okr.id}
            type="button"
            onClick={onSelect}
            className={`${ALERT_ROW} ${meta.border}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge tone={meta.tone}>
                {sev === 'critical' ? t.performance.severityCritical : t.performance.severityWarning}
              </StatusBadge>
              {okr.team && (
                <StatusBadge tone="brand" icon="none">
                  {okr.team.name}
                </StatusBadge>
              )}
            </div>
            <p className="text-body font-medium text-primary">{okr.title}</p>
            <p className="mt-0.5 text-callout text-secondary">
              {name} &middot; <span className="tabular-nums">{okr.progress} %</span>
            </p>
          </button>
        );
      })}
    </div>
  );
}

function CommitmentAlertList({
  commitments,
  onSelect,
}: {
  commitments: OverdueCommitment[];
  onSelect?: () => void;
}) {
  const { t } = useI18n();
  if (commitments.length === 0) {
    return <p className="px-1 py-2 text-callout text-secondary">{t.performance.lowProgressNoCommitments}</p>;
  }
  return (
    <div className="space-y-2">
      <h3 className="px-1 text-callout font-semibold text-secondary">
        {t.performance.lowProgressCommitmentsHeading}
      </h3>
      {commitments.map((c) => {
        const sev = getCommitmentSeverity(c.dueDate);
        const meta = SEV_META[sev];
        const days = getDaysOverdue(c.dueDate);
        const name = c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : t.performance.unknownPerson;
        return (
          <button
            key={c.id}
            type="button"
            onClick={onSelect}
            className={`${ALERT_ROW} ${meta.border}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge tone={meta.tone}>
                {sev === 'critical' ? t.performance.severityCritical : t.performance.severityWarning}
              </StatusBadge>
            </div>
            <p className="text-body font-medium text-primary">{c.description}</p>
            <p className="mt-0.5 text-callout text-secondary">
              {name} &middot; {formatMessage(t.performance.lowProgressDaysOverdue, { n: days })}
            </p>
          </button>
        );
      })}
    </div>
  );
}
