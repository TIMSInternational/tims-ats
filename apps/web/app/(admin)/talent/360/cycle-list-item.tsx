'use client';

import { useI18n, formatMessage } from '../../../../lib/i18n';
import { StatusBadge } from '../../../../components';
import type { Eval360Cycle } from '../../../../lib/trpc-types';
import { formatDate } from '../../../../lib/format-utils';
import { CycleActions } from './cycle-actions';
import { cycleStatusMap } from './cycle-status';

interface CycleListItemProps {
  cycle: Eval360Cycle;
  onManage: (cycleId: string) => void;
}

/** One cycle as a stacked list item for phones (foundation-spec.md §7): name, status, date, actions. */
export function CycleListItem({ cycle, onManage }: CycleListItemProps) {
  const { t } = useI18n();

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-body font-medium text-primary">{cycle.name}</p>
        <StatusBadge status={cycle.status} map={cycleStatusMap(t.evaluation360.statusLabels)} />
      </div>
      <p className="text-callout tabular-nums text-secondary">
        {formatMessage(t.evaluation360.createdOn, { date: formatDate(cycle.createdAt) })}
      </p>
      <CycleActions cycle={cycle} onManage={onManage} />
    </li>
  );
}
