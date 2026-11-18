'use client';

import { useMemo } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../../components';
import type { InterviewListItem } from '../../../../lib/trpc-types';
import { pluralize } from '../../../../lib/i18n/format';

interface MiniCalendarProps {
  interviews: InterviewListItem[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** Monday-first short weekday names in the UI language ("Lun", "Mié", "Sáb" / "Mon", "Wed", "Sat"). */
function weekdayLabels(locale: 'ES' | 'EN'): string[] {
  const format = new Intl.DateTimeFormat(locale === 'EN' ? 'en-US' : 'es-CR', { weekday: 'short', timeZone: 'UTC' });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => {
    const name = format.format(new Date(Date.UTC(2024, 0, 1 + i))).replace('.', '');
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
}

function getMonthDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  const cells: (number | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

export function MiniCalendar({ interviews, isLoading, isError, onRetry }: MiniCalendarProps) {
  const { t, locale } = useI18n();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const interviewDays = useMemo(() => {
    const days = new Map<number, number>();
    for (const iv of interviews) {
      if (iv.status === 'cancelled') continue;
      const d = new Date(iv.scheduledAt);
      if (d.getFullYear() === year && d.getMonth() === month) {
        days.set(d.getDate(), (days.get(d.getDate()) ?? 0) + 1);
      }
    }
    return days;
  }, [interviews, year, month]);

  const cells = useMemo(() => getMonthDays(year, month), [year, month]);
  const today = now.getDate();
  const rawMonth = now.toLocaleDateString(locale === 'EN' ? 'en-US' : 'es-CR', { month: 'long', year: 'numeric' });
  // Capitalise only the first letter ("Noviembre de 2026"), never every word.
  const monthName = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
  const card = 'rounded-xl border border-border bg-white p-4 shadow-card md:p-5';

  if (isLoading) {
    return (
      <div className={card} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-8 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={card}>
        <h2 className="mb-3 text-heading font-semibold text-brand">{t.interviews.calendar}</h2>
        <ErrorState onRetry={onRetry} size="compact" />
      </div>
    );
  }

  return (
    <section className={card} aria-labelledby="interview-calendar-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="interview-calendar-title" className="text-heading font-semibold text-brand">{t.interviews.calendar}</h2>
        <span className="text-caption text-muted">{monthName}</span>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1" aria-hidden="true">
        {weekdayLabels(locale).map((d) => (
          <div key={d} className="text-center text-caption text-muted font-medium py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e-${idx}`} className="h-8" aria-hidden="true" />;

          const count = interviewDays.get(day) ?? 0;
          const isToday = day === today;

          return (
            <div
              key={day}
              aria-current={isToday ? 'date' : undefined}
              className={`h-8 flex flex-col items-center justify-center rounded relative tabular-nums ${
                isToday
                  ? 'bg-brand text-white'
                  : count > 0
                    ? 'bg-brand-tint text-primary font-semibold'
                    : 'text-secondary'
              }`}
            >
              <span className="text-caption leading-none">{day}</span>
              {count > 0 && (
                <>
                  <div className="flex gap-0.5 mt-0.5" aria-hidden="true">
                    {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                      <span key={i} className={`size-1 rounded-full ${isToday ? 'bg-white/70' : 'bg-brand'}`} />
                    ))}
                  </div>
                  <span className="sr-only">
                    {pluralize(count, { one: t.interviews.interviewsOnDayOne, other: t.interviews.interviewsOnDayOther }, locale)}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
