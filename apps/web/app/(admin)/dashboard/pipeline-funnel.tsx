'use client';

import { useI18n } from '../../../lib/i18n';

const STAGE_COLORS = [
  'bg-[#E8E5F0] text-[#1F114C]',
  'bg-[#D4CFE5] text-[#1F114C]',
  'bg-[#B8AED4] text-white',
  'bg-[#9B8DC4] text-white',
  'bg-[#7B6BAA] text-white',
  'bg-[#5C4B99] text-white',
  'bg-[#1F114C] text-white',
];

interface PipelineStage {
  label: string;
  count: number;
  pct: string;
}

interface PipelineFunnelProps {
  totalApplications: number;
}

export function PipelineFunnel({ totalApplications }: PipelineFunnelProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  const total = Math.max(totalApplications, 1);

  // Static stage data matching the HTML design proportions
  const stages: PipelineStage[] = [
    { label: rd.applied, count: total, pct: '' },
    { label: rd.preselection, count: Math.round(total * 0.526), pct: '53%' },
    { label: rd.evalPca, count: Math.round(total * 0.278), pct: '53%' },
    { label: rd.evalMil, count: Math.round(total * 0.196), pct: '71%' },
    { label: rd.interview, count: Math.round(total * 0.123), pct: '63%' },
    { label: rd.offer, count: Math.round(total * 0.044), pct: '36%' },
    { label: rd.hired, count: Math.round(total * 0.023), pct: '53%' },
  ];

  return (
    <div className="flex-[65] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-base font-semibold text-[#1F114C]">{rd.pipelineByStage}</span>
        <div className="flex gap-3">
          <div className="flex items-center gap-2 bg-[#F6F6F6] rounded-md px-3 h-8">
            <span className="text-[13px] text-[#1F114C]">{rd.allVacancies}</span>
            <svg className="w-3.5 h-3.5 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
          <div className="flex items-center gap-2 bg-[#F6F6F6] rounded-md px-3 h-8">
            <span className="text-[13px] text-[#1F114C]">{rd.last30Days}</span>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {stages.map((stage, idx) => {
          const widthPct = Math.max((stage.count / total) * 100, 3);
          return (
            <div key={stage.label} className="flex items-center gap-4">
              <div
                className={`h-6 rounded-sm flex items-center justify-center ${STAGE_COLORS[idx]}`}
                style={{ width: `${widthPct}%` }}
              >
                <span className="text-[11px] font-medium">{stage.count}</span>
              </div>
              <span className="text-xs text-[#585858] w-24 shrink-0">
                {stage.label}{' '}
                {stage.pct && (
                  <span className="text-[10px] text-[#8B8B8B]">{stage.pct}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PipelineFunnelSkeleton() {
  return (
    <div className="flex-[65] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="h-5 w-60 bg-gray-200 rounded mb-4" />
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-6 bg-gray-200 rounded" style={{ width: `${100 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}
