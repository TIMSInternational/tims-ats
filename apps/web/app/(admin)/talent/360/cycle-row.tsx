'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { StatusBadge } from '../../../../components';
import type { Eval360Cycle } from '../../../../lib/trpc-types';
import { formatDate } from '../../../../lib/format-utils';

const STATUS_CLASSES: Record<Eval360Cycle['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  open: 'bg-green-100 text-green-700',
  closed: 'bg-amber-100 text-amber-700',
  published: 'bg-blue-100 text-blue-700',
};

interface CycleRowProps {
  cycle: Eval360Cycle;
  isManaging: boolean;
  onManage: (cycleId: string) => void;
}

/** One review-cycle row: status badge + the single legal next-state
 * transition button (draft->open->closed->published), plus "Manage" to open
 * the assign-raters/progress panel for this cycle. */
export function CycleRow({ cycle, isManaging, onManage }: CycleRowProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const statusMap = {
    draft: { cls: STATUS_CLASSES.draft, label: t.evaluation360.statusLabels.draft },
    open: { cls: STATUS_CLASSES.open, label: t.evaluation360.statusLabels.open },
    closed: { cls: STATUS_CLASSES.closed, label: t.evaluation360.statusLabels.closed },
    published: { cls: STATUS_CLASSES.published, label: t.evaluation360.statusLabels.published },
  };

  const invalidate = () => utils.evaluation360.listCycles.invalidate();

  const openCycle = trpc.evaluation360.openCycle.useMutation({
    onSuccess: () => { toast(t.evaluation360.cycleOpened, { type: 'success' }); invalidate(); },
    onError: (err) => toast(err.message, { type: 'error' }),
  });
  const closeCycle = trpc.evaluation360.closeCycle.useMutation({
    onSuccess: () => { toast(t.evaluation360.cycleClosed, { type: 'success' }); invalidate(); },
    onError: (err) => toast(err.message, { type: 'error' }),
  });
  const publishCycle = trpc.evaluation360.publishCycle.useMutation({
    onSuccess: () => { toast(t.evaluation360.cyclePublished, { type: 'success' }); invalidate(); },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const isPending = openCycle.isPending || closeCycle.isPending || publishCycle.isPending;

  return (
    <tr className="border-b border-[#F6F6F6]">
      <td className="px-4 py-2.5 text-[12px] text-[#333] font-medium">{cycle.name}</td>
      <td className="px-4 py-2.5"><StatusBadge status={cycle.status} map={statusMap} /></td>
      <td className="px-4 py-2.5 text-[12px] text-[#585858]">{formatDate(cycle.createdAt)}</td>
      <td className="px-4 py-2.5 text-[12px] text-[#585858]">{formatDate(cycle.publishedAt)}</td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex justify-end gap-2">
          {cycle.status === 'draft' && (
            <button
              type="button"
              onClick={() => openCycle.mutate({ cycleId: cycle.id })}
              disabled={isPending}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50"
            >
              {t.evaluation360.openButton}
            </button>
          )}
          {cycle.status === 'open' && (
            <button
              type="button"
              onClick={() => closeCycle.mutate({ cycleId: cycle.id })}
              disabled={isPending}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50"
            >
              {t.evaluation360.closeButton}
            </button>
          )}
          {cycle.status === 'closed' && (
            <button
              type="button"
              onClick={() => publishCycle.mutate({ cycleId: cycle.id })}
              disabled={isPending}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50"
            >
              {t.evaluation360.publishButton}
            </button>
          )}
          <button
            type="button"
            onClick={() => onManage(cycle.id)}
            className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition ${
              isManaging ? 'bg-[#1F114C] text-white' : 'bg-[#F6F6F6] text-[#1F114C] hover:bg-[#EDEDED]'
            }`}
          >
            {isManaging ? t.evaluation360.closeManageButton : t.evaluation360.manageButton}
          </button>
        </div>
      </td>
    </tr>
  );
}
