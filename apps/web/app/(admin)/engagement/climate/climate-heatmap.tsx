'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';

export function ClimateHeatmap() {
  const { t } = useI18n();
  const q = trpc.engagement.getClimateHeatmap.useQuery({});
  const data = q.data?.data ?? [];
  const max = data.reduce((m, d) => Math.max(m, d.score), 0) || 1;

  function color(score: number): string {
    const r = score / max;
    return r >= 0.7 ? '#22c55e' : r >= 0.5 ? '#f59e0b' : '#ef4444';
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#333]">{t.climate.dimensionScores}</h3>
        <span className="text-[10px] text-[#8B8B8B]">{t.climate.scaleNote}</span>
      </div>
      {q.isLoading ? (
        <div className="h-32 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.climate.errClimate}</p>
      ) : data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.climate.noClimateData}</p>
      ) : (
        <div className="space-y-2.5">
          {data.map((d) => (
            <div key={d.category} className="flex items-center gap-3">
              <span className="text-[11px] text-[#585858] w-[120px] shrink-0 truncate capitalize">{d.category}</span>
              <div className="flex-1 bg-[#EDEDED] rounded-full h-5 overflow-hidden">
                <div className="h-full rounded-full flex items-center justify-end pr-2 text-[10px] text-white font-semibold" style={{ width: `${Math.max((d.score / max) * 100, 8)}%`, backgroundColor: color(d.score) }}>
                  {d.score}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
