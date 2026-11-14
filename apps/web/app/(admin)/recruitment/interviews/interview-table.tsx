'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { DataTable, EmptyState, ErrorState, StatusBadge, CandidateAvatar, UpsellNotice } from '../../../../components';
import type { StatusMapEntry } from '../../../../components/status-badge';
import type { InterviewListItem } from '../../../../lib/trpc-types';
import { isPilotScope } from '../../../../lib/launch-scope';
import { interviewTypeLabel } from './[id]/room/interview-type-label';
import { displayInterviewStatus } from './interview-status';
import { InterviewTypeIcon } from './interview-type-icon';
import { EvaluatorStack } from './evaluator-stack';
import { InterviewRowActions, type InterviewRowHandlers } from './interview-row-actions';

interface InterviewTableProps extends InterviewRowHandlers {
  interviews: InterviewListItem[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** False when the viewer has no candidate:read: the name is plain text, not a link to "Acceso denegado". */
  canViewCandidate?: boolean;
  /** Server-side paging of the current list (upcoming or past). */
  pagination?: { page: number; total: number; limit: number; onPageChange: (page: number) => void };
  /** The empty state's "Agendar entrevista" action; omitted for viewers who may not schedule. */
  onSchedule?: () => void;
}

type Translations = ReturnType<typeof useI18n>['t'];

/** Status tones (foundation-spec.md §12): every chip passes 4.5:1 and outcome tones carry an icon. */
function statusMap(t: Translations): Record<string, StatusMapEntry> {
  return {
    scheduled: { tone: 'info', label: t.interviews.statusScheduled },
    in_progress: { tone: 'warning', label: t.interviews.statusInProgress },
    awaiting_scorecard: { tone: 'warning', label: t.interviews.statusAwaitingScorecard },
    completed: { tone: 'success', label: t.interviews.statusCompleted },
    cancelled: { tone: 'neutral', label: t.interviews.statusCancelled },
    no_show: { tone: 'danger', label: t.interviews.statusNoShow },
    rescheduled: { tone: 'brand', label: t.interviews.statusRescheduled },
  };
}

function timeLabel(iv: InterviewListItem, locale: 'ES' | 'EN', t: Translations): string {
  const at = new Date(iv.scheduledAt);
  const tag = locale === 'EN' ? 'en-US' : 'es-CR';
  const date = at.toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = at.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time} · ${iv.duration} ${t.interviews.minutes}`;
}

export function InterviewTable(props: InterviewTableProps) {
  const { interviews, isLoading, isError, onRetry, canViewCandidate = true, pagination, onSchedule } = props;
  const { t, locale } = useI18n();
  const now = new Date();
  // The AI voice screen is not part of the pilot: no sales upsell on every row (F-9).
  const showAiUpsell = !isPilotScope() && !props.aiScreenEnabled && !props.aiScreenError;
  const map = statusMap(t);

  if (isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  const columns = [
    { key: 'candidate', label: t.interviews.colCandidate },
    { key: 'vacancy', label: t.interviews.colVacancy },
    { key: 'type', label: t.interviews.colType },
    { key: 'date', label: t.interviews.colDate },
    { key: 'evaluators', label: t.interviews.colEvaluators },
    { key: 'status', label: t.interviews.colStatus },
    { key: 'actions', label: t.interviews.colActions, align: 'right' as const },
  ];

  const candidateName = (iv: InterviewListItem) => {
    const name = `${iv.candidate.firstName} ${iv.candidate.lastName}`;
    return canViewCandidate ? (
      <Link
        href={`/recruitment/candidates/${iv.candidate.id}`}
        className="text-body font-medium text-primary hover:underline"
      >
        {name}
      </Link>
    ) : (
      <span className="text-body font-medium text-primary">{name}</span>
    );
  };

  // Phones: a stacked list instead of the seven-column table (foundation-spec.md §7, layout.md › Size classes).
  const mobileList = interviews.map((iv) => (
    <div key={iv.id} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {candidateName(iv)}
          <p className="truncate text-callout text-secondary">{iv.vacancy.title}</p>
        </div>
        <StatusBadge status={displayInterviewStatus(iv, now)} map={map} />
      </div>
      <p className="flex items-center gap-1.5 text-callout text-secondary tabular-nums">
        <InterviewTypeIcon type={iv.type} />
        {interviewTypeLabel(t, iv.type)} · {timeLabel(iv, locale, t)}
      </p>
      {showAiUpsell && <UpsellNotice message={t.entitlements.notIncluded} ctaLabel={t.entitlements.contactSales} />}
      <InterviewRowActions {...props} iv={iv} now={now} fullWidth />
    </div>
  ));

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      skeletonRows={8}
      pagination={pagination}
      label={t.interviews.title}
      mobileList={interviews.length > 0 ? mobileList : undefined}
      empty={
        <EmptyState
          icon={
            <svg
              className="size-8 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          }
          title={t.interviews.noInterviews}
          description={t.interviews.noInterviewsDesc}
          action={
            onSchedule ? { label: t.interviews.scheduleNew, onClick: onSchedule, variant: 'secondary' } : undefined
          }
        />
      }
    >
      {interviews.map((iv) => (
        <tr key={iv.id} className="border-b border-border transition-colors hover:bg-surface-hover">
          <td className="px-4 py-3">
            <div className="flex items-center gap-2.5">
              <CandidateAvatar
                firstName={iv.candidate.firstName}
                lastName={iv.candidate.lastName}
                avatar={iv.candidate.avatar}
                size="sm"
                decorative
              />
              <div className="min-w-0">
                {candidateName(iv)}
                <p className="text-caption text-muted">{iv.candidate.email}</p>
              </div>
            </div>
          </td>
          <td className="px-4 py-3">
            <span className="text-callout text-secondary">{iv.vacancy.title}</span>
          </td>
          <td className="px-4 py-3">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-surface px-2 py-0.5 text-caption font-medium text-secondary">
              <InterviewTypeIcon type={iv.type} />
              {interviewTypeLabel(t, iv.type)}
            </span>
          </td>
          <td className="px-4 py-3 whitespace-nowrap tabular-nums">
            <p className="text-callout text-primary">
              {new Date(iv.scheduledAt).toLocaleDateString(locale === 'EN' ? 'en-US' : 'es-CR', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
            <p className="text-caption text-muted">
              {new Date(iv.scheduledAt).toLocaleTimeString(locale === 'EN' ? 'en-US' : 'es-CR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {' · '}
              {iv.duration} {t.interviews.minutes}
            </p>
          </td>
          <td className="px-4 py-3">
            <EvaluatorStack evaluators={iv.evaluators} />
          </td>
          <td className="px-4 py-3">
            <StatusBadge status={displayInterviewStatus(iv, now)} map={map} />
          </td>
          <td className="px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-2">
              {showAiUpsell && (
                <UpsellNotice message={t.entitlements.notIncluded} ctaLabel={t.entitlements.contactSales} />
              )}
              <InterviewRowActions {...props} iv={iv} now={now} />
            </div>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
