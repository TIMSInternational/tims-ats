'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../../components';
import { VacancySelector } from './vacancy-selector';
import { KanbanBoard } from './kanban-board';
import { PipelineListView } from './pipeline-list-view';
import { PipelineTableView } from './pipeline-table-view';

type ViewMode = 'kanban' | 'list' | 'table';

export default function PipelinePage() {
  const { t } = useI18n();
  const [selectedVacancyId, setSelectedVacancyId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');

  const vacancies = trpc.vacancy.list.useQuery({ limit: 50, status: 'published' });
  const board = trpc.pipeline.getBoard.useQuery(
    { vacancyId: selectedVacancyId!, status: 'active' },
    { enabled: !!selectedVacancyId },
  );

  const utils = trpc.useUtils();

  const moveCandidate = trpc.pipeline.moveCandidate.useMutation({
    onSuccess: () => {
      if (selectedVacancyId) utils.pipeline.getBoard.invalidate({ vacancyId: selectedVacancyId });
      toast(t.pipeline.moved, { type: 'success' });
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const rejectCandidate = trpc.pipeline.rejectCandidate.useMutation({
    onSuccess: () => {
      if (selectedVacancyId) utils.pipeline.getBoard.invalidate({ vacancyId: selectedVacancyId });
      toast(t.pipeline.rejected, { type: 'success' });
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  // Auto-select first vacancy
  const vacancyList = vacancies.data?.items ?? [];
  if (vacancyList.length > 0 && !selectedVacancyId) {
    setSelectedVacancyId(vacancyList[0].id);
  }

  const VIEW_OPTIONS: { key: ViewMode; label: string }[] = [
    { key: 'kanban', label: 'Kanban' },
    { key: 'list', label: 'List' },
    { key: 'table', label: 'Table' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-4">
          <VacancySelector
            vacancies={vacancyList}
            selectedId={selectedVacancyId}
            onSelect={setSelectedVacancyId}
            isLoading={vacancies.isLoading}
          />
          {/* Filter buttons */}
          <div className="flex items-center gap-2">
            {['Source', 'FIT Score', 'Date', 'SLA'].map((label) => (
              <button
                key={label}
                className="flex items-center gap-1.5 px-3 h-8 rounded-lg border border-[#EDEDED] text-[12px] text-[#585858] hover:bg-[#F6F6F6] transition-colors"
              >
                {label === 'Source' && (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                  </svg>
                )}
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden">
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setViewMode(opt.key)}
                className={`px-3 h-8 text-[12px] font-medium transition-colors ${
                  viewMode === opt.key
                    ? 'bg-[#1F114C] text-white'
                    : 'text-[#585858] hover:text-[#1F114C]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Add Candidate */}
          <button className="flex items-center gap-2 bg-[#DD0C15] text-white px-4 h-9 rounded-lg text-[13px] font-medium shadow-[0_2px_8px_rgba(221,12,21,0.25)] hover:bg-[#c00b13] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t.pipeline.addCandidate}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className={`flex-1 ${viewMode === 'kanban' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto'} p-4`}>
        {!selectedVacancyId ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></svg>}
              message={t.pipeline.noVacancySelected}
            />
          </div>
        ) : board.isLoading ? (
          viewMode === 'kanban' ? (
            <div className="flex gap-3 h-full">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="min-w-[240px] max-w-[240px] flex flex-col bg-[#F0EEF5]/50 rounded-xl overflow-hidden">
                  <div className="px-3 py-3 bg-[#E8E5F0]"><Skeleton className="h-5 w-24 rounded" /></div>
                  <div className="flex-1 p-2 space-y-2">
                    {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-28 w-full rounded-lg" />)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-3 border-b border-[#F0F0F0]">
                  <Skeleton className="w-8 h-8 rounded-full" />
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="h-4 w-16 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                  <Skeleton className="h-4 w-12 rounded" />
                </div>
              ))}
            </div>
          )
        ) : board.data ? (
          viewMode === 'kanban' ? (
            <KanbanBoard
              stages={board.data.stages}
              onMove={(applicationId, toStageId) => moveCandidate.mutate({ applicationId, toStageId })}
              onReject={(applicationId, reason) => rejectCandidate.mutate({ applicationId, reason })}
              isMoving={moveCandidate.isPending}
            />
          ) : viewMode === 'list' ? (
            <PipelineListView
              stages={board.data.stages}
              onMove={(applicationId, toStageId) => moveCandidate.mutate({ applicationId, toStageId })}
              onReject={(applicationId, reason) => rejectCandidate.mutate({ applicationId, reason })}
            />
          ) : (
            <PipelineTableView
              stages={board.data.stages}
              onMove={(applicationId, toStageId) => moveCandidate.mutate({ applicationId, toStageId })}
              onReject={(applicationId, reason) => rejectCandidate.mutate({ applicationId, reason })}
            />
          )
        ) : null}
      </div>
    </div>
  );
}
