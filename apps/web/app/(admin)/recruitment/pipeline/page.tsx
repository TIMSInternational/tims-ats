'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { EmptyState, ErrorState, Skeleton } from '../../../../components';
import { VacancySelector } from './vacancy-selector';
import { KanbanBoard } from './kanban-board';
import { PipelineListView } from './pipeline-list-view';
import { PipelineTableView } from './pipeline-table-view';
import { PipelineFilters, applyFilters, EMPTY_FILTERS, type PipelineFilterState } from './pipeline-filters';
import { AddCandidateModal } from './add-candidate-modal';
import { moveApplicationOptimistic } from './pipeline-optimistic';

type ViewMode = 'kanban' | 'list' | 'table';

export default function PipelinePage() {
  const { t } = useI18n();
  const [selectedVacancyId, setSelectedVacancyId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [filters, setFilters] = useState<PipelineFilterState>(EMPTY_FILTERS);
  const [showAddCandidate, setShowAddCandidate] = useState(false);

  const vacancies = trpc.vacancy.list.useQuery({ limit: 50, status: 'published' });
  const board = trpc.pipeline.getBoard.useQuery(
    { vacancyId: selectedVacancyId!, status: 'active' },
    { enabled: !!selectedVacancyId },
  );

  const utils = trpc.useUtils();

  // Tracks whether the user has manually picked a view via the toggle, so the
  // mobile auto-switch below only applies a smart DEFAULT on initial narrow
  // load — it never fights a deliberate choice (e.g. a user who explicitly
  // re-selects 'kanban' on a phone keeps it, cramped-but-functional).
  const userSetViewMode = useRef(false);

  // Auto-switch to list view on mobile viewports (kanban is unusably cramped
  // below md/768px). Only overrides the initial 'kanban' default, and only
  // while the user hasn't manually interacted with the view toggle.
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const applyIfNarrow = () => {
      if (mql.matches && !userSetViewMode.current) {
        setViewMode((current) => (current === 'kanban' ? 'list' : current));
      }
    };
    applyIfNarrow();
    mql.addEventListener('change', applyIfNarrow);
    return () => mql.removeEventListener('change', applyIfNarrow);
  }, []);

  // Cards with an in-flight move. Blocks a second drag of the SAME card before
  // its move settles (which would race two optimistic writes on one cache entry
  // and could leave server ≠ UI). Different cards still move concurrently.
  const pendingMoves = useRef<Set<string>>(new Set());

  const moveCandidate = trpc.pipeline.moveCandidate.useMutation({
    // Optimistic move: commit the card to its new column on drop (single source
    // of truth = the query cache), so it never snaps back to wait for the refetch.
    onMutate: async ({ applicationId, toStageId }) => {
      if (!selectedVacancyId) return;
      const input = { vacancyId: selectedVacancyId, status: 'active' as const };
      await utils.pipeline.getBoard.cancel(input);
      const previous = utils.pipeline.getBoard.getData(input);
      if (previous) {
        utils.pipeline.getBoard.setData(input, moveApplicationOptimistic(previous, applicationId, toStageId));
      }
      return { previous, input };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous && ctx?.input) utils.pipeline.getBoard.setData(ctx.input, ctx.previous);
      toast(err.message, { type: 'error' });
    },
    onSuccess: () => { toast(t.pipeline.moved, { type: 'success' }); },
    // Reconcile with server truth once the write settles (success or rollback).
    onSettled: (_data, _err, { applicationId }) => {
      pendingMoves.current.delete(applicationId);
      if (selectedVacancyId) utils.pipeline.getBoard.invalidate({ vacancyId: selectedVacancyId });
    },
  });

  const handleMove = (applicationId: string, toStageId: string) => {
    if (pendingMoves.current.has(applicationId)) return; // same card already moving
    pendingMoves.current.add(applicationId);
    moveCandidate.mutate({ applicationId, toStageId });
  };

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

  // Apply client-side filters to board data
  const filteredStages = useMemo(() => {
    if (!board.data?.stages) return [];
    return applyFilters(board.data.stages as Parameters<typeof applyFilters>[0], filters);
  }, [board.data?.stages, filters]);

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
          <PipelineFilters filters={filters} onChange={setFilters} />
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden">
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => {
                  userSetViewMode.current = true;
                  setViewMode(opt.key);
                }}
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
          <button
            onClick={() => selectedVacancyId ? setShowAddCandidate(true) : toast(t.pipeline.selectVacancyFirst, { type: 'info' })}
            className="flex items-center gap-2 bg-[#DD0C15] text-white px-4 h-9 rounded-lg text-[13px] font-medium shadow-[0_2px_8px_rgba(221,12,21,0.25)] hover:bg-[#c00b13] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t.pipeline.addCandidate}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className={`flex-1 ${viewMode === 'kanban' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto'} p-4`}>
        {vacancies.isError ? (
          <div className="h-full flex items-center justify-center">
            <ErrorState onRetry={() => vacancies.refetch()} />
          </div>
        ) : !selectedVacancyId ? (
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
        ) : board.isError ? (
          <div className="h-full flex items-center justify-center">
            <ErrorState onRetry={() => board.refetch()} />
          </div>
        ) : board.data ? (
          viewMode === 'kanban' ? (
            <KanbanBoard
              stages={filteredStages as typeof board.data.stages}
              onMove={handleMove}
              onReject={(applicationId, reason) => rejectCandidate.mutate({ applicationId, reason })}
            />
          ) : viewMode === 'list' ? (
            <PipelineListView
              stages={filteredStages as typeof board.data.stages}
              onMove={handleMove}
              onReject={(applicationId, reason) => rejectCandidate.mutate({ applicationId, reason })}
            />
          ) : (
            <PipelineTableView
              stages={filteredStages as typeof board.data.stages}
              onMove={handleMove}
              onReject={(applicationId, reason) => rejectCandidate.mutate({ applicationId, reason })}
            />
          )
        ) : null}
      </div>

      {/* Add Candidate Modal */}
      {showAddCandidate && selectedVacancyId && (
        <AddCandidateModal
          vacancyId={selectedVacancyId}
          vacancyTitle={vacancyList.find((v) => v.id === selectedVacancyId)?.title ?? ''}
          onClose={() => setShowAddCandidate(false)}
          onSuccess={() => {
            setShowAddCandidate(false);
            utils.pipeline.getBoard.invalidate({ vacancyId: selectedVacancyId });
          }}
        />
      )}
    </div>
  );
}
