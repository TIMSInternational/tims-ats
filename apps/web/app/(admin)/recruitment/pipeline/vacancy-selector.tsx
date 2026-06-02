'use client';

import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Skeleton } from '../../../../components';
import type { VacancyListItem } from '../../../../lib/trpc-types';

interface VacancySelectorProps {
  vacancies: VacancyListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}

export function VacancySelector({ vacancies, selectedId, onSelect, isLoading }: VacancySelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = vacancies.find((v) => v.id === selectedId);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isLoading) return <Skeleton className="h-10 w-64 rounded-lg" />;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-[#F6F6F6] rounded-lg px-4 h-10 cursor-pointer hover:bg-[#EDEDED] transition-colors"
      >
        {/* Briefcase icon */}
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a4 4 0 00-8 0v2" />
        </svg>
        <span className="text-[13px] text-[#1F114C] font-medium max-w-[260px] truncate">
          {selected ? selected.title : t.pipeline.selectVacancy}
        </span>
        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-[#1F114C] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"
        >
          <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[340px] bg-white rounded-lg shadow-lg border border-[#EDEDED] z-50 max-h-[320px] overflow-y-auto py-1">
          {vacancies.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-[#8B8B8B]">{'No hay vacantes publicadas'}</div>
          ) : (
            vacancies.map((v) => (
              <button
                key={v.id}
                onClick={() => { onSelect(v.id); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-[#F6F6F6] transition-colors ${
                  v.id === selectedId ? 'bg-[#F0EEF5]' : ''
                }`}
              >
                <svg className="w-4 h-4 text-[#8B8B8B] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a4 4 0 00-8 0v2" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#1F114C] truncate">{v.title}</p>
                  {v.company && (
                    <p className="text-[11px] text-[#8B8B8B] truncate">{v.company.name}</p>
                  )}
                </div>
                {v.id === selectedId && (
                  <svg className="w-4 h-4 text-[#1F114C] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
