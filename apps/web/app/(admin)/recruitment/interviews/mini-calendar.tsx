'use client';

import { useMemo } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../../components';
import type { InterviewListItem } from '../../../../lib/trpc-types';

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
  const monthName = now.toLocaleDateString('es', { month: 'long', year: 'numeric' });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
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
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#1F114C]">{t.interviews.calendar}</h3>
        <span className="text-[11px] text-[#8B8B8B] capitalize">{monthName}</span>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {weekdayLabels(locale).map((d) => (
          <div key={d} className="text-center text-[9px] text-[#8B8B8B] font-medium py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e-${idx}`} className="h-8" />;

          const count = interviewDays.get(day) ?? 0;
          const isToday = day === today;

          return (
            <div
              key={day}
              className={`h-8 flex flex-col items-center justify-center rounded relative ${
                isToday
                  ? 'bg-[#1F114C] text-white'
                  : count > 0
                    ? 'bg-[#F6F6F6] text-[#333]'
                    : 'text-[#8B8B8B]'
              }`}
            >
              <span className="text-[11px] leading-none">{day}</span>
              {count > 0 && (
                <div className="flex gap-0.5 mt-0.5">
                  {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-1 h-1 rounded-full ${isToday ? 'bg-white/70' : 'bg-[#DD0C15]'}`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
