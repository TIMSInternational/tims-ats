'use client';

import { useI18n } from '../../../../lib/i18n';
import { DataTable, EmptyState } from '../../../../components';
import type { Eval360Cycle } from '../../../../lib/trpc-types';
import { CycleRow } from './cycle-row';

interface CycleTableProps {
  cycles: Eval360Cycle[];
  isLoading: boolean;
  managingCycleId: string | null;
  onManage: (cycleId: string) => void;
}

export function CycleTable({ cycles, isLoading, managingCycleId, onManage }: CycleTableProps) {
  const { t } = useI18n();

  const columns = [
    { key: 'name', label: t.evaluation360.columnName },
    { key: 'status', label: t.evaluation360.columnStatus },
    { key: 'created', label: t.evaluation360.columnCreated },
    { key: 'published', label: t.evaluation360.columnPublished },
    { key: 'actions', label: t.evaluation360.columnActions, align: 'right' as const },
  ];

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      empty={
        <EmptyState
          icon={
            <svg className="w-8 h-8 text-[#B8B8B8]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          message={t.evaluation360.cyclesEmpty}
          description={t.evaluation360.cyclesEmptyDescription}
        />
      }
    >
      {cycles.map((cycle) => (
        <CycleRow
          key={cycle.id}
          cycle={cycle}
          isManaging={managingCycleId === cycle.id}
          onManage={onManage}
        />
      ))}
    </DataTable>
  );
}
