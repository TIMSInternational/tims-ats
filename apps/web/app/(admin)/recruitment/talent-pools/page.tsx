'use client';

import { useState, useCallback } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { TalentPoolFilters } from './talent-pool-filters';
import { TalentPoolAiBar } from './talent-pool-ai-bar';
import { TalentPoolResultsHeader } from './talent-pool-results-header';
import { TalentPoolTable } from './talent-pool-table';
import { CreateModal } from '../candidates/create-modal';

export interface TalentPoolFilterState {
  search: string;
  poolTypes: string[];
  fitMin: number;
  skills: string[];
  locations: string[];
  experienceLevels: string[];
  sort: string;
}

const DEFAULT_FILTERS: TalentPoolFilterState = {
  search: '',
  poolTypes: [],
  fitMin: 0,
  skills: [],
  locations: [],
  experienceLevels: [],
  sort: 'fit',
};

export default function TalentPoolsPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<TalentPoolFilterState>(DEFAULT_FILTERS);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const updateFilter = useCallback(<K extends keyof TalentPoolFilterState>(key: K, value: TalentPoolFilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCursor(undefined);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setCursor(undefined);
  }, []);

  const query = trpc.candidate.list.useQuery({
    cursor,
    limit: 25,
    search: filters.search || undefined,
    poolType: filters.poolTypes.length === 1 ? filters.poolTypes[0] : undefined,
    fitMin: filters.fitMin > 0 ? filters.fitMin : undefined,
    skills: filters.skills.length > 0 ? filters.skills : undefined,
  });

  const utils = trpc.useUtils();
  const createMutation = trpc.candidate.create.useMutation({
    onSuccess: () => {
      toast(t.talentPool.candidateAdded);
      utils.candidate.list.invalidate();
      setShowCreateModal(false);
    },
    onError: () => toast(t.talentPool.candidateCreateError, { type: 'error' }),
  });

  const candidates = query.data?.items ?? [];
  const nextCursor = query.data?.nextCursor;

  const exportMutation = trpc.candidate.pool.export.useMutation();
  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({
        format: 'csv',
        poolType: filters.poolTypes.length === 1 ? filters.poolTypes[0] : undefined,
      });
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (result.truncated) {
        toast(t.talentPool.exportTruncated.replace('{count}', String(result.count)), { type: 'info' });
      } else {
        toast(`${t.talentPool.export}: ${result.count}`, { type: 'success' });
      }
    } catch {
      toast(t.common.error, { type: 'error' });
    }
  };
  const handleRecontact = () => toast(t.talentPool.recontactStarted);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <span className="text-sm font-medium text-[#1F114C]">{t.talentPool.title}</span>
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px]"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t.talentPool.export}
          </button>
          <button
            onClick={handleRecontact}
            className="flex items-center gap-1.5 bg-[#1F114C] text-white px-4 h-8 rounded-lg text-[12px] font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            {t.talentPool.recontactCampaign}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t.talentPool.addToPool}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-y-auto md:overflow-hidden">
        <TalentPoolFilters filters={filters} onFilterChange={updateFilter} onClear={clearFilters} />
        <div className="flex-1 overflow-y-auto p-6">
          <TalentPoolResultsHeader totalCount={candidates.length} filters={filters} onFilterChange={updateFilter} />
          <TalentPoolAiBar />
          <TalentPoolTable
            candidates={candidates}
            isLoading={query.isLoading}
            isError={query.isError}
            onRetry={() => query.refetch()}
            nextCursor={nextCursor}
            onNextPage={() => setCursor(nextCursor)}
            onPrevPage={() => setCursor(undefined)}
            currentCursor={cursor}
          />
        </div>
      </div>

      {showCreateModal && (
        <CreateModal
          onConfirm={(data) => createMutation.mutate(data)}
          onClose={() => setShowCreateModal(false)}
          isPending={createMutation.isPending}
        />
      )}
    </div>
  );
}
