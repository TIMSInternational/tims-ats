'use client';

import { useState, useMemo } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import type { VacancyListItem } from '../../../lib/trpc-types';
import { ErrorState } from '../../../components';

const STAGE_COLORS = [
  'bg-[#E8E5F0] text-[#1F114C]',
  'bg-[#D4CFE5] text-[#1F114C]',
  'bg-[#B8AED4] text-white',
  'bg-[#9B8DC4] text-white',
  'bg-[#7B6BAA] text-white',
  'bg-[#5C4B99] text-white',
  'bg-[#1F114C] text-white',
];

interface PipelineFunnelProps {
  vacancies: VacancyListItem[];
}

/**
 * Pipeline-by-stage for ONE published vacancy, from `pipeline.getFunnel`.
 * The funnel API is per-vacancy and returns aggregate (all-time) counts, so
 * the card offers no "all vacancies" or period filter, and it never fills in
 * estimated stage counts: no data renders an explicit empty state.
 */
export function PipelineFunnel({ vacancies }: PipelineFunnelProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  const [selectedVacancyId, setSelectedVacancyId] = useState<string | null>(null);
  const [vacancyDropdownOpen, setVacancyDropdownOpen] = useState(false);

  const vacancyList = vacancies ?? [];
  const selectedVacancy =
    vacancyList.find((v) => v.id === selectedVacancyId) ?? vacancyList[0] ?? null;
  const targetVacancyId = selectedVacancy?.id ?? null;

  const funnelQuery = trpc.pipeline.getFunnel.useQuery(
    { vacancyId: targetVacancyId ?? '' },
    { enabled: !!targetVacancyId, staleTime: 30_000 },
  );

  const stages = useMemo(() => {
    const data = funnelQuery.data;
    if (!data?.funnel?.length) return [];
    const result = data.funnel.map((s) => ({
      label: s.stageName,
      count: s.currentCount,
      pct: s.conversionRate > 0 ? `${s.conversionRate}%` : '',
    }));
    result.unshift({ label: rd.applied, count: data.totalApplications, pct: '' });
    return result;
  }, [funnelQuery.data, rd.applied]);

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="w-full md:flex-[65] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-base font-semibold text-[#1F114C]">{rd.pipelineByStage}</span>
        {selectedVacancy && (
          <div className="relative">
            <button
              onClick={() => setVacancyDropdownOpen(!vacancyDropdownOpen)}
              aria-expanded={vacancyDropdownOpen}
              className="flex items-center gap-2 bg-[#F6F6F6] hover:bg-[#EDEDED] rounded-lg px-3 h-8 transition-colors max-w-[200px]"
            >
              <span className="text-[12px] text-[#1F114C] truncate">{selectedVacancy.title}</span>
              <svg aria-hidden="true" className={`w-3.5 h-3.5 text-[#1F114C] shrink-0 transition-transform ${vacancyDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {vacancyDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-[280px] bg-white rounded-lg shadow-lg border border-[#EDEDED] z-50 max-h-[260px] overflow-y-auto py-1">
                {vacancyList.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => { setSelectedVacancyId(v.id); setVacancyDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] transition truncate ${selectedVacancy.id === v.id ? 'text-[#1F114C] font-medium bg-[#F6F6F6]' : 'text-[#585858]'}`}
                  >
                    {v.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Funnel bars */}
      {!targetVacancyId ? (
        <p className="text-[12px] text-muted py-6 text-center">{rd.noVacanciesPublished}</p>
      ) : funnelQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" style={{ width: `${100 - i * 12}%` }} />
          ))}
        </div>
      ) : funnelQuery.isError ? (
        <ErrorState onRetry={() => funnelQuery.refetch()} />
      ) : stages.length === 0 ? (
        <p className="text-[12px] text-muted py-6 text-center">{rd.noPipelineData}</p>
      ) : (
        <div className="space-y-2">
          {stages.map((stage, idx) => {
            const widthPct = Math.max((stage.count / maxCount) * 100, 3);
            return (
              <div key={stage.label} className="flex items-center gap-4">
                <div
                  className={`h-6 rounded-sm flex items-center justify-center ${STAGE_COLORS[idx % STAGE_COLORS.length]}`}
                  style={{ width: `${widthPct}%`, minWidth: 24 }}
                >
                  <span className="text-[11px] font-medium">{stage.count}</span>
                </div>
                <span className="text-xs text-[#585858] w-28 shrink-0">
                  {stage.label}{' '}
                  {stage.pct && <span className="text-[10px] text-muted">{stage.pct}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PipelineFunnelSkeleton() {
  return (
    <div className="w-full md:flex-[65] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="h-5 w-60 bg-gray-200 rounded mb-4" />
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-6 bg-gray-200 rounded" style={{ width: `${100 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}
