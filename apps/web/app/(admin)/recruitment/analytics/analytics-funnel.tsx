'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import type { AnalyticsPeriod } from './page';

function CardSkeleton() {
  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="h-40 bg-gray-100 rounded" />
    </div>
  );
}

function CardError({ message }: { message: string }) {
  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center text-[12px] text-[#DD0C15]">
      {message}
    </div>
  );
}

// Darkens as the funnel narrows — same palette as the original design.
const BAR_COLORS = ['bg-[#E8E5F0]', 'bg-[#D4CFE5]', 'bg-[#B8AED4]', 'bg-[#7B6BAA]', 'bg-[#5C4B99]', 'bg-[#1F114C]'];
const TEXT_COLORS = ['text-[#1F114C]', 'text-[#1F114C]', 'text-white', 'text-white', 'text-white', 'text-white'];

export function AnalyticsFunnel() {
  const { t } = useI18n();
  const q = trpc.recruitmentAnalytics.getFunnel.useQuery();

  if (q.isLoading) return <CardSkeleton />;
  if (q.isError || !q.data) return <CardError message={t.recruitAnalytics.errLoading} />;

  const { stages, totalApplications, totalHired, conversionPct } = q.data;

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.recruitAnalytics.funnel}</h3>
      {stages.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] text-center py-8">{t.recruitAnalytics.noFunnelData}</p>
      ) : (
        <div className="space-y-2">
          {stages.map((stage, idx) => (
            <div key={stage.name} className="flex items-center gap-3">
              <span className="text-[11px] text-[#585858] w-24 shrink-0 truncate" title={stage.name}>
                {stage.name}
              </span>
              <div className="flex-1 bg-[#F6F6F6] rounded-full h-6 relative overflow-hidden">
                <div
                  className={`h-6 ${BAR_COLORS[Math.min(idx, BAR_COLORS.length - 1)]} rounded-full flex items-center justify-end pr-2`}
                  style={{ width: `${Math.max(stage.pctOfMax, 8)}%` }}
                >
                  <span className={`text-[11px] font-medium ${TEXT_COLORS[Math.min(idx, TEXT_COLORS.length - 1)]}`}>
                    {stage.count}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-center gap-6 mt-4 pt-3 border-t border-[#F0F0F0]">
        <span className="text-[11px] text-[#585858]">
          {t.recruitAnalytics.totalConversion}:{' '}
          <strong className="text-[#1F114C]">{conversionPct != null ? `${conversionPct}%` : '—'}</strong>
        </span>
        <span className="text-[11px] text-[#585858]">
          {t.recruitAnalytics.hired}: <strong className="text-[#1F114C]">{totalHired}</strong> /{' '}
          {totalApplications}
        </span>
      </div>
    </div>
  );
}

export function AnalyticsSourceQuality({ period }: { period: AnalyticsPeriod }) {
  const { t } = useI18n();
  const q = trpc.recruitmentAnalytics.getSourceBreakdown.useQuery({ period });

  if (q.isLoading) return <CardSkeleton />;
  if (q.isError || !q.data) return <CardError message={t.recruitAnalytics.errLoading} />;

  const sources = q.data;
  const maxApps = Math.max(1, ...sources.map((s) => s.applications));
  const DOT_COLORS = ['bg-blue-500', 'bg-[#1F114C]', 'bg-green-500', 'bg-orange-500', 'bg-amber-500', 'bg-teal-500'];

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.recruitAnalytics.sourcesTitle}</h3>
      {sources.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] text-center py-8">{t.recruitAnalytics.noSourceData}</p>
      ) : (
        <div className="space-y-3">
          {sources.map((src, idx) => (
            <div key={src.source}>
              <div className="flex justify-between items-center mb-1.5">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded ${DOT_COLORS[idx % DOT_COLORS.length]}`} />
                  <span className="text-[12px] text-[#333] font-medium capitalize">{src.source}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[11px] text-[#585858]">
                    {src.applications} {t.recruitAnalytics.applicationsLabel}
                  </span>
                  <span className={`text-[11px] font-medium ${src.hires > 0 ? 'text-green-600' : 'text-[#8B8B8B]'}`}>
                    {src.hires} {t.recruitAnalytics.hires}
                  </span>
                </div>
              </div>
              <div className="w-full bg-[#F6F6F6] rounded-sm h-4 overflow-hidden">
                <div
                  className="bg-[#7B6BAA] h-4 rounded-sm"
                  style={{ width: `${Math.round((src.applications / maxApps) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
