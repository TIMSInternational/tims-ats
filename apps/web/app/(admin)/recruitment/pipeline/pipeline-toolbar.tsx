'use client';

import { Button, PageHeader, SegmentedControl } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { BOARD_STATUSES, BOARD_VIEWS, type BoardStatus, type BoardView } from '../../../../lib/pipeline-url-state';
import { VacancySelector } from './vacancy-selector';
import { PipelineFilters, type PipelineFilterState } from './pipeline-filters';
import { PipelineFiltersSheet } from './pipeline-filters-sheet';
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
  /** Omitted when the user cannot create candidates (the button is not shown). */
  onAddCandidate?: () => void;
}

const ADD_HINT_ID = 'pipeline-add-candidate-hint';

/**
 * The page header (h1, the vacancy picker beside it, ONE trailing primary) and one filter bar under it:
 * what to show (status, then the filters) leading, how to show it (the view) trailing (toolbars.md ›
 * Item groupings). Below md the filters collapse into a "Filtros" bottom sheet.
 */
export function PipelineToolbar(props: PipelineToolbarProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const statusLabels: Record<BoardStatus, string> = {
    active: p.statusActive,
    rejected: p.statusRejected,
    all: p.statusAll,
  };
  const viewLabels: Record<BoardView, string> = { kanban: p.viewKanban, list: p.viewList, table: p.viewTable };
  const noVacancy = !props.selectedVacancyId;

  return (
    <>
      <PageHeader
        title={p.title}
        meta={
          <VacancySelector
            vacancies={props.vacancies}
            selectedId={props.selectedVacancyId}
            onSelect={props.onSelectVacancy}
            isLoading={props.vacanciesLoading}
          />
        }
        actions={
          props.onAddCandidate && (
            <>
              <Button
                variant="primary"
                onClick={props.onAddCandidate}
                disabled={noVacancy}
                aria-describedby={noVacancy ? ADD_HINT_ID : undefined}
                title={noVacancy ? p.selectVacancyFirst : undefined}
                icon={
                  <svg
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                }
              >
                {p.addCandidate}
              </Button>
              {noVacancy && (
                <span id={ADD_HINT_ID} className="sr-only">
                  {p.selectVacancyFirst}
                </span>
              )}
            </>
          )
        }
      />
      <div
        role="group"
        aria-label={p.filterBarLabel}
        className="flex flex-wrap items-center gap-2 border-b border-border bg-white px-4 py-2 shrink-0 md:px-6"
      >
        {/* Which applications the board shows (A-05): active ones, the rejected ones, or all. A filter, so it
            leads the filter bar. Phones: inside the "Filtros" sheet. */}
        <SegmentedControl
          className="max-md:hidden"
          label={p.statusFilterLabel}
          options={BOARD_STATUSES.map((value) => ({ value, label: statusLabels[value] }))}
          value={props.status}
          onChange={props.onStatusChange}
        />
        <div className="max-md:hidden">
          <PipelineFilters filters={props.filters} onChange={props.onFiltersChange} />
        </div>
        <div className="md:hidden">
          <PipelineFiltersSheet
            filters={props.filters}
            onChange={props.onFiltersChange}
            status={props.status}
            onStatusChange={props.onStatusChange}
          />
        </div>
        <SegmentedControl
          className="ml-auto"
          label={p.viewSwitcherLabel}
          options={BOARD_VIEWS.map((value) => ({ value, label: viewLabels[value] }))}
          value={props.view}
          onChange={props.onViewChange}
        />
      </div>
    </>
  );
}
