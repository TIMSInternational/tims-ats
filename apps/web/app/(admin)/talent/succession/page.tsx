'use client';

import { useState } from 'react';
import {
  useSuccessionDashboardKpis,
  useSuccessionCriticalRoles,
  useSuccessionCompetencyCoverage,
  useSuccessionFlightRisk,
  useSuccessionRolesWithoutSuccessor,
  useSuccessionCompGapAlerts,
} from '../../../../lib/platform-api/succession';
import { useCompensationSalaryBands } from '../../../../lib/platform-api/compensation';
import { useI18n } from '../../../../lib/i18n';
import { Button, EmptyState, PageHeader } from '../../../../components';
import { SuccessionKpis } from './succession-kpis';
import { SuccessionPipeline } from './succession-pipeline';
import { CompetencyCoverage } from './competency-coverage';
import { FlightRiskPanel } from './flight-risk-panel';
import { RolesWithoutSuccessor } from './roles-without-successor';
import { ExitSimulator } from './exit-simulator';
import { AddSuccessorModal } from './add-successor-modal';
import { SuggestedSuccessors } from './suggested-successors';
import type { PickedUser } from '../../../../components/user-picker';

type Prefill = {
  roleId: string;
  candidate?: PickedUser;
  readiness?: 'ready_now' | 'ready_1_year';
};

export default function SuccessionPage() {
  const { t } = useI18n();
  const [showAdd, setShowAdd] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const kpis = useSuccessionDashboardKpis();
  const roles = useSuccessionCriticalRoles({});
  const coverage = useSuccessionCompetencyCoverage();
  const flightRisk = useSuccessionFlightRisk({});
  const noSuccessor = useSuccessionRolesWithoutSuccessor();
  // Sprint 1.4 Task 4 — Compensation <-> Succession readiness check.
  const salaryBands = useCompensationSalaryBands({});
  const compGapAlerts = useSuccessionCompGapAlerts();

  const roleItems = Array.isArray(roles.data) ? roles.data : [];
  const bandItems = Array.isArray(salaryBands.data) ? salaryBands.data : [];
  const compGapItems = Array.isArray(compGapAlerts.data) ? compGapAlerts.data : [];

  // "Asignar sucesor" on an uncovered role opens the same AddSuccessorModal with that role chosen.
  const openAdd = (next: Prefill | null) => {
    setPrefill(next);
    setShowAdd(true);
  };
  const onAssign = (roleId: string) => openAdd({ roleId });

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      <PageHeader
        title={t.succession.pageTitle}
        description={t.succession.pageDescription}
        actions={
          <Button
            onClick={() => openAdd(null)}
            icon={
              <svg
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            {t.succession.addSuccessor}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <SuccessionKpis
          data={kpis.data}
          loading={kpis.isLoading}
          error={kpis.isError ? kpis.error : null}
          onRetry={() => kpis.refetch()}
        />

        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[11fr_9fr]">
          <SuccessionPipeline
            roles={roleItems}
            loading={roles.isLoading}
            error={roles.isError ? roles.error : null}
            onRetry={() => roles.refetch()}
            bands={bandItems}
            compGapAlerts={compGapItems}
            onAssign={onAssign}
          />
          <div className="flex flex-col gap-4">
            <CompetencyCoverage
              data={coverage.data}
              loading={coverage.isLoading}
              isError={coverage.isError}
              t={t.succession}
            />
            <FlightRiskPanel
              data={flightRisk.data}
              loading={flightRisk.isLoading}
              isError={flightRisk.isError}
              t={t.succession}
            />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[7fr_5fr]">
          <RolesWithoutSuccessor
            data={noSuccessor.data}
            loading={noSuccessor.isLoading}
            isError={noSuccessor.isError}
            totalCriticalRoles={roles.isLoading || roles.isError ? undefined : roleItems.length}
            onAssign={onAssign}
          />
          {roleItems.length > 0 ? (
            <ExitSimulator roles={roleItems} />
          ) : (
            <section className="rounded-xl border border-border bg-white p-4 shadow-card">
              <h2 className="mb-3 text-heading font-semibold text-brand">{t.succession.exitSimulator}</h2>
              <EmptyState size="compact" title={t.succession.noRolesYet} description={t.succession.noRolesDesc} />
            </section>
          )}
        </div>

        {/* Nine Box → Succession suggestions (Sprint 1.4 Task 1) */}
        <SuggestedSuccessors roles={roleItems} t={t.succession} onAddSuggested={(next) => openAdd(next)} />
      </div>

      {showAdd && (
        <AddSuccessorModal
          roles={roleItems}
          initialRoleId={prefill?.roleId}
          initialCandidate={prefill?.candidate}
          initialReadiness={prefill?.readiness}
          onClose={() => {
            setShowAdd(false);
            setPrefill(null);
          }}
        />
      )}
    </div>
  );
}
