'use client';

import { useI18n } from '../../../../lib/i18n';
import { BOARD_STATUSES, BOARD_VIEWS, type BoardStatus, type BoardView } from '../../../../lib/pipeline-url-state';
import { VacancySelector } from './vacancy-selector';
import { PipelineFilters, type PipelineFilterState } from './pipeline-filters';
import type { PipelineVacancyOption } from './pipeline-vacancy-select';

interface PipelineToolbarProps {
  vacancies: PipelineVacancyOption[];
  selectedVacancyId: string | null;
  onSelectVacancy: (id: string) => void;
  vacanciesLoading: boolean;
  filters: PipelineFilterState;
  onFiltersChange: (filters: PipelineFilterState) => void;
  status: BoardStatus;
  onStatusChange: (status: BoardStatus) => void;
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  onAddCandidate: () => void;
}

const SEGMENT_CLS = 'px-3 h-8 text-[12px] font-medium transition-colors';

function segmentCls(active: boolean): string {
  return `${SEGMENT_CLS} ${active ? 'bg-[#1F114C] text-white' : 'text-[#585858] hover:text-[#1F114C]'}`;
}

export function PipelineToolbar(props: PipelineToolbarProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const statusLabels: Record<BoardStatus, string> = { active: p.statusActive, rejected: p.statusRejected, all: p.statusAll };
  const viewLabels: Record<BoardView, string> = { kanban: p.viewKanban, list: p.viewList, table: p.viewTable };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-white border-b border-[#EDEDED] shrink-0">
      <div className="flex flex-wrap items-center gap-4">
        <VacancySelector
          vacancies={props.vacancies}
          selectedId={props.selectedVacancyId}
          onSelect={props.onSelectVacancy}
          isLoading={props.vacanciesLoading}
        />
        <PipelineFilters filters={props.filters} onChange={props.onFiltersChange} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* Which applications the board shows (A-05): active ones, the rejected ones, or all. */}
        <div role="group" aria-label={p.statusFilterLabel} className="flex bg-[#F6F6F6] rounded-lg overflow-hidden">
          {BOARD_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={props.status === status}
              onClick={() => props.onStatusChange(status)}
              className={segmentCls(props.status === status)}
            >
              {statusLabels[status]}
            </button>
          ))}
        </div>
        <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden">
          {BOARD_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={props.view === view}
              onClick={() => props.onViewChange(view)}
              className={segmentCls(props.view === view)}
            >
              {viewLabels[view]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={props.onAddCandidate}
          className="flex items-center gap-2 bg-[#DD0C15] text-white px-4 h-9 rounded-lg text-[13px] font-medium shadow-[0_2px_8px_rgba(221,12,21,0.25)] hover:bg-[#c00b13] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {p.addCandidate}
        </button>
      </div>
    </div>
  );
}
