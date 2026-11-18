import type { StatusMapEntry } from '../../../../components';
import type { Eval360Cycle } from '../../../../lib/trpc-types';

type StatusLabels = Record<Eval360Cycle['status'], string>;

/** Cycle status → StatusBadge tone + word (foundation-spec.md §12). */
export function cycleStatusMap(labels: StatusLabels): Record<Eval360Cycle['status'], StatusMapEntry> {
  return {
    draft: { tone: 'neutral', label: labels.draft },
    open: { tone: 'success', label: labels.open },
    closed: { tone: 'warning', label: labels.closed },
    published: { tone: 'info', label: labels.published },
  };
}
