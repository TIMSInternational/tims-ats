'use client';

import { useMemo } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { CandidateAvatar, Skeleton } from '../../../../components';
import type { InterviewListItem } from '../../../../lib/trpc-types';

interface UpcomingPanelProps {
  interviews: InterviewListItem[];
  isLoading: boolean;
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

function getDayLabel(date: Date, t: ReturnType<typeof useI18n>['t']): string {
  if (isToday(date)) return t.interviews.today;
  if (isTomorrow(date)) return t.interviews.tomorrow;
  return date.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
}

const TYPE_COLORS: Record<string, string> = {
  phone: 'bg-blue-500',
  video: 'bg-violet-500',
  panel: 'bg-amber-500',
  onsite: 'bg-teal-500',
  technical: 'bg-rose-500',
  cultural: 'bg-emerald-500',
};

export function UpcomingPanel({ interviews, isLoading }: UpcomingPanelProps) {
  const { t } = useI18n();

  const upcoming = useMemo(() => {
    const now = new Date();
    return interviews
      .filter((iv) => iv.status === 'scheduled' && new Date(iv.scheduledAt) >= now)
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
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
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

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#1F114C]">{t.interviews.upcoming}</h3>
        <span className="text-[10px] text-[#8B8B8B] font-medium">{upcoming.length} {t.interviews.thisWeek}</span>
      </div>

      {upcoming.length === 0 ? (
        <div className="text-center py-6">
          <svg className="w-8 h-8 text-[#EDEDED] mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <p className="text-[12px] text-[#8B8B8B]">{t.interviews.noUpcoming}</p>
          <p className="text-[10px] text-[#CDCDCD] mt-0.5">{t.interviews.noUpcomingDesc}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([key, items]) => {
            const dayDate = new Date(items[0].scheduledAt);
            const label = getDayLabel(dayDate, t);
            const isTodayGroup = isToday(dayDate);

            return (
              <div key={key}>
                <div className="flex items-center gap-2 mb-2">
                  {isTodayGroup && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#DD0C15] animate-pulse" />
                  )}
                  <span className={`text-[11px] font-semibold uppercase tracking-wide ${isTodayGroup ? 'text-[#DD0C15]' : 'text-[#8B8B8B]'}`}>
                    {label}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((iv) => {
                    const time = new Date(iv.scheduledAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
                    const barColor = TYPE_COLORS[iv.type] ?? 'bg-gray-400';

                    return (
                      <div key={iv.id} className="flex gap-3 group">
                        <div className={`w-1 rounded-full ${barColor} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium text-[#333] truncate">
                              {iv.candidate.firstName} {iv.candidate.lastName}
                            </span>
                            <span className="text-[10px] text-[#8B8B8B] shrink-0">{time}</span>
                          </div>
                          <p className="text-[10px] text-[#8B8B8B] truncate">{iv.vacancy.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] bg-[#F6F6F6] text-[#585858] px-1.5 py-0.5 rounded">
                              {iv.type}
                            </span>
                            <span className="text-[9px] text-[#CDCDCD]">{iv.duration} {t.interviews.minutes}</span>
                            <div className="flex -space-x-1.5 ml-auto">
                              {iv.evaluators.slice(0, 2).map((ev) => (
                                <CandidateAvatar
                                  key={ev.user.id}
                                  firstName={ev.user.firstName}
                                  lastName={ev.user.lastName}
                                  avatar={ev.user.avatar}
                                  size="xs"
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
