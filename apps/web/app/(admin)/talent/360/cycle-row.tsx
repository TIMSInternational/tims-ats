'use client';

import { useI18n } from '../../../../lib/i18n';
import { StatusBadge } from '../../../../components';
import type { Eval360Cycle } from '../../../../lib/trpc-types';
import { formatDate } from '../../../../lib/format-utils';
import { CycleActions } from './cycle-actions';
import { cycleStatusMap } from './cycle-status';

interface CycleRowProps {
  cycle: Eval360Cycle;
  onManage: (cycleId: string) => void;
}

/** One review-cycle row (md and up): status badge + the next-state transition and "Gestionar evaluadores…". */
export function CycleRow({ cycle, onManage }: CycleRowProps) {
  const { t } = useI18n();

  return (
    <tr className="border-b border-border hover:bg-surface-hover">
      <td className="px-4 py-3 text-body font-medium text-primary">{cycle.name}</td>
      <td className="px-4 py-3">
        <StatusBadge status={cycle.status} map={cycleStatusMap(t.evaluation360.statusLabels)} />
      </td>
      <td className="px-4 py-3 text-body tabular-nums text-secondary">{formatDate(cycle.createdAt)}</td>
      <td className="px-4 py-3 text-body tabular-nums text-secondary">{formatDate(cycle.publishedAt)}</td>
      <td className="px-4 py-3 text-right">
        <CycleActions cycle={cycle} onManage={onManage} className="justify-end" />
      </td>
    </tr>
  );
}
