'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { EmptyState, ErrorState } from '../../../../components';
import { KanbanBoard } from './kanban-board';
import { PipelineListView } from './pipeline-list-view';
import { PipelineTableView } from './pipeline-table-view';
import { applyFilters, type PipelineFilterState } from './pipeline-filters';
import { AddCandidateModal } from './add-candidate-modal';
import { moveApplicationOptimistic } from './pipeline-optimistic';
import { useCan } from '../../../../lib/permissions';
import { RejectCandidateModal, type RejectableApplication } from './reject-candidate-modal';
import { usePipelineVacancySelection } from './use-pipeline-vacancy-selection';
import { PipelineToolbar } from './pipeline-toolbar';
import { PipelineBoardSkeleton } from './pipeline-board-skeleton';
import type { ScheduleRequest } from './pipeline-actions';
import { ScheduleModal, type SchedulePrefill } from '../interviews/schedule-modal';
import { announceStageMove } from '../../../../lib/pipeline-move-toast';
import { boardUrlQuery, readBoardUrlState, type BoardStatus, type BoardView } from '../../../../lib/pipeline-url-state';

export default function PipelinePage() {
  const { t } = useI18n();
  const can = useCan();
  const searchParams = useSearchParams();
  const requestedVacancyId = searchParams?.get('vacancy') ?? null;
  // The board context is read from the URL once, on mount (A-09); afterwards this page writes it back.
  const [initialUrl] = useState(() => readBoardUrlState(searchParams));
  const [rejectTarget, setRejectTarget] = useState<{ applicationId: string; candidateName: string } | null>(null);
  const [bulkRejectTargets, setBulkRejectTargets] = useState<RejectableApplication[] | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<SchedulePrefill | null>(null);
  const [viewMode, setViewMode] = useState<BoardView>(initialUrl.view ?? 'kanban');
  const [boardStatus, setBoardStatus] = useState<BoardStatus>(initialUrl.status);
  const [filters, setFilters] = useState<PipelineFilterState>(initialUrl.filters);
  const [showAddCandidate, setShowAddCandidate] = useState(false);

  const { vacancies, options: vacancyList, selectedVacancyId, setSelectedVacancyId, isLoading: vacanciesLoading, showUnavailableNotice } =
    usePipelineVacancySelection(requestedVacancyId);
  const boardInput = { vacancyId: selectedVacancyId ?? '', status: boardStatus };
  const board = trpc.pipeline.getBoard.useQuery(boardInput, {
    enabled: !!selectedVacancyId,
    // Applications arrive from a separate candidate session. Refresh when a recruiter opens
    // or returns to the board, including when switching back to a previously viewed vacancy.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  const utils = trpc.useUtils();

  // A view chosen by the user (or named in the URL) is kept; otherwise phones get the list by default
  // (kanban is unusably cramped below md/768px) and the URL does not pin a view.
  const userSetViewMode = useRef(initialUrl.view !== null);
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

  // Mirror the vacancy, view, status toggle and filters into the URL (A-09), so opening a candidate and
  // pressing Back returns to this exact board. replaceState: no history entry, no server round trip.
  useEffect(() => {
    if (!selectedVacancyId) return;
    const query = boardUrlQuery({
      vacancy: selectedVacancyId,
      view: userSetViewMode.current ? viewMode : null,
      status: boardStatus,
      filters,
    });
    const url = `${window.location.pathname}${query}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url);
  }, [selectedVacancyId, viewMode, boardStatus, filters]);

  // Cards with an in-flight move. Blocks a second drag of the SAME card before
  // its move settles (which would race two optimistic writes on one cache entry
  // and could leave server ≠ UI). Different cards still move concurrently.
  const pendingMoves = useRef<Set<string>>(new Set());

  const moveCandidate = trpc.pipeline.moveCandidate.useMutation({
    // Optimistic move: commit the card to its new column on drop (single source
    // of truth = the query cache), so it never snaps back to wait for the refetch.
    onMutate: async ({ applicationId, toStageId }) => {
      if (!selectedVacancyId) return;
      const input = { vacancyId: selectedVacancyId, status: boardStatus };
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
    onSuccess: (data, variables) => {
      // The checklist warning (backward-looking) and the next-step suggestion for the DESTINATION stage
      // (forward-looking), shared with the Candidate 360's "Mover etapa" (lib/pipeline-move-toast.ts).
      const stages = board.data?.stages ?? [];
      const destinationStage = stages.find((stage) => stage.id === variables.toStageId);
      const movedCandidateId = stages
        .flatMap((stage) => stage.applications)
        .find((application) => application.id === variables.applicationId)?.candidate.id;
      announceStageMove(data, destinationStage?.name, t.pipeline, {
        can,
        candidateId: movedCandidateId,
        applicationId: variables.applicationId,
      });
    },
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

  const bulkMove = trpc.pipeline.bulkMove.useMutation({
    onSuccess: (data) => toast(`${t.pipeline.bulkMoved} (${data.moved})`, { type: 'success' }),
    onError: (err) => toast(err.message, { type: 'error' }),
    onSettled: () => {
      if (selectedVacancyId) utils.pipeline.getBoard.invalidate({ vacancyId: selectedVacancyId });
    },
  });

  const updateApplicationChecklist = trpc.pipeline.updateApplicationChecklist.useMutation({
    onSuccess: () => {
      if (selectedVacancyId) utils.pipeline.getBoard.invalidate({ vacancyId: selectedVacancyId });
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const handleToggleChecklistItem = (applicationId: string, stageId: string, itemKey: string, completed: boolean) =>
    updateApplicationChecklist.mutate({ applicationId, stageId, itemKey, completed });

  const selectedVacancyTitle = vacancyList.find((v) => v.id === selectedVacancyId)?.title ?? '';

  // Gated on the permissions the server enforces; UX only, the API is the boundary.
  const canUpdatePipeline = can('pipeline', 'update');
  const openReject = canUpdatePipeline
    ? (applicationId: string, candidateName: string) => setRejectTarget({ applicationId, candidateName })
    : undefined;
  const openSchedule =
    can('interview', 'create') && selectedVacancyId
      ? (request: ScheduleRequest) =>
          setScheduleTarget({
            candidateId: request.candidateId,
            candidateName: request.candidateName,
            applications: [{ id: request.applicationId, vacancyId: selectedVacancyId, vacancyTitle: selectedVacancyTitle }],
          })
      : undefined;

  const filteredStages = useMemo(() => {
    if (!board.data?.stages) return [];
    return applyFilters(board.data.stages as Parameters<typeof applyFilters>[0], filters) as NonNullable<typeof board.data>['stages'];
  }, [board.data?.stages, filters]);
  const shownCount = filteredStages.reduce((n, stage) => n + stage.applications.length, 0);
  const showEmptyState = !!board.data && shownCount === 0 && (viewMode === 'list' || boardStatus === 'rejected');

  const changeView = (view: BoardView) => {
    userSetViewMode.current = true;
    setViewMode(view);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PipelineToolbar
        vacancies={vacancyList}
        selectedVacancyId={selectedVacancyId}
        onSelectVacancy={setSelectedVacancyId}
        vacanciesLoading={vacanciesLoading}
        filters={filters}
        onFiltersChange={setFilters}
        status={boardStatus}
        onStatusChange={setBoardStatus}
        view={viewMode}
        onViewChange={changeView}
        onAddCandidate={() => (selectedVacancyId ? setShowAddCandidate(true) : toast(t.pipeline.selectVacancyFirst, { type: 'info' }))}
      />

      {showUnavailableNotice && (
        <div role="status" className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-800 shrink-0">
          {t.pipeline.requestedVacancyUnavailable}
        </div>
      )}
      {boardStatus !== 'active' && (
        <div role="status" className="px-6 py-2 bg-[#F6F6F6] border-b border-[#EDEDED] text-[12px] text-[#585858] shrink-0">
          {t.pipeline.readOnlyNotice}
        </div>
      )}
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
          <PipelineBoardSkeleton kanban={viewMode === 'kanban'} />
        ) : board.isError ? (
          <div className="h-full flex items-center justify-center">
            <ErrorState onRetry={() => board.refetch()} />
          </div>
        ) : showEmptyState ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0z" /></svg>}
              message={boardStatus === 'rejected' ? t.pipeline.noRejectedCandidates : t.pipeline.noCandidatesInPipeline}
            />
          </div>
        ) : board.data ? (
          viewMode === 'kanban' ? (
            <KanbanBoard
              stages={filteredStages}
              onMove={handleMove}
              onReject={openReject}
              onSchedule={openSchedule}
              onToggleChecklistItem={handleToggleChecklistItem}
            />
          ) : viewMode === 'list' ? (
            <PipelineListView stages={filteredStages} onMove={handleMove} onReject={openReject} onSchedule={openSchedule} />
          ) : (
            <PipelineTableView
              stages={filteredStages}
              boardStatus={boardStatus}
              onMove={handleMove}
              onReject={openReject}
              onSchedule={openSchedule}
              onBulkMove={canUpdatePipeline ? (applicationIds, toStageId) => bulkMove.mutate({ applicationIds, toStageId }) : undefined}
              onBulkReject={canUpdatePipeline ? (targets) => setBulkRejectTargets(targets) : undefined}
              isBulkPending={bulkMove.isPending}
            />
          )
        ) : null}
      </div>

      {rejectTarget && (
        <RejectCandidateModal
          candidateName={rejectTarget.candidateName}
          applications={[{ id: rejectTarget.applicationId, vacancyTitle: selectedVacancyTitle }]}
          onClose={() => setRejectTarget(null)}
        />
      )}
      {bulkRejectTargets && (
        <RejectCandidateModal bulk candidateName="" applications={bulkRejectTargets} onClose={() => setBulkRejectTargets(null)} />
      )}
      {scheduleTarget && (
        <ScheduleModal prefill={scheduleTarget} onClose={() => setScheduleTarget(null)} onSuccess={() => setScheduleTarget(null)} />
      )}

      {/* Add Candidate Modal */}
      {showAddCandidate && selectedVacancyId && (
        <AddCandidateModal
          vacancyId={selectedVacancyId}
          vacancyTitle={selectedVacancyTitle}
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
