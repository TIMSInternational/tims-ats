'use client';

import { useI18n } from '../../../../lib/i18n';

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  planFilter: string;
  onPlanChange: (value: string) => void;
  onClearFilters: () => void;
  onExportCsv: () => void;
  hasFilters: boolean;
}

export function FilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  planFilter,
  onPlanChange,
  onClearFilters,
  onExportCsv,
  hasFilters,
}: FilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 mb-4 flex items-center gap-3 flex-shrink-0">
      <div className="relative flex-1 max-w-xs">
        <input
          type="text"
          placeholder={t.subscriptions.searchOrg}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full h-9 pl-9 pr-4 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]"
        />
        <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
      </div>
      <select
        value={planFilter}
        onChange={(e) => onPlanChange(e.target.value)}
        className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:border-[#1F114C]"
      >
        <option value="">{t.subscriptions.allPlans}</option>
        <option value="trial">Trial</option>
        <option value="starter">Starter</option>
        <option value="professional">Professional</option>
        <option value="enterprise">Enterprise</option>
      </select>
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:border-[#1F114C]"
      >
        <option value="">{t.subscriptions.allStatuses}</option>
        <option value="active">{t.subscriptions.statusActive}</option>
        <option value="trialing">{t.subscriptions.statusTrialing}</option>
        <option value="past_due">{t.subscriptions.statusPastDue}</option>
        <option value="cancelled">{t.subscriptions.statusCanceled}</option>
      </select>
      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="h-9 px-3 rounded-lg text-sm text-[#8B8B8B] hover:text-[#585858] transition font-medium"
        >
          {t.subscriptions.clearFilters}
        </button>
      )}
      <div className="flex-1" />
      <button
        onClick={onExportCsv}
        className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition flex items-center gap-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        CSV
      </button>
    </div>
  );
}
