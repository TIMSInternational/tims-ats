'use client';

import { useI18n } from '../../../../lib/i18n';

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  poolFilter: string;
  onPoolChange: (v: string) => void;
  sourceFilter: string;
  onSourceChange: (v: string) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
  onCreateClick: () => void;
}

export function FilterBar({
  search, onSearchChange, poolFilter, onPoolChange,
  sourceFilter, onSourceChange, onClearFilters, hasFilters, onCreateClick,
}: FilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-3 gap-y-2 mb-4 flex-shrink-0">
      <div className="relative flex-1 max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.candidates.searchCandidate}
          className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
        />
      </div>

      <select
        value={poolFilter}
        onChange={(e) => onPoolChange(e.target.value)}
        className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
      >
        <option value="">{t.candidates.allPools}</option>
        <option value="applicant">{t.candidates.poolApplicant}</option>
        <option value="referral">{t.candidates.poolReferral}</option>
        <option value="sourced">{t.candidates.poolSourced}</option>
        <option value="silver_medalist">{t.candidates.poolSilverMedalist}</option>
        <option value="passive">{t.candidates.poolPassive}</option>
      </select>

      <select
        value={sourceFilter}
        onChange={(e) => onSourceChange(e.target.value)}
        className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
      >
        <option value="">{t.candidates.allSources}</option>
        <option value="linkedin">{t.candidates.sourceLinkedin}</option>
        <option value="portal">{t.candidates.sourcePortal}</option>
        <option value="referral">{t.candidates.sourceReferral}</option>
        <option value="manual">{t.candidates.sourceManual}</option>
      </select>

      {hasFilters && (
        <button onClick={onClearFilters} className="h-9 px-3 rounded-lg border border-[#EDEDED] text-xs text-[#8B8B8B] hover:bg-[#F6F6F6] transition">
          {t.subscriptions.clearFilters}
        </button>
      )}

      <button
        onClick={onCreateClick}
        className="h-9 px-4 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition flex items-center gap-2 ml-auto"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        {t.candidates.newCandidate}
      </button>
    </div>
  );
}
