'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';

interface PipelineBulkBarProps {
  selectedCount: number;
  stages: Array<{ id: string; name: string }>;
  onMove?: (toStageId: string) => void;
  onReject?: () => void;
  onClear: () => void;
  isPending: boolean;
}

/** The action bar shown while table rows are selected (journeys-26): move to a stage, or reject. */
export function PipelineBulkBar({ selectedCount, stages, onMove, onReject, onClear, isPending }: PipelineBulkBarProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const [toStageId, setToStageId] = useState('');

  return (
    <div role="region" aria-label={p.bulkSelected} className="flex flex-wrap items-center gap-3 px-5 py-2.5 border-b border-[#EDEDED] bg-[#F0EEF5]">
      <span className="text-[12px] font-semibold text-[#1F114C]">
        {selectedCount} {p.bulkSelected}
      </span>
      {onMove && (
        <div className="flex items-center gap-2">
          <label htmlFor="bulk-stage" className="text-[12px] text-[#585858]">
            {p.bulkMoveTo}
          </label>
          <select
            id="bulk-stage"
            value={toStageId}
            onChange={(e) => setToStageId(e.target.value)}
            className="h-8 rounded-lg border border-[#EDEDED] bg-white px-2 text-[12px]"
          >
            <option value="">{p.bulkChooseStage}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!toStageId || isPending}
            onClick={() => onMove(toStageId)}
            className="h-8 rounded-lg bg-[#1F114C] px-3 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {p.bulkMove}
          </button>
        </div>
      )}
      {onReject && (
        <button
          type="button"
          disabled={isPending}
          onClick={onReject}
          className="h-8 rounded-lg border border-[#DD0C15] px-3 text-[12px] font-medium text-[#DD0C15] hover:bg-red-50 disabled:opacity-50"
        >
          {p.bulkReject}
        </button>
      )}
      <button type="button" onClick={onClear} className="ml-auto text-[11px] text-[#585858] hover:text-[#1F114C]">
        {p.bulkClear}
      </button>
    </div>
  );
}
