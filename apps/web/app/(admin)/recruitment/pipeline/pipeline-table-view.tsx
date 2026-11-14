'use client';

import { useMemo, useState } from 'react';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';
import { CHOICE_INPUT_CLASSES, SortableHeader } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import type { BoardStatus } from '../../../../lib/pipeline-url-state';
import type { ScheduleRequest } from './pipeline-actions';
import { applicationStatusMap } from './pipeline-status';
import { PipelineBulkBar } from './pipeline-bulk-bar';
import { PipelineTableRow } from './pipeline-table-row';
import { PipelineTableCard } from './pipeline-table-card';
import { useNarrowViewport } from './use-narrow-viewport';
import { PipelineSortSelect } from './pipeline-sort-select';
import { flattenBoard, type FlatApp } from './pipeline-table-data';
import type { RejectableApplication } from './reject-candidate-modal';

/** pipeline.bulkMove accepts at most 50 applications per call. */
export const BULK_MAX = 50;

interface PipelineTableViewProps {
  stages: PipelineStageWithApps[];
  boardStatus?: BoardStatus;
  onMove: (applicationId: string, toStageId: string) => void;
  /** Opens the reject modal for one application. Omitted when the user lacks pipeline:update. */
  onReject?: (applicationId: string, candidateName: string) => void;
  /** Opens the prefilled schedule form (A-10). Omitted when the user lacks interview:create. */
  onSchedule?: (request: ScheduleRequest) => void;
  /** Bulk actions on the selected rows (journeys-26). Omitted when the user lacks pipeline:update. */
  onBulkMove?: (applicationIds: string[], toStageId: string) => void;
  onBulkReject?: (applications: RejectableApplication[]) => void;
  /** Tags the selected candidates (candidate.bulkTag). Omitted without candidate:update. */
  onBulkTag?: (candidateIds: string[], tag: string) => void;
  isBulkPending?: boolean;
}

type SortKey = 'name' | 'stage' | 'fit' | 'days' | 'source';
type SortDir = 'asc' | 'desc';

const SORT_KEYS: readonly SortKey[] = ['name', 'stage', 'fit', 'source', 'days'];
const PLAIN_TH = 'px-3 py-2.5 text-callout font-semibold text-secondary';

