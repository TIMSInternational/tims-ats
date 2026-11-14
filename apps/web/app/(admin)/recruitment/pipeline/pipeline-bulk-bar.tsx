'use client';

import { useState } from 'react';
import { Button, inputClasses, selectClasses } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface PipelineBulkBarProps {
  selectedCount: number;
  stages: Array<{ id: string; name: string }>;
  onMove?: (toStageId: string) => void;
  onReject?: () => void;
  onTag?: (tag: string) => void;
  onClear: () => void;
  isPending: boolean;
}

/** The action bar shown while table rows are selected (journeys-26): move to a stage, or reject. */
export function PipelineBulkBar({
  selectedCount,
  stages,
  onMove,
  onReject,
  onTag,
  onClear,
  isPending,
}: PipelineBulkBarProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const [toStageId, setToStageId] = useState('');
  const [tag, setTag] = useState('');
  const cleanTag = tag.trim();

  return (
    <div
      role="region"
      aria-label={p.bulkSelected}
      className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-border bg-brand-tint md:px-5"
    >
      <span className="text-body font-semibold text-brand">
        {selectedCount} {p.bulkSelected}
      </span>
      {onMove && (
        <div className="flex items-center gap-2">
          <label htmlFor="bulk-stage" className="text-callout text-secondary">
            {p.bulkMoveTo}
          </label>
          <div className="w-44">
            <select
              id="bulk-stage"
              value={toStageId}
              onChange={(e) => setToStageId(e.target.value)}
              className={selectClasses('md')}
            >
              <option value="">{p.bulkChooseStage}</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" size="sm" disabled={!toStageId || isPending} onClick={() => onMove(toStageId)}>
            {p.bulkMove}
          </Button>
        </div>
      )}
      {onTag && (
        <div className="flex items-center gap-2">
          <label htmlFor="bulk-tag" className="text-callout text-secondary">
            {p.bulkTagLabel}
          </label>
          <div className="w-40">
            <input
              id="bulk-tag"
              value={tag}
              maxLength={50}
              onChange={(e) => setTag(e.target.value)}
              placeholder={p.bulkTagPlaceholder}
              className={inputClasses('md')}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!cleanTag || isPending}
            onClick={() => {
              onTag(cleanTag);
              setTag('');
            }}
          >
            {p.bulkTagAction}
          </Button>
        </div>
      )}
      {onReject && (
        <Button variant="destructive-secondary" size="sm" disabled={isPending} onClick={onReject}>
          {p.bulkReject}
        </Button>
      )}
      <Button variant="tertiary" size="sm" onClick={onClear} className="ml-auto">
        {p.bulkClear}
      </Button>
    </div>
  );
}
