'use client';

import { useI18n } from '../../../../lib/i18n';
import { DataTable, EmptyState } from '../../../../components';
import type { Eval360Cycle } from '../../../../lib/trpc-types';
import { CycleRow } from './cycle-row';
import { CycleListItem } from './cycle-list-item';

interface CycleTableProps {
  cycles: Eval360Cycle[];
  isLoading: boolean;
  onManage: (cycleId: string) => void;
  /** Opens the create form; omitted while it is already open. */
  onCreate?: () => void;
}

export function CycleTable({ cycles, isLoading, onManage, onCreate }: CycleTableProps) {
  const { t } = useI18n();

  const columns = [
    { key: 'name', label: t.evaluation360.columnName },
    { key: 'status', label: t.evaluation360.columnStatus },
    { key: 'created', label: t.evaluation360.columnCreated },
    { key: 'published', label: t.evaluation360.columnPublished },
    { key: 'actions', label: t.evaluation360.columnActions, align: 'right' as const, srOnly: true },
  ];

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      label={t.evaluation360.cyclesTableLabel}
      empty={
        <EmptyState
          icon={
            <svg
              className="size-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          }
          title={t.evaluation360.cyclesEmpty}
          description={t.evaluation360.cyclesEmptyDescription}
          action={onCreate ? { label: t.evaluation360.createButton, onClick: onCreate } : undefined}
        />
      }
      mobileList={
        cycles.length > 0 ? (
          <ul className="divide-y divide-border">
            {cycles.map((cycle) => (
              <CycleListItem key={cycle.id} cycle={cycle} onManage={onManage} />
            ))}
          </ul>
        ) : undefined
      }
    >
      {cycles.map((cycle) => (
        <CycleRow key={cycle.id} cycle={cycle} onManage={onManage} />
      ))}
    </DataTable>
  );
}