export function PipelineTableView({
  stages,
  boardStatus = 'active',
  onMove,
  onReject,
  onSchedule,
  onBulkMove,
  onBulkReject,
  onBulkTag,
  isBulkPending = false,
}: PipelineTableViewProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const statusMap = applicationStatusMap(p.applicationStatus);
  const [sortKey, setSortKey] = useState<SortKey>('stage');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const narrow = useNarrowViewport();

  const flatApps: FlatApp[] = useMemo(() => flattenBoard(stages), [stages]);

  const sorted = useMemo(() => {
    const arr = [...flatApps];
    arr.sort((a, b) => {
      if (sortKey === 'fit' && (a.fitScore === null || b.fitScore === null)) {
        return a.fitScore === null ? (b.fitScore === null ? 0 : 1) : -1;
      }
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'stage':
          cmp = a.stageOrder - b.stageOrder;
          break;
        case 'fit':
          cmp = (a.fitScore ?? 0) - (b.fitScore ?? 0);
          break;
        case 'days':
          cmp = a.days - b.days;
          break;
        case 'source':
          cmp = a.source.localeCompare(b.source);
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [flatApps, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const stageList = stages.map((s) => ({ id: s.id, name: s.name, order: s.order }));

  // Selection: active rows only, and only those still on the board (a rejected or moved-away row drops out).
  const bulkEnabled = !!(onBulkMove || onBulkReject || onBulkTag);
  const selectable = sorted.filter((app) => app.actionable);
  const selectedApps = selectable.filter((app) => selected.has(app.id));
  const allSelected = selectable.length > 0 && selectable.slice(0, BULK_MAX).every((app) => selected.has(app.id));
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= BULK_MAX) toast(p.bulkMaxReached.replace('{max}', String(BULK_MAX)), { type: 'info' });
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else {
      if (selectable.length > BULK_MAX) toast(p.bulkMaxReached.replace('{max}', String(BULK_MAX)), { type: 'info' });
      setSelected(new Set(selectable.slice(0, BULK_MAX).map((app) => app.id)));
    }
  };
  const clearSelection = () => setSelected(new Set());

  const sortLabels: Record<SortKey, string> = {
    name: p.colCandidate,
    stage: p.colStage,
    fit: p.colFit,
    source: p.colSource,
    days: p.colDays,
  };
  const header = (key: SortKey, align: 'left' | 'center' = 'center') => (
    <SortableHeader
      label={sortLabels[key]}
      direction={sortKey === key ? sortDir : null}
      onSort={() => toggleSort(key)}
      align={align}
      className="px-3"
    />
  );
  const count = sorted.length;
  const countText =
    boardStatus === 'active'
      ? count === 1
        ? p.tableCountActiveOne
        : p.tableCountActive.replace('{n}', String(count))
      : count === 1
        ? p.tableCountAllOne
        : p.tableCountAll.replace('{n}', String(count));
  const emptyText = boardStatus === 'rejected' ? p.noRejectedCandidates : p.noCandidatesInPipeline;
  const nextStageOf = (app: FlatApp) => stageList.find((s) => s.order === app.stageOrder + 1);

  const selectAll = (
    <input
      type="checkbox"
      aria-label={p.bulkSelectAll}
      checked={allSelected}
      disabled={selectable.length === 0}
      onChange={toggleAll}
      className={CHOICE_INPUT_CLASSES}
    />
  );

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border md:px-5">
        <h2 className="text-subheading font-semibold text-brand">{countText}</h2>
        {narrow && count > 1 && (
          <PipelineSortSelect
            keys={SORT_KEYS}
            labels={sortLabels}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortKey={(key) => {
              setSortKey(key);
              setSortDir('asc');
            }}
            onReverse={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          />
        )}
      </div>
      {bulkEnabled && selectedApps.length > 0 && (
        <PipelineBulkBar
          selectedCount={selectedApps.length}
          stages={stageList}
          isPending={isBulkPending}
          onClear={clearSelection}
          onMove={
            onBulkMove
              ? (toStageId) => {
                  const ids = selectedApps.filter((app) => app.stageId !== toStageId).map((app) => app.id);
                  if (ids.length > 0) onBulkMove(ids, toStageId);
                  clearSelection();
                }
              : undefined
          }
          onReject={
            onBulkReject
              ? () => onBulkReject(selectedApps.map((app) => ({ id: app.id, vacancyTitle: app.name })))
              : undefined
          }
          onTag={
            onBulkTag
              ? (tag) =>
                  onBulkTag(
                    selectedApps.map((app) => app.candidateId),
                    tag,
                  )
              : undefined
          }
        />
      )}

      <div className="overflow-auto flex-1">
        {narrow ? (
          <>
            {bulkEnabled && selectable.length > 0 && (
              <label className="flex min-h-11 items-center gap-2 border-b border-border px-4 text-body text-primary">
                {selectAll}
                {p.bulkSelectAll}
              </label>
            )}
            {count === 0 ? (
              <p className="py-12 text-center text-body text-secondary">{emptyText}</p>
            ) : (
              <ul className="divide-y divide-border">
                {sorted.map((app) => (
                  <PipelineTableCard
                    key={app.id}
                    app={app}
                    nextStage={nextStageOf(app)}
                    bulkEnabled={bulkEnabled}
                    isSelected={selected.has(app.id)}
                    onToggleSelect={() => toggleRow(app.id)}
                    onMove={onMove}
                    onReject={onReject}
                    onSchedule={onSchedule}
                  />
                ))}
              </ul>
            )}
          </>
        ) : (
          <table className="w-full min-w-160">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-hover border-b border-border">
                {bulkEnabled && (
                  <th scope="col" className="w-8 py-2.5 pl-4">
                    {selectAll}
                  </th>
                )}
                {header('name', 'left')}
                {header('stage')}
                {header('fit')}
                {header('source')}
                {header('days')}
                <th scope="col" className={`${PLAIN_TH} text-center`}>
                  {p.colStatus}
                </th>
                <th scope="col" className={`${PLAIN_TH} text-center`}>
                  {p.colSla}
                </th>
                <th scope="col" className={`${PLAIN_TH} px-4 text-right`}>
                  {p.colActions}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((app) => (
                <PipelineTableRow
                  key={app.id}
                  app={app}
                  nextStage={nextStageOf(app)}
                  statusMap={statusMap}
                  bulkEnabled={bulkEnabled}
                  isSelected={selected.has(app.id)}
                  onToggleSelect={() => toggleRow(app.id)}
                  onMove={onMove}
                  onReject={onReject}
                  onSchedule={onSchedule}
                />
              ))}
              {count === 0 && (
                <tr>
                  <td colSpan={bulkEnabled ? 9 : 8} className="py-12 text-center text-body text-secondary">
                    {emptyText}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
