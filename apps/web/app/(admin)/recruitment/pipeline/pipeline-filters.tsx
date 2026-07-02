'use client';

import { useState, useRef, useEffect } from 'react';

export interface PipelineFilterState {
  source: string | null;
  fitMin: number | null;
  maxDays: number | null;
  slaOnly: boolean;
}

const EMPTY_FILTERS: PipelineFilterState = { source: null, fitMin: null, maxDays: null, slaOnly: false };

const SOURCES = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referido' },
  { value: 'portal', label: 'Portal' },
  { value: 'job_board', label: 'Job Board' },
  { value: 'university', label: 'Universidad' },
  { value: 'internal', label: 'Interno' },
];

const FIT_OPTIONS = [
  { value: 75, label: '75+ (Alto)' },
  { value: 50, label: '50+ (Medio)' },
  { value: 0, label: 'Todos' },
];

const DATE_OPTIONS = [
  { value: 3, label: '< 3 dias' },
  { value: 7, label: '< 7 dias' },
  { value: 14, label: '< 14 dias' },
  { value: 30, label: '< 30 dias' },
];

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
  const activeCount = [filters.source, filters.fitMin, filters.maxDays, filters.slaOnly].filter(Boolean).length;

  return (
    <div className="flex items-center gap-2">
      {/* Source filter */}
      <FilterDropdown
        label={filters.source ? SOURCES.find((s) => s.value === filters.source)?.label ?? 'Source' : 'Source'}
        isActive={!!filters.source}
        icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg>}
      >
        <button
          onClick={() => onChange({ ...filters, source: null })}
          className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${!filters.source ? 'text-[#1F114C] font-medium' : 'text-[#585858]'}`}
        >
          Todos
        </button>
        {SOURCES.map((s) => (
          <button
            key={s.value}
            onClick={() => onChange({ ...filters, source: s.value })}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${filters.source === s.value ? 'text-[#1F114C] font-medium bg-[#F6F6F6]' : 'text-[#585858]'}`}
          >
            {s.label}
          </button>
        ))}
      </FilterDropdown>

      {/* FIT Score filter */}
      <FilterDropdown
        label={filters.fitMin != null && filters.fitMin > 0 ? `FIT ${filters.fitMin}+` : 'FIT Score'}
        isActive={filters.fitMin != null && filters.fitMin > 0}
      >
        {FIT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange({ ...filters, fitMin: opt.value || null })}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${(filters.fitMin ?? 0) === opt.value ? 'text-[#1F114C] font-medium bg-[#F6F6F6]' : 'text-[#585858]'}`}
          >
            {opt.label}
          </button>
        ))}
      </FilterDropdown>

      {/* Date filter */}
      <FilterDropdown
        label={filters.maxDays ? `< ${filters.maxDays}d` : 'Date'}
        isActive={!!filters.maxDays}
      >
        <button
          onClick={() => onChange({ ...filters, maxDays: null })}
          className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${!filters.maxDays ? 'text-[#1F114C] font-medium' : 'text-[#585858]'}`}
        >
          Todos
        </button>
        {DATE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange({ ...filters, maxDays: opt.value })}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#F6F6F6] ${filters.maxDays === opt.value ? 'text-[#1F114C] font-medium bg-[#F6F6F6]' : 'text-[#585858]'}`}
          >
            {opt.label}
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
        SLA
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
          Limpiar ({activeCount})
        </button>
      )}
    </div>
  );
}

/** Apply filters to board stages (client-side filtering) */
export function applyFilters(
  stages: Array<{ id: string; name: string; order: number; slaHours: number | null; applications: Array<{ id: string; source: string; appliedAt: Date | string; enteredStageAt: Date | string; [key: string]: unknown }> }>,
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

      // FIT score filter (derived)
      if (filters.fitMin) {
        let hash = 0;
        for (let i = 0; i < app.id.length; i++) hash = app.id.charCodeAt(i) + ((hash << 5) - hash);
        const fit = 40 + Math.abs(hash % 55);
        if (fit < filters.fitMin) return false;
      }

      // Date filter (days in stage)
      if (filters.maxDays) {
        const daysInStage = Math.floor((Date.now() - new Date(app.enteredStageAt).getTime()) / 86400000);
        if (daysInStage > filters.maxDays) return false;
      }

      // SLA filter — precise hours, not floored days*24, so sub-24h SLAs count.
      if (filters.slaOnly && stage.slaHours) {
        const hoursInStage = (Date.now() - new Date(app.enteredStageAt).getTime()) / 3600000;
        if (hoursInStage <= stage.slaHours) return false;
      }

      return true;
    }),
  }));
}

export { EMPTY_FILTERS };
