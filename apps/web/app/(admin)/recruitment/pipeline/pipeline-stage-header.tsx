'use client';

import { StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';

// The navy progression from the first to the last stage survives as a 4px decorative bar above each
// stage, so no text ever sits on the lavender fills (white on #B8AED4 was 2.09:1; accessibility.md › Vision).
const STAGE_BAR_COLORS = [
  'bg-[#E8E5F0]',
  'bg-[#D4CFE5]',
  'bg-[#B8AED4]',
  'bg-[#7B6BAA]',
  'bg-[#5C4B99]',
  'bg-brand',
] as const;

export function stageBarColor(index: number): string {
  return STAGE_BAR_COLORS[Math.min(index, STAGE_BAR_COLORS.length - 1)] ?? 'bg-brand';
}

interface PipelineStageHeaderProps {
  /** Id of the stage heading, for the column's aria-labelledby. */
  headingId: string;
  name: string;
  /** Position of the stage, for the bar colour. */
  index: number;
  /** Candidates shown after the filters, and the stage's unfiltered total. */
  shown: number;
  total: number;
  slaHours: number | null;
  overdueCount: number;
  className?: string;
}

/** A stage's heading row on the kanban board and in the list view: name, count, overdue count or target. */
export function PipelineStageHeader({
  headingId,
  name,
  index,
  shown,
  total,
  slaHours,
  overdueCount,
  className = '',
}: PipelineStageHeaderProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const filtered = shown !== total;
  const countText = filtered ? formatMessage(p.filteredCount, { shown, total }) : String(shown);
  const countLabel = filtered
    ? formatMessage(p.filteredCountLabel, { shown, total })
    : shown === 1
      ? p.stageCountOne
      : formatMessage(p.stageCount, { n: shown });

  return (
    <div className={`shrink-0 bg-white ${className}`}>
      <div className={`h-1 ${stageBarColor(index)}`} aria-hidden="true" />
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={headingId} className="truncate text-subheading font-semibold text-brand">
            {name}
          </h2>
          <span
            title={countLabel}
            className="shrink-0 rounded-full bg-brand-tint px-1.5 py-0.5 text-caption font-semibold tabular-nums text-brand"
          >
            <span aria-hidden="true">{countText}</span>
            <span className="sr-only">{countLabel}</span>
          </span>
        </div>
        {overdueCount > 0 ? (
          <StatusBadge tone="danger">
            {overdueCount === 1 ? p.slaOverdueCountOne : formatMessage(p.slaOverdueCount, { n: overdueCount })}
          </StatusBadge>
        ) : slaHours ? (
          <span className="shrink-0 text-caption text-secondary" title={formatMessage(p.slaHintLabel, { h: slaHours })}>
            {formatMessage(p.slaHint, { h: slaHours })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
