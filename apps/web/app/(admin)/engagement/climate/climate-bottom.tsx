'use client';

import { useI18n } from '../../../../lib/i18n';
import { intlLocale } from '../../../../lib/format-utils';
import {
  useEngagementListActionPlans,
  useEngagementListLeaderCommitments,
} from '../../../../lib/platform-api/engagement';
import {
  CandidateAvatar,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from '../../../../components';

function statusMeta(t: ReturnType<typeof useI18n>['t'], status: string): { tone: StatusTone; label: string } {
  switch (status) {
    case 'in_progress':
      return { tone: 'info', label: t.climate.statusInProgress };
    case 'completed':
      return { tone: 'success', label: t.climate.statusCompleted };
    case 'fulfilled':
      return { tone: 'success', label: t.climate.statusFulfilled };
    case 'overdue':
      return { tone: 'danger', label: t.climate.statusOverdue };
    default:
      return { tone: 'neutral', label: t.climate.statusPending };
  }
}

function useFmtDate() {
  const { locale } = useI18n();
  return (d: string | Date | null | undefined): string => {
    if (!d) return '—';
    return new Intl.DateTimeFormat(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' }).format(
      new Date(d),
    );
  };
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

export function ActionPlans() {
  const { t } = useI18n();
  const fmtDate = useFmtDate();
  const q = useEngagementListActionPlans();

  return (
    <section
      aria-labelledby="climate-plans"
      className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5"
    >
      <h2 id="climate-plans" className="mb-3 text-heading font-semibold text-brand">
        {t.climate.actionPlans}
      </h2>
      {q.isLoading ? (
        <ListSkeleton label={t.common.loadingContent} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.climate.errPlans} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState size="compact" title={t.climate.noPlans} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-body">
            <thead>
              <tr className="border-b border-border text-callout text-secondary">
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.climate.colPlan}
                </th>
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.climate.colResponsible}
                </th>
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.climate.colArea}
                </th>
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.climate.colStatus}
                </th>
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.climate.colDue}
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => {
                const st = statusMeta(t, p.status);
                return (
                  <tr key={p.id} className="border-b border-border-subtle last:border-b-0">
                    <td className="py-2 pr-2 font-medium text-primary">{p.title}</td>
                    <td className="py-2 pr-2 text-secondary">
                      {p.responsible ? `${p.responsible.firstName} ${p.responsible.lastName}` : '—'}
                    </td>
                    <td className="py-2 pr-2 text-secondary">{p.area ?? t.climate.noArea}</td>
                    <td className="py-2 pr-2">
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    </td>
                    <td className="py-2 tabular-nums text-secondary">{fmtDate(p.dueDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function LeaderCommitments() {
  const { t } = useI18n();
  const fmtDate = useFmtDate();
  const q = useEngagementListLeaderCommitments();

  return (
    <section
      aria-labelledby="climate-commitments"
      className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5"
    >
      <h2 id="climate-commitments" className="mb-3 text-heading font-semibold text-brand">
        {t.climate.leaderCommitments}
      </h2>
      {q.isLoading ? (
        <ListSkeleton label={t.common.loadingContent} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.climate.errCommitments} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState size="compact" title={t.climate.noCommitments} />
      ) : (
        <ul className="space-y-2.5">
          {q.data.map((c) => {
            const st = statusMeta(t, c.status);
            return (
              <li key={c.id} className="flex items-start gap-3 rounded-lg bg-surface p-2.5">
                {c.leader ? (
                  <CandidateAvatar firstName={c.leader.firstName} lastName={c.leader.lastName} size="sm" decorative />
                ) : (
                  <span
                    className="size-8 shrink-0 rounded-full border border-dashed border-field-border"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-primary">
                    {c.leader ? `${c.leader.firstName} ${c.leader.lastName}` : '—'}
                  </p>
                  <p className="text-callout text-secondary">{c.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    <span className="text-callout tabular-nums text-secondary">{fmtDate(c.dueDate)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
