'use client';

import { useI18n } from '../../../../lib/i18n';
import {
  useReportingTrend,
  useReportingLostByDelay,
} from '../../../../lib/platform-api/reporting';
import type { AnalyticsPeriod } from './page';

function CardSkeleton({ flex }: { flex: string }) {
  return (
    <div className={`w-full ${flex} bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse`}>
      <div className="h-40 bg-gray-100 rounded" />
    </div>
  );
}

function CardError({ flex, message }: { flex: string; message: string }) {
  return (
    <div className={`w-full ${flex} bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center text-[12px] text-[#DD0C15]`}>
      {message}
    </div>
  );
}

export function AnalyticsTrend() {
  const { t, locale } = useI18n();
  const q = useReportingTrend();

  if (q.isLoading) return <CardSkeleton flex="md:flex-[40]" />;
  if (q.isError || !q.data) return <CardError flex="md:flex-[40]" message={t.recruitAnalytics.errLoading} />;

  const months = q.data;
  const max = Math.max(1, ...months.map((m) => m.count));
  const fmt = new Intl.DateTimeFormat(locale === 'ES' ? 'es' : 'en', { month: 'short' });

  return (
    <div className="w-full md:flex-[40] bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.recruitAnalytics.trendTitle}</h3>
      <div className="h-[160px] flex items-end gap-2 px-2">
        {months.map((m) => (
          <div key={`${m.year}-${m.month}`} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
            <div
              className="w-full bg-[#B8AED4] rounded-t-sm"
              style={{ height: `${Math.max(Math.round((m.count / max) * 110), m.count > 0 ? 6 : 2)}px` }}
            />
            <span className="text-[9px] text-[#8B8B8B] capitalize">
              {fmt.format(new Date(m.year, m.month, 1))}
            </span>
            <span className="text-[10px] font-medium text-[#1F114C]">{m.count}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F0F0F0]">
        <span className="w-3 h-3 rounded-sm bg-[#B8AED4]" />
        <span className="text-[10px] text-[#585858]">{t.recruitAnalytics.actual}</span>
      </div>
    </div>
  );
}

export function AnalyticsLostByDelay({ period }: { period: AnalyticsPeriod }) {
  const { t } = useI18n();
  const q = useReportingLostByDelay(period);

  if (q.isLoading) return <CardSkeleton flex="md:flex-[30]" />;
  if (q.isError || !q.data) return <CardError flex="md:flex-[30]" message={t.recruitAnalytics.errLoading} />;

  const { total, items } = q.data;

  return (
    <div className="w-full md:flex-[30] bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.recruitAnalytics.lostByDelay}</h3>
        <span
          className={`${total > 0 ? 'bg-[#DD0C15]' : 'bg-green-500'} text-white text-[10px] font-bold w-6 h-6 rounded-full flex items-center justify-center`}
        >
          {total}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] text-center py-8">{t.recruitAnalytics.noneLostByDelay}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.stageName} className="flex items-center justify-between bg-[#F6F6F6] rounded-lg px-3 py-2">
              <div>
                <p className="text-[11px] text-[#333] font-medium">{item.stageName}</p>
                <p className="text-[10px] text-[#DD0C15]">
                  {item.lostCount} {t.recruitAnalytics.candidates.toLowerCase()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[12px] font-bold text-[#DD0C15]">
                  +{item.avgDaysOver}d {t.recruitAnalytics.avgOverSla}
                </p>
                <p className="text-[9px] text-[#8B8B8B]">SLA: {item.slaDays}d</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AnalyticsVacancyPrediction() {
  const { t } = useI18n();

  // Honest unavailable state — there is no trained prediction model yet
  // (rule: no stub may impersonate a feature). Endpoint intentionally absent.
  return (
    <div className="w-full md:flex-[30] bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.recruitAnalytics.vacancyPrediction}</h3>
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <svg className="w-8 h-8 text-[#D4CFE5] mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
        </svg>
        <p className="text-[12px] text-[#8B8B8B]">{t.recruitAnalytics.predictionUnavailable}</p>
      </div>
    </div>
  );
}
