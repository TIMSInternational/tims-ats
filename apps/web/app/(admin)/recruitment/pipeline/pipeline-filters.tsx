'use client';

import { Button, Menu } from '../../../../components';
import { FIT_BANDS, meetsPipelineFitThreshold, type PipelineFitCandidate } from '../../../../lib/pipeline-fit';
import { useI18n } from '../../../../lib/i18n';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';

export interface PipelineFilterState {
  source: string | null;
  fitMin: number | null;
  maxDays: number | null;
  slaOnly: boolean;
}

const EMPTY_FILTERS: PipelineFilterState = { source: null, fitMin: null, maxDays: null, slaOnly: false };

export const FILTER_SOURCES = ['portal', 'linkedin', 'referral', 'job_board', 'university', 'internal'] as const;

// The same bands as the card colours and the Candidate 360 (A-23).
export const FIT_OPTIONS = [
  { value: FIT_BANDS.high, labelKey: 'filterFitHigh' },
  { value: FIT_BANDS.medium, labelKey: 'filterFitMedium' },
  { value: 0, labelKey: 'filterAll' },
] as const;

// Days the application has been in its CURRENT stage (see applyFilters), not days since applying.
export const DATE_OPTIONS = [3, 7, 14, 30] as const;

export function activeFilterCount(filters: PipelineFilterState): number {
  return [filters.source, filters.fitMin, filters.maxDays, filters.slaOnly].filter(Boolean).length;
}

interface Props {
  filters: PipelineFilterState;
  onChange: (f: PipelineFilterState) => void;
}

// Active filters are tinted, not filled: the page keeps one filled control (the primary action).
const TRIGGER =
  'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-callout transition-colors pointer-coarse:min-h-11';
const triggerCls = (active: boolean) =>
  `${TRIGGER} ${active ? 'border-brand bg-brand-tint font-medium text-brand' : 'border-field-border text-secondary hover:bg-surface hover:text-primary'}`;

function Chevron() {
  return (
    <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

/** The inline filter row (md and up): three single-choice pop-up menus, the overdue toggle and "Limpiar". */
export function PipelineFilters({ filters, onChange }: Props) {
  const { t } = useI18n();
  const p = t.pipeline;
  const activeCount = activeFilterCount(filters);
  const sourceLabel = filters.source ? candidateSourceLabel(filters.source, t.candidates) : p.filterSource;
  const fitActive = filters.fitMin != null && filters.fitMin > 0;
  const fitLabel = fitActive ? p.filterFitActive.replace('{n}', String(filters.fitMin)) : p.filterFit;
  const daysLabel = filters.maxDays ? p.filterDaysActive.replace('{n}', String(filters.maxDays)) : p.filterDaysInStage;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Menu
        align="start"
        label={sourceLabel}
        selectedKey={filters.source ?? 'all'}
        triggerClassName={triggerCls(!!filters.source)}
        trigger={
          <>
            {sourceLabel}
            <Chevron />
          </>
        }
        items={[
          { key: 'all', label: p.filterAll, onSelect: () => onChange({ ...filters, source: null }) },
          ...FILTER_SOURCES.map((s) => ({
            key: s,
            label: candidateSourceLabel(s, t.candidates),
            onSelect: () => onChange({ ...filters, source: s }),
          })),
        ]}
      />
      <Menu
        align="start"
        label={fitLabel}
        selectedKey={String(filters.fitMin ?? 0)}
        triggerClassName={triggerCls(fitActive)}
        trigger={
          <>
            {fitLabel}
            <Chevron />
          </>
        }
        items={FIT_OPTIONS.map((opt) => ({
          key: String(opt.value),
          label: p[opt.labelKey],
          onSelect: () => onChange({ ...filters, fitMin: opt.value || null }),
        }))}
      />
      <Menu
        align="start"
        label={daysLabel}
        selectedKey={String(filters.maxDays ?? 0)}
        triggerClassName={triggerCls(!!filters.maxDays)}
        trigger={
          <>
            {daysLabel}
            <Chevron />
          </>
        }
        items={[
          { key: '0', label: p.filterAll, onSelect: () => onChange({ ...filters, maxDays: null }) },
          ...DATE_OPTIONS.map((days) => ({
            key: String(days),
            label: p.filterDaysLessThan.replace('{n}', String(days)),
            onSelect: () => onChange({ ...filters, maxDays: days }),
          })),
        ]}
      />
      <button
        type="button"
        aria-pressed={filters.slaOnly}
        onClick={() => onChange({ ...filters, slaOnly: !filters.slaOnly })}
        className={`${TRIGGER} ${
          filters.slaOnly
            ? 'border-danger/40 bg-danger-bg font-medium text-danger'
            : 'border-field-border text-secondary hover:bg-surface hover:text-primary'
        }`}
      >
        {filters.slaOnly && (
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        )}
        {p.filterSlaOverdue}
      </button>
      {activeCount > 0 && (
        <Button variant="tertiary" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          {p.filterClear.replace('{n}', String(activeCount))}
        </Button>
      )}
    </div>
  );
}

/** Apply filters to board stages (client-side filtering) */
export function applyFilters(
  stages: Array<{
    id: string;
    name: string;
    order: number;
    slaHours: number | null;
    applications: Array<{
      id: string;
      source: string;
      appliedAt: Date | string;
      enteredStageAt: Date | string;
      candidate: PipelineFitCandidate;
      [key: string]: unknown;
    }>;
  }>,
  filters: PipelineFilterState,
): typeof stages {
  if (!filters.source && !filters.fitMin && !filters.maxDays && !filters.slaOnly) {
    return stages;
  }

  return stages.map((stage) => ({
    ...stage,
    applications: stage.applications.filter((app) => {
      // Source filter
      if (filters.source && app.source !== filters.source) return false;

      // A FIT threshold applies only to a persisted score for this vacancy.
      if (filters.fitMin) {
        if (!meetsPipelineFitThreshold(app.candidate, filters.fitMin)) return false;
      }

      // Date filter (days in stage)
      if (filters.maxDays) {
        const daysInStage = Math.floor((Date.now() - new Date(app.enteredStageAt).getTime()) / 86400000);
        if (daysInStage > filters.maxDays) return false;
      }

      // SLA filter — precise hours, not floored days*24, so sub-24h SLAs count. A stage without an SLA
      // (the default Oferta and Contratado) can never be overdue, so it shows nothing under this filter.
      if (filters.slaOnly) {
        if (stage.slaHours == null) return false;
        const hoursInStage = (Date.now() - new Date(app.enteredStageAt).getTime()) / 3600000;
        if (hoursInStage <= stage.slaHours) return false;
      }

      return true;
    }),
  }));
}

export { EMPTY_FILTERS };
