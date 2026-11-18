'use client';

import { Button, EmptyState, ErrorState, Skeleton, StatusBadge, type StatusMapEntry } from '../../../../components';
import { useI18n, pluralize } from '../../../../lib/i18n';

export interface CalibrationSessionSummary {
  id: string;
  period: string;
  status: string;
  _count: { members: number };
}

interface CalibrationSessionsListProps {
  sessions: CalibrationSessionSummary[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onManage: (id: string) => void;
}

/** The period's calibration sessions, each with its committee size and "Gestionar comité". */
export function CalibrationSessionsList({
  sessions,
  isLoading,
  error,
  onRetry,
  onManage,
}: CalibrationSessionsListProps) {
  const { t, locale } = useI18n();
  const statusMap: Record<string, StatusMapEntry> = {
    draft: { tone: 'neutral', label: t.committee.statusDraft },
    active: { tone: 'success', label: t.committee.statusActive },
    finalized: { tone: 'info', label: t.committee.statusFinalized },
  };

  return (
    <section aria-labelledby="nine-box-sessions" className="rounded-xl border border-border bg-white p-4 shadow-card">
      <h2 id="nine-box-sessions" className="mb-2 text-heading font-semibold text-brand">
        {t.committee.sessionsTitle}
      </h2>
      {isLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ) : error ? (
        <ErrorState size="compact" error={error} onRetry={onRetry} />
      ) : sessions.length === 0 ? (
        <EmptyState size="compact" title={t.committee.noSessions} />
      ) : (
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <StatusBadge status={s.status} map={statusMap} />
              <span className="flex-1 text-body font-medium text-primary">{s.period}</span>
              <span className="shrink-0 text-callout text-secondary">
                {pluralize(s._count.members, t.nineBox.sessionMembers, locale)}
              </span>
              <Button variant="secondary" size="sm" onClick={() => onManage(s.id)}>
                {t.committee.manage}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
