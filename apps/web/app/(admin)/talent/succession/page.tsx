'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import {
  useSuccessionDashboardKpis,
  useSuccessionCriticalRoles,
  useSuccessionCompetencyCoverage,
  useSuccessionFlightRisk,
  useSuccessionRolesWithoutSuccessor,
  useSuccessionCompGapAlerts,
} from '../../../../lib/platform-api/succession';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { SuccessionKpis } from './succession-kpis';
import { SuccessionPipeline } from './succession-pipeline';
import { CompetencyCoverage } from './competency-coverage';
import { FlightRiskPanel } from './flight-risk-panel';
import { RolesWithoutSuccessor } from './roles-without-successor';
import { ExitSimulator } from './exit-simulator';
import { AddSuccessorModal } from './add-successor-modal';
import { SuggestedSuccessors } from './suggested-successors';
import type { PickedUser } from '../../../../components/user-picker';

export default function SuccessionPage() {
  const { t } = useI18n();
  const [showAdd, setShowAdd] = useState(false);
  const [suggestedPrefill, setSuggestedPrefill] = useState<{
    roleId: string;
    candidate: PickedUser;
    readiness: 'ready_now' | 'ready_1_year';
  } | null>(null);
  const kpis = useSuccessionDashboardKpis();
  const roles = useSuccessionCriticalRoles({});
  const coverage = useSuccessionCompetencyCoverage();
  const flightRisk = useSuccessionFlightRisk({});
  const noSuccessor = useSuccessionRolesWithoutSuccessor();
  // Sprint 1.4 Task 4 — Compensation <-> Succession readiness check.
  const salaryBands = trpc.compensation.getSalaryBands.useQuery({});
  const compGapAlerts = useSuccessionCompGapAlerts();

  const roleItems = Array.isArray(roles.data) ? roles.data : [];
  const bandItems = Array.isArray(salaryBands.data) ? salaryBands.data : [];
  const compGapItems = Array.isArray(compGapAlerts.data) ? compGapAlerts.data : [];

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.succession.breadcrumb}</span>
          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-[13px] font-medium text-[#1F114C]">{t.succession.title}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => toast(`${t.common.export}: ${t.common.comingSoon}`, { type: 'info' })} className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t.succession.export}
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t.succession.addSuccessor}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <SuccessionKpis data={kpis.data} loading={kpis.isLoading} isError={kpis.isError} t={t.succession} />

        {/* Main 2-column */}
        <div className="flex flex-col md:flex-row gap-4 mb-4" style={{ minHeight: 370 }}>
          <SuccessionPipeline
            roles={roleItems}
            loading={roles.isLoading}
            isError={roles.isError}
            bands={bandItems}
            compGapAlerts={compGapItems}
            t={t.succession}
          />
          <div className="w-full md:w-[45%] flex flex-col gap-4">
            <CompetencyCoverage data={coverage.data} loading={coverage.isLoading} isError={coverage.isError} t={t.succession} />
            <FlightRiskPanel data={flightRisk.data} loading={flightRisk.isLoading} isError={flightRisk.isError} t={t.succession} />
          </div>
        </div>

        {/* Bottom Row */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <RolesWithoutSuccessor data={noSuccessor.data} loading={noSuccessor.isLoading} isError={noSuccessor.isError} t={t.succession} />
          {roleItems.length > 0 ? (
            <ExitSimulator roles={roleItems} t={t.succession} />
          ) : (
            <div className="w-full md:w-[42%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
              <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.succession.exitSimulator}</h3>
              <p className="text-[11px] text-[#8B8B8B] text-center py-8">{t.succession.noRoles}</p>
            </div>
          )}
        </div>

        {/* Nine Box → Succession suggestions (Sprint 1.4 Task 1) */}
        <SuggestedSuccessors
          roles={roleItems}
          t={t.succession}
          onAddSuggested={(prefill) => {
            setSuggestedPrefill(prefill);
            setShowAdd(true);
          }}
        />
      </div>

      {showAdd && (
        <AddSuccessorModal
          roles={roleItems}
          initialRoleId={suggestedPrefill?.roleId}
          initialCandidate={suggestedPrefill?.candidate}
          initialReadiness={suggestedPrefill?.readiness}
          onClose={() => {
            setShowAdd(false);
            setSuggestedPrefill(null);
          }}
        />
      )}
    </div>
  );
}
