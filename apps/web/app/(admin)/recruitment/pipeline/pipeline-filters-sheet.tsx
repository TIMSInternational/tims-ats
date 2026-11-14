'use client';

import { useState } from 'react';
import {
  Button,
  BUTTON_GROUP_CLASSES,
  CHOICE_INPUT_CLASSES,
  CHOICE_ROW_CLASSES,
  CountBadge,
  Field,
  Modal,
  SegmentedControl,
  Select,
} from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';
import { BOARD_STATUSES, type BoardStatus } from '../../../../lib/pipeline-url-state';
import {
  activeFilterCount,
  DATE_OPTIONS,
  EMPTY_FILTERS,
  FILTER_SOURCES,
  FIT_OPTIONS,
  type PipelineFilterState,
} from './pipeline-filters';

interface PipelineFiltersSheetProps {
  filters: PipelineFilterState;
  onChange: (filters: PipelineFilterState) => void;
  status: BoardStatus;
  onStatusChange: (status: BoardStatus) => void;
}

/**
 * Phones (below md): one "Filtros" button that opens a bottom sheet with every filter, instead of a row of
 * pop-ups that overflowed a 390px screen and hid "Limpiar" (layout.md › Size classes). Filters apply as they
 * change; "Ver resultados" only closes the sheet.
 */
export function PipelineFiltersSheet({ filters, onChange, status, onStatusChange }: PipelineFiltersSheetProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(filters) + (status === 'active' ? 0 : 1);
  const statusLabels: Record<BoardStatus, string> = {
    active: p.statusActive,
    rejected: p.statusRejected,
    all: p.statusAll,
  };
  const buttonLabel = count > 0 ? p.filtersButtonCount.replace('{n}', String(count)) : p.filtersButton;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={buttonLabel}
        icon={
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
        }
      >
        {p.filtersButton}
        {count > 0 && <CountBadge count={count} tone="neutral" />}
      </Button>
      {open && (
        <Modal
          title={p.filtersButton}
          onClose={() => setOpen(false)}
          footer={
            <div className={BUTTON_GROUP_CLASSES}>
              <Button
                variant="secondary"
                disabled={count === 0}
                onClick={() => {
                  onChange(EMPTY_FILTERS);
                  onStatusChange('active');
                }}
              >
                {t.common.clearFilters}
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                {p.filtersShowResults}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-body font-medium text-primary">{p.statusFilterLabel}</p>
              <SegmentedControl
                label={p.statusFilterLabel}
                fullWidth
                value={status}
                onChange={onStatusChange}
                options={BOARD_STATUSES.map((value) => ({ value, label: statusLabels[value] }))}
              />
            </div>
            <Field label={p.filterSource}>
              <Select
                value={filters.source ?? ''}
                onChange={(e) => onChange({ ...filters, source: e.target.value || null })}
              >
                <option value="">{p.filterAll}</option>
                {FILTER_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {candidateSourceLabel(s, t.candidates)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={p.filterFit}>
              <Select
                value={String(filters.fitMin ?? 0)}
                onChange={(e) => onChange({ ...filters, fitMin: Number(e.target.value) || null })}
              >
                {FIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={String(opt.value)}>
                    {p[opt.labelKey]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={p.filterDaysInStage}>
              <Select
                value={String(filters.maxDays ?? 0)}
                onChange={(e) => onChange({ ...filters, maxDays: Number(e.target.value) || null })}
              >
                <option value="0">{p.filterAll}</option>
                {DATE_OPTIONS.map((days) => (
                  <option key={days} value={String(days)}>
                    {p.filterDaysLessThan.replace('{n}', String(days))}
                  </option>
                ))}
              </Select>
            </Field>
            <label className={CHOICE_ROW_CLASSES}>
              <input
                type="checkbox"
                checked={filters.slaOnly}
                onChange={(e) => onChange({ ...filters, slaOnly: e.target.checked })}
                className={CHOICE_INPUT_CLASSES}
              />
              {p.filterSlaOnlyLabel}
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
