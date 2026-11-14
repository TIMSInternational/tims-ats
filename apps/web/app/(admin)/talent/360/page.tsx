'use client';

import { useState } from 'react';
import { useEvaluation360ListCycles } from '../../../../lib/platform-api/evaluation360';
import { useI18n } from '../../../../lib/i18n';
import { Button, ErrorState, PageHeader } from '../../../../components';
import { CreateCycleForm } from './create-cycle-form';
import { CycleTable } from './cycle-table';
import { CycleManageModal } from './cycle-manage-modal';

export default function Evaluation360Page() {
  const { t } = useI18n();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [managingCycleId, setManagingCycleId] = useState<string | null>(null);

  const cycles = useEvaluation360ListCycles();

  const managingCycle = (cycles.data ?? []).find((c) => c.id === managingCycleId) ?? null;

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      <PageHeader
        title={t.evaluation360.pageTitle}
        description={t.evaluation360.pageDescription}
        actions={
          // While the inline form is open its own "Crear ciclo" is the one primary (buttons.md › Style).
          !showCreateForm && <Button onClick={() => setShowCreateForm(true)}>{t.evaluation360.createButton}</Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 flex flex-col min-h-0">
        {showCreateForm && <CreateCycleForm onClose={() => setShowCreateForm(false)} />}

        {cycles.isError ? (
          <ErrorState error={cycles.error} onRetry={() => cycles.refetch()} />
        ) : (
          <CycleTable
            cycles={cycles.data ?? []}
            isLoading={cycles.isLoading}
            onManage={setManagingCycleId}
            onCreate={showCreateForm ? undefined : () => setShowCreateForm(true)}
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
