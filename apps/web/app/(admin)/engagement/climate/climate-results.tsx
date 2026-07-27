'use client';

import { useI18n } from '../../../../lib/i18n';
import { useEngagementEnps } from '../../../../lib/platform-api/engagement';

export function ClimateResults() {
  const { t } = useI18n();
  const q = useEngagementEnps();

  // eNPS is suppressed (min-5 k-anonymity) when the backend nulls its head-counts.
  const suppressed = q.data?.suppressed === true || (q.data != null && q.data.promoters == null);
  const segments =
    q.data && !suppressed
      ? [
          { label: t.climate.promoters, value: q.data.promoters ?? 0, cls: 'bg-green-500' },
          { label: t.climate.passives, value: q.data.passives ?? 0, cls: 'bg-amber-400' },
          { label: t.climate.detractors, value: q.data.detractors ?? 0, cls: 'bg-red-500' },
        ]
      : [];
  const total = q.data?.totalResponses ?? 0;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-[13px] font-semibold text-[#333] mb-3">{t.climate.enpsDistribution}</h3>
      {q.isLoading ? (
        <div className="h-20 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.climate.errClimate}</p>
      ) : suppressed ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.climate.enpsSuppressed}</p>
      ) : total === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.climate.noClimateData}</p>
      ) : (
        <>
          <div className="flex h-6 rounded-full overflow-hidden mb-3">
            {segments.map((s) => (
              <div key={s.label} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} />
            ))}
          </div>
          <div className="space-y-1.5">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${s.cls}`} />
                  <span className="text-[11px] text-[#333]">{s.label}</span>
                </div>
                <span className="text-[11px] text-[#8B8B8B]">
                  {s.value} · {Math.round((s.value / total) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
