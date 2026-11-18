'use client';

import { useMemo } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../../components';
import { pluralize } from '../../../../lib/i18n/format';
import type { InterviewListItem } from '../../../../lib/trpc-types';
import { interviewTypeLabel } from './[id]/room/interview-type-label';
import { InterviewTypeIcon } from './interview-type-icon';
import { EvaluatorStack } from './evaluator-stack';

interface UpcomingPanelProps {
  interviews: InterviewListItem[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

function isTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();
}

function getDayLabel(date: Date, t: ReturnType<typeof useI18n>['t'], locale: 'ES' | 'EN'): string {
  if (isToday(date)) return t.interviews.today;
  if (isTomorrow(date)) return t.interviews.tomorrow;
  return date.toLocaleDateString(locale === 'EN' ? 'en-US' : 'es-CR', { weekday: 'short', day: 'numeric', month: 'short' });
}

const CARD = 'rounded-xl border border-border bg-white p-4 shadow-card md:p-5';

export function UpcomingPanel({ interviews, isLoading, isError, onRetry }: UpcomingPanelProps) {
  const { t, locale } = useI18n();

  const upcoming = useMemo(() => {
    const now = new Date();
    return interviews
      .filter((iv) => (iv.status === 'scheduled' || iv.status === 'rescheduled') && new Date(iv.scheduledAt) >= now)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .slice(0, 8);
  }, [interviews]);

  const grouped = useMemo(() => {
    const groups: Record<string, InterviewListItem[]> = {};
    for (const iv of upcoming) {
      const date = new Date(iv.scheduledAt);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(iv);
    }
    return groups;
  }, [upcoming]);

  if (isLoading) {
    return (
      <div className={CARD} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="h-4 w-40 mb-4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3 mb-3">
            <Skeleton className="w-1 h-14 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-3 w-28 mb-2" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className={CARD}>
        <h2 className="mb-3 text-heading font-semibold text-brand">{t.interviews.upcoming}</h2>
        <ErrorState onRetry={onRetry} size="compact" />
      </div>
    );
  }

  return (
    <section className={CARD} aria-labelledby="upcoming-interviews-title">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 id="upcoming-interviews-title" className="text-heading font-semibold text-brand">
          {t.interviews.upcoming}
        </h2>
        <span className="text-caption font-medium text-muted tabular-nums">
          {pluralize(upcoming.length, { one: t.interviews.upcomingCountOne, other: t.interviews.upcomingCountOther }, locale)}
        </span>
      </div>

      {upcoming.length === 0 ? (
        <div className="py-6 text-center">
          <svg className="mx-auto mb-2 size-8 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <p className="text-subheading font-semibold text-primary">{t.interviews.noUpcoming}</p>
          <p className="mt-0.5 text-callout text-secondary">{t.interviews.noUpcomingDesc}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([key, items]) => {
            const dayDate = new Date(items[0].scheduledAt);
            const label = getDayLabel(dayDate, t, locale);
            const isTodayGroup = isToday(dayDate);

            return (
              <div key={key}>
                <h3 className={`mb-2 text-caption font-semibold uppercase tracking-wide ${isTodayGroup ? 'text-brand' : 'text-muted'}`}>
                  {label}
                </h3>
                <ul className="space-y-3">
                  {items.map((iv) => {
                    const time = new Date(iv.scheduledAt).toLocaleTimeString(locale === 'EN' ? 'en-US' : 'es-CR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <li key={iv.id} className="min-w-0 border-l-2 border-brand/30 pl-3">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-callout font-medium text-primary">
                            {iv.candidate.firstName} {iv.candidate.lastName}
                          </span>
                          <span className="ml-auto shrink-0 text-caption text-muted tabular-nums">{time}</span>
                        </div>
                        <p className="truncate text-caption text-muted">{iv.vacancy.title}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-caption text-secondary">
                            <InterviewTypeIcon type={iv.type} className="size-3" />
                            {interviewTypeLabel(t, iv.type)}
                          </span>
                          <span className="text-caption text-muted tabular-nums">{iv.duration} {t.interviews.minutes}</span>
                          <div className="ml-auto">
                            <EvaluatorStack evaluators={iv.evaluators} max={2} size="xs" />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
