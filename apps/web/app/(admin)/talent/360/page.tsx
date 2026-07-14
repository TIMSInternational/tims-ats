'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';
import { CreateCycleForm } from './create-cycle-form';
import { CycleTable } from './cycle-table';
import { CycleManageModal } from './cycle-manage-modal';

export default function Evaluation360Page() {
  const { t } = useI18n();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [managingCycleId, setManagingCycleId] = useState<string | null>(null);

  const cycles = trpc.evaluation360.listCycles.useQuery();

  const toggleManage = (cycleId: string) => {
    setManagingCycleId((prev) => (prev === cycleId ? null : cycleId));
  };

  const managingCycle = (cycles.data ?? []).find((c) => c.id === managingCycleId) ?? null;

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.evaluation360.breadcrumb}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.evaluation360.pageTitle}</span>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c00b13] transition"
        >
          {t.evaluation360.createButton}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4 flex flex-col min-h-0">
        {showCreateForm && <CreateCycleForm onClose={() => setShowCreateForm(false)} />}

        {cycles.isError ? (
          <ErrorState onRetry={() => cycles.refetch()} />
        ) : (
          <CycleTable
            cycles={cycles.data ?? []}
            isLoading={cycles.isLoading}
            managingCycleId={managingCycleId}
            onManage={toggleManage}
          />
        )}
      </div>

      {managingCycle && (
        <CycleManageModal
          cycleId={managingCycle.id}
          cycleName={managingCycle.name}
          onClose={() => setManagingCycleId(null)}
        />
      )}
    </div>
  );
}
