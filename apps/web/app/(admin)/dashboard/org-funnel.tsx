'use client';

import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { PLACEHOLDER } from '../../../lib/dashboard/suppress';
import { LoadError } from './load-error';

const FUNNEL_STAGE_COLORS = [
  'bg-[#E8E5F0] text-[#1F114C]',
  'bg-[#D4CFE5] text-[#1F114C]',
  'bg-[#B8AED4] text-white',
  'bg-[#9B8DC4] text-white',
  'bg-[#7B6BAA] text-white',
  'bg-[#5C4B99] text-white',
  'bg-[#1F114C] text-white',
];

interface OrgFunnelProps {
  stages: { name: string; count: number; pctOfMax: number }[] | undefined;
  conversionPct: number | null;
  totalHired: number;
  isLoading: boolean;
  error?: boolean;
}

export function OrgFunnel({ stages, conversionPct, totalHired, isLoading, error }: OrgFunnelProps) {
  const { t } = useI18n();
  const occ = t.orgCommandCenter;

  const showHeaderStats = !isLoading && !error && !!stages;

  return (
    <div className="w-full md:flex-[65] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-base font-semibold text-[#1F114C]">{occ.recruitingFunnel}</span>
        {showHeaderStats && (
          <span className="text-[12px] text-[#585858]">
            {conversionPct === null ? PLACEHOLDER : `${conversionPct}%`} · {totalHired}
          </span>
        )}
      </div>

      {error ? (
        <LoadError message={occ.loadError} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !stages?.length ? (
        <EmptyState icon={<span />} message={occ.noData} />
      ) : (
        <div className="space-y-2">
          {stages.map((item, idx) => (
            <div key={item.name} className="flex items-center gap-4">
              <div
                className={`h-6 rounded-sm flex items-center justify-center ${FUNNEL_STAGE_COLORS[idx % FUNNEL_STAGE_COLORS.length]}`}
                style={{ width: `${Math.max(item.pctOfMax, 3)}%`, minWidth: 24 }}
              >
                <span className="text-[11px] font-medium">{item.count}</span>
              </div>
              <span className="text-xs text-[#585858] w-28 shrink-0">{item.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
