'use client';

import { useState, useRef, useEffect } from 'react';
import { FIT_BANDS, meetsPipelineFitThreshold, type PipelineFitCandidate } from '../../../../lib/pipeline-fit';
import { useI18n } from '../../../../lib/i18n';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';

export interface PipelineFilterState {
  source: string | null;
  fitMin: number | null;
  maxDays: number | null;
  slaOnly: boolean;
}

const EMPTY_FILTERS: PipelineFilterState = { source: null, fitMin: null, maxDays: null, slaOnly: false };

const SOURCES = ['portal', 'linkedin', 'referral', 'job_board', 'university', 'internal'] as const;

// The same bands as the card colours and the Candidate 360 (A-23).
const FIT_OPTIONS = [
  { value: FIT_BANDS.high, labelKey: 'filterFitHigh' },
  { value: FIT_BANDS.medium, labelKey: 'filterFitMedium' },
  { value: 0, labelKey: 'filterAll' },
] as const;

// Days the application has been in its CURRENT stage (see applyFilters), not days since applying.
const DATE_OPTIONS = [3, 7, 14, 30] as const;

interface Props {
  filters: PipelineFilterState;
  onChange: (f: PipelineFilterState) => void;
}

function FilterDropdown({ label, isActive, children, icon }: { label: string; isActive: boolean; children: React.ReactNode; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 h-8 rounded-lg border text-[12px] transition-colors ${
          isActive
            ? 'border-[#1F114C] bg-[#1F114C] text-white'
            : 'border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'
        }`}
      >
        {icon}
        {label}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-[#EDEDED] z-50 py-1 min-w-[160px]">
          {children}
        </div>
      )}
    </div>
  );
}

export function PipelineFilters({ filters, onChange }: Props) {
  const { t } = useI18n();
  const p = t.pipeline;
  const activeCount = [filters.source, filters.fitMin, filters.maxDays, filters.slaOnly].filter(Boolean).length;

  return (
    <div className="flex items-center gap-2">
      {/* Source filter */}
      <FilterDropdown
        label={filters.source ? candidateSourceLabel(filters.source, t.candidates) : p.filterSource}
        isActive={!!filters.source}
        icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg>}
      >
        <button
          onClick={() => onChange({ ...filters, source: null })}
          className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${!filters.source ? 'text-[#1F114C] font-medium' : 'text-[#585858]'}`}
        >
          {p.filterAll}
        </button>
        {SOURCES.map((s) => (
          <button
            key={s}
            onClick={() => onChange({ ...filters, source: s })}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${filters.source === s ? 'text-[#1F114C] font-medium bg-[#F6F6F6]' : 'text-[#585858]'}`}
          >
            {candidateSourceLabel(s, t.candidates)}
          </button>
        ))}
      </FilterDropdown>

      {/* FIT Score filter */}
      <FilterDropdown
        label={filters.fitMin != null && filters.fitMin > 0 ? p.filterFitActive.replace('{n}', String(filters.fitMin)) : p.filterFit}
        isActive={filters.fitMin != null && filters.fitMin > 0}
      >
        {FIT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange({ ...filters, fitMin: opt.value || null })}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${(filters.fitMin ?? 0) === opt.value ? 'text-[#1F114C] font-medium bg-[#F6F6F6]' : 'text-[#585858]'}`}
          >
            {p[opt.labelKey]}
          </button>
        ))}
      </FilterDropdown>

      {/* Date filter */}
      <FilterDropdown
        label={filters.maxDays ? p.filterDaysActive.replace('{n}', String(filters.maxDays)) : p.filterDaysInStage}
        isActive={!!filters.maxDays}
      >
        <button
          onClick={() => onChange({ ...filters, maxDays: null })}
          className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${!filters.maxDays ? 'text-[#1F114C] font-medium' : 'text-[#585858]'}`}
        >
          {p.filterAll}
        </button>
        {DATE_OPTIONS.map((days) => (
          <button
            key={days}
            onClick={() => onChange({ ...filters, maxDays: days })}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${filters.maxDays === days ? 'text-[#1F114C] font-medium bg-[#F6F6F6]' : 'text-[#585858]'}`}
          >
            {p.filterDaysLessThan.replace('{n}', String(days))}
          </button>
        ))}
      </FilterDropdown>

      {/* SLA filter */}
      <button
        onClick={() => onChange({ ...filters, slaOnly: !filters.slaOnly })}
        className={`flex items-center gap-1.5 px-3 h-8 rounded-lg border text-[12px] transition-colors ${
          filters.slaOnly
            ? 'border-[#DD0C15] bg-[#DD0C15]/10 text-[#DD0C15] font-medium'
            : 'border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'
        }`}
      >
        {p.filterSlaOverdue}
        {filters.slaOnly && (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        )}
      </button>

      {/* Clear all */}
      {activeCount > 0 && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-[11px] text-[#8B8B8B] hover:text-[#DD0C15] transition ml-1"
        >
          {p.filterClear.replace('{n}', String(activeCount))}
        </button>
      )}
    </div>
  );
}

/** Apply filters to board stages (client-side filtering) */
export function applyFilters(
  stages: Array<{ id: string; name: string; order: number; slaHours: number | null; applications: Array<{ id: string; source: string; appliedAt: Date | string; enteredStageAt: Date | string; candidate: PipelineFitCandidate; [key: string]: unknown }> }>,
  filters: PipelineFilterState,
): typeof stages {
  if (!filters.source && !filters.fitMin && !filters.maxDays && !filters.slaOnly) {
    return stages;
  }

  return stages.map((stage) => ({
    ...stage,
    applications: stage.applications.filter((app) => {
      // Source filter
      if (filters.source && app.source !== filters.source) return false;

      // A FIT threshold applies only to a persisted score for this vacancy.
      if (filters.fitMin) {
        if (!meetsPipelineFitThreshold(app.candidate, filters.fitMin)) return false;
      }

      // Date filter (days in stage)
      if (filters.maxDays) {
        const daysInStage = Math.floor((Date.now() - new Date(app.enteredStageAt).getTime()) / 86400000);
        if (daysInStage > filters.maxDays) return false;
      }

      // SLA filter — precise hours, not floored days*24, so sub-24h SLAs count. A stage without an SLA
      // (the default Oferta and Contratado) can never be overdue, so it shows nothing under this filter.
      if (filters.slaOnly) {
        if (stage.slaHours == null) return false;
        const hoursInStage = (Date.now() - new Date(app.enteredStageAt).getTime()) / 3600000;
        if (hoursInStage <= stage.slaHours) return false;
      }

      return true;
    }),
  }));
}

export { EMPTY_FILTERS };
