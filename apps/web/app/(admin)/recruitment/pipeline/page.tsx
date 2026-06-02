'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../../components';
import { VacancySelector } from './vacancy-selector';
import { KanbanBoard } from './kanban-board';

export default function PipelinePage() {
  const { t } = useI18n();
  const [selectedVacancyId, setSelectedVacancyId] = useState<string | null>(null);

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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#EDEDED] shrink-0">
        <VacancySelector
          vacancies={vacancyList}
          selectedId={selectedVacancyId}
          onSelect={setSelectedVacancyId}
          isLoading={vacancies.isLoading}
        />
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        {!selectedVacancyId ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></svg>}
              message={t.pipeline.noVacancySelected}
            />
          </div>
        ) : board.isLoading ? (
          <div className="flex gap-3 h-full">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="min-w-[260px] max-w-[260px] flex flex-col bg-[#F0EEF5]/50 rounded-xl overflow-hidden">
                <div className="px-3 py-3 bg-[#E8E5F0]"><Skeleton className="h-5 w-24 rounded" /></div>
                <div className="flex-1 p-2 space-y-2">
                  {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-24 w-full rounded-lg" />)}
                </div>
              </div>
            ))}
          </div>
        ) : board.data ? (
          <KanbanBoard
            stages={board.data.stages}
            onMove={(applicationId, toStageId) => moveCandidate.mutate({ applicationId, toStageId })}
            onReject={(applicationId, reason) => rejectCandidate.mutate({ applicationId, reason })}
            isMoving={moveCandidate.isPending}
          />
        ) : null}
      </div>
    </div>
  );
}
