'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '../../../../lib/toast';
import { useI18n, pluralize, formatMessage } from '../../../../lib/i18n';
import { Button, EmptyState, ErrorState, Skeleton } from '../../../../components';
import { RequestAdjustmentModal } from './request-adjustment-modal';
import { SuccessionRoleCard } from './succession-role-card';
import { useSuccessionUpdateCriticalRoleBand } from '../../../../lib/platform-api/succession';
import type { AdjustmentTarget, CompGapAlert, CriticalRole, SalaryBandOption } from './succession-types';

interface SuccessionPipelineProps {
  roles: CriticalRole[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  bands: SalaryBandOption[];
  compGapAlerts: CompGapAlert[];
  /** Opens AddSuccessorModal with this role chosen. */
  onAssign: (roleId: string) => void;
}

const COLLAPSED_COUNT = 5;

export function SuccessionPipeline({
  roles,
  loading,
  error,
  onRetry,
  bands,
  compGapAlerts,
  onAssign,
}: SuccessionPipelineProps) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [adjustmentTarget, setAdjustmentTarget] = useState<AdjustmentTarget | null>(null);
  const [showAll, setShowAll] = useState(false);

  const updateBand = useSuccessionUpdateCriticalRoleBand({
    onSuccess: () => {
      // The TS tRPC succession reads have been deleted — the platform-api query key is the only
      // read path left to invalidate.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
      toast(t.succession.targetBandUpdateSuccess, { type: 'success' });
    },
    onError: () => toast(t.succession.targetBandUpdateError, { type: 'error' }),
  });

  const visible = showAll ? roles : roles.slice(0, COLLAPSED_COUNT);

  return (
    <section aria-labelledby="succession-pipeline" className="rounded-xl border border-border bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="succession-pipeline" className="text-heading font-semibold text-brand">
          {t.succession.successionPipeline}
        </h2>
        {!loading && !error && roles.length > 0 && (
          <span className="text-callout text-secondary">
            {pluralize(roles.length, t.succession.criticalRolesCount, locale)}
          </span>
        )}
      </div>

      {loading ? (
        <div aria-busy="true" className="space-y-3">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState size="compact" title={t.succession.loadError} error={error} onRetry={onRetry} />
      ) : roles.length === 0 ? (
        <EmptyState title={t.succession.noRolesYet} description={t.succession.noRolesDesc} />
      ) : (
        <>
          <ul className="space-y-3">
            {visible.map((role) => (
              <SuccessionRoleCard
                key={role.id}
                role={role}
                bands={bands}
                compGapAlerts={compGapAlerts}
                bandPending={updateBand.isPending}
                onBandChange={(criticalRoleId, targetBandLevel) =>
                  updateBand.mutate({ criticalRoleId, targetBandLevel })
                }
                onAssign={onAssign}
                onRequestAdjustment={setAdjustmentTarget}
              />
            ))}
          </ul>
          {roles.length > COLLAPSED_COUNT && (
            <div className="mt-3 flex justify-center">
              <Button variant="tertiary" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll
                  ? t.succession.showFewerRoles
                  : formatMessage(t.succession.showAllRoles, { count: roles.length })}
              </Button>
            </div>
          )}
        </>
      )}

      {adjustmentTarget && (
        <RequestAdjustmentModal
          userId={adjustmentTarget.userId}
          employeeName={adjustmentTarget.employeeName}
          previousSalary={adjustmentTarget.previousSalary}
          suggestedNewSalary={adjustmentTarget.suggestedNewSalary}
          onClose={() => setAdjustmentTarget(null)}
        />
      )}
    </section>
  );
}
