'use client';

import { useMemo, useState } from 'react';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import type { BoardStatus } from '../../../../lib/pipeline-url-state';
import type { ScheduleRequest } from './pipeline-actions';
import { applicationStatusMap } from './pipeline-status';
import { PipelineBulkBar } from './pipeline-bulk-bar';
import { PipelineTableRow } from './pipeline-table-row';
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

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg className={`w-3 h-3 inline ml-0.5 ${active ? 'text-[#1F114C]' : 'text-[#ccc]'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      {dir === 'asc' ? <path d="M8 15l4-4 4 4" /> : <path d="M8 9l4 4 4-4" />}
    </svg>
  );
}

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

  const flatApps: FlatApp[] = useMemo(() => flattenBoard(stages), [stages]);

  const sorted = useMemo(() => {
    const arr = [...flatApps];
    arr.sort((a, b) => {
      if (sortKey === 'fit' && (a.fitScore === null || b.fitScore === null)) {
        return a.fitScore === null ? (b.fitScore === null ? 0 : 1) : -1;
      }
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'stage': cmp = a.stageOrder - b.stageOrder; break;
        case 'fit': cmp = (a.fitScore ?? 0) - (b.fitScore ?? 0); break;
        case 'days': cmp = a.days - b.days; break;
        case 'source': cmp = a.source.localeCompare(b.source); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [flatApps, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }
    else { setSortKey(key); setSortDir('asc'); }
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

  const header = (label: string, key: SortKey, align: 'left' | 'center' = 'center') => (
    <th
      className={`text-${align} py-2.5 px-3 text-[#585858] font-medium cursor-pointer select-none`}
      onClick={() => toggleSort(key)}
      aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label} <SortIcon active={sortKey === key} dir={sortDir} />
    </th>
  );

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">
          {(boardStatus === 'active' ? p.tableCountActive : p.tableCountAll).replace('{n}', String(sorted.length))}
        </h3>
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
          onReject={onBulkReject ? () => onBulkReject(selectedApps.map((app) => ({ id: app.id, vacancyTitle: app.name }))) : undefined}
          onTag={onBulkTag ? (tag) => onBulkTag(selectedApps.map((app) => app.candidateId), tag) : undefined}
        />
      )}

      <div className="overflow-auto flex-1">
        <table className="w-full min-w-[640px] text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#FAFAFA] border-b border-[#EDEDED]">
              {bulkEnabled && (
                <th className="w-8 py-2.5 pl-4">
                  <input
                    type="checkbox"
                    aria-label={p.bulkSelectAll}
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 accent-[#1F114C]"
                  />
                </th>
              )}
              {header(p.colCandidate, 'name', 'left')}
              {header(p.colStage, 'stage')}
              {header(p.colFit, 'fit')}
              {header(p.colSource, 'source')}
              {header(p.colDays, 'days')}
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{p.colStatus}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{p.colSla}</th>
              <th className="text-right py-2.5 px-4 text-[#585858] font-medium">{p.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((app, idx) => {
              const nextStage = stageList.find((s) => s.order === app.stageOrder + 1);
              return (
                <PipelineTableRow
                  key={app.id}
                  app={app}
                  nextStage={nextStage}
                  striped={idx % 2 === 1}
                  statusMap={statusMap}
                  bulkEnabled={bulkEnabled}
                  isSelected={selected.has(app.id)}
                  onToggleSelect={() => toggleRow(app.id)}
                  onMove={onMove}
                  onReject={onReject}
                  onSchedule={onSchedule}
                />
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={bulkEnabled ? 9 : 8} className="py-12 text-center text-[13px] text-[#8B8B8B]">
                  {boardStatus === 'rejected' ? p.noRejectedCandidates : p.noCandidatesInPipeline}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
